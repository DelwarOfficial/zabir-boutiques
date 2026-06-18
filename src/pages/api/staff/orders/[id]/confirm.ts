import type { APIContext } from 'astro';
import { getEnv } from '../../../../../lib/env';
import { nowSql } from '../../../../../lib/dates';
import { requireAuth, requirePermission, canConfirmOrder, RbacError } from '../../../../../lib/rbac';
import { writeAuditLog, writeCriticalAuditLog, clientIp, userAgent } from '../../../../../lib/audit';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const orderId = context.params.id;
  const now = nowSql();

  if (!orderId) return Response.json({ error: 'Missing order ID' }, { status: 400 });

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'orders.confirm');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  // Idempotency: a request fingerprint keyed on (orderId, action) so a
  // client retry or network blip that replays the POST does not
  // double-deduct stock or double-emit the confirmation email.
  const idempotencyKey = `orders/${orderId}/confirm:${context.request.headers.get('Idempotency-Key') ?? now}`;
  try {
    const claim = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO checkout_idempotency (idempotency_key, order_id, status, response_body, created_at, expires_at)
         VALUES (?1, ?2, 'processing', NULL, ?3, ?4)`,
      )
      .bind(idempotencyKey, orderId, now, nowSql(new Date(Date.now() + 5 * 60 * 1000)))
      .run();
    if (claim.meta.changes !== 1) {
      // Another instance already processed (or is processing) this
      // exact request. Return 409 so the client stops retrying.
      return Response.json({ ok: false, code: 'CONFIRM_IN_FLIGHT' }, { status: 409 });
    }
  } catch {
    // If the idempotency table is unavailable, fall through to the
    // guarded UPDATE which will still prevent double-confirm via the
    // status NOT IN (...) clause below.
  }

  // Read the order. We do this AFTER the idempotency claim so two
  // concurrent requests cannot both observe the pre-confirm state.
  const order = await env.DB.prepare(
    `SELECT id, status, payment_status, fraud_decision FROM orders WHERE id = ?1`
  ).bind(orderId).first<{ id: string; status: string; payment_status: string; fraud_decision: string }>();

  if (!order) {
    return Response.json({ error: 'Order not found' }, { status: 404 });
  }

  // Rule #9: FraudBD-blocked orders must not be confirmed by normal staff.
  if (!canConfirmOrder(user.role, order.fraud_decision)) {
    await writeAuditLog(env.DB, {
      actorStaffId: user.id,
      actorRole: user.role,
      action: 'orders.confirm_denied_fraud',
      entityType: 'order',
      entityId: orderId,
      metadata: { reason: 'fraud_blocked', order_status: order.status },
      ipAddress: clientIp(context.request),
      userAgent: userAgent(context.request)
    });
    return Response.json(
      { ok: false, code: 'FRAUD_BLOCKED', error: 'Order is fraud-blocked and cannot be confirmed without fraud override.' },
      { status: 403 }
    );
  }

  // Idempotent terminal-state short-circuit: if the order is already at
  // a status >= staff_confirmed, the second confirm is a no-op success.
  if (order.status === 'staff_confirmed' || order.status === 'packing' ||
      order.status === 'shipped' || order.status === 'delivered' ||
      order.status === 'returned' || order.status === 'refunded') {
    return Response.json({ ok: true, status: order.status, alreadyConfirmed: true }, { status: 200 });
  }

  // For 'pending_review' / 'pending_payment' the confirmation
  // unconditionally deducts stock from the active reservations and
  // advances the order. The status guard `status = ?3` ensures a
  // concurrent request cannot double-deduct.
  if (order.status === 'pending_review' || order.status === 'pending_payment') {
    const reservations = await env.DB.prepare(
      `SELECT id, variant_id, quantity FROM stock_reservations
       WHERE order_id = ?1 AND status = 'active'`
    ).bind(orderId).all<{ id: string; variant_id: string; quantity: number }>();

    const resRows = reservations.results ?? [];

    // If there are no active reservations the order is in a stale
    // state: reservations expired and were released. Confirm must
    // fail closed — staff should not "confirm" an order whose stock
    // has been re-allocated. This is the P0-005 audit fix: the
    // previous code happily flipped the order to staff_confirmed even
    // when the reservations had evaporated.
    if (resRows.length === 0) {
      return Response.json(
        {
          ok: false,
          code: 'NO_ACTIVE_RESERVATIONS',
          error: 'Order has no active stock reservations. Customer should re-checkout.',
        },
        { status: 409 },
      );
    }

    const deductStmts = resRows.map(r =>
      env.DB.prepare(
        `UPDATE inventory_items
         SET reserved_quantity = reserved_quantity - ?1,
             quantity = quantity - ?1,
             updated_at = ?3
         WHERE variant_id = ?2 AND reserved_quantity >= ?1 AND quantity >= ?1`
      ).bind(r.quantity, r.variant_id, now)
    );
    const confirmStmts = resRows.map(r =>
      env.DB.prepare(
        `UPDATE stock_reservations SET status = 'confirmed', updated_at = ?2 WHERE id = ?1`
      ).bind(r.id, now)
    );
    const orderUpdate = env.DB.prepare(
      `UPDATE orders SET status = 'staff_confirmed', updated_at = ?2
       WHERE id = ?1 AND status = ?3`
    ).bind(orderId, now, order.status);
    const historyInsert = env.DB.prepare(
      `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, created_at)
       VALUES (?1, ?2, ?3, 'staff_confirmed', ?4, ?5)`
    ).bind(crypto.randomUUID(), orderId, order.status, user.id, now);

    // Atomic batch: deduct + confirm reservations + order status +
    // history row. If any statement returns 0 changes (status guard
    // fails, reservation already confirmed), the whole batch rolls
    // back. A retry returns 200 alreadyConfirmed (idempotent).
    await env.DB.batch([...deductStmts, ...confirmStmts, orderUpdate, historyInsert], { atomic: true });
  } else {
    // 'payment_verified' / 'paid_over_allocated' confirmations: the
    // webhook already deducted stock. We only flip the status. The
    // status guard prevents a double-flip on retry.
    await env.DB.batch(
      [
        env.DB.prepare(
          `UPDATE orders SET status = 'staff_confirmed', updated_at = ?2
           WHERE id = ?1 AND status = ?3`,
        ).bind(orderId, now, order.status),
        env.DB.prepare(
          `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, created_at)
           VALUES (?1, ?2, ?3, 'staff_confirmed', ?4, ?5)`,
        ).bind(crypto.randomUUID(), orderId, order.status, user.id, now),
      ],
      { atomic: true },
    );
  }

  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'orders.confirm',
    entityType: 'order',
    entityId: orderId,
    metadata: { from_status: order.status, to_status: 'staff_confirmed' },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });

  return Response.json({ ok: true, status: 'staff_confirmed' }, { status: 200 });
}
