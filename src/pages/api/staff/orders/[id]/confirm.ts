import type { APIContext } from 'astro';
import { getEnv } from '../../../../../lib/env';
import { nowSql } from '../../../../../lib/dates';
import { requireAuth, requirePermission, canConfirmOrder, RbacError } from '../../../../../lib/rbac';
import { writeAuditLog, writeCriticalAuditLog, clientIp, userAgent } from '../../../../../lib/audit';
import { confirmReservationsForOrder } from '../../../../../lib/inventory';

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

  // Reject terminal states that cannot transition to confirmed
  if (order.status === 'cancelled') {
    return Response.json({ ok: false, code: 'INVALID_TRANSITION', error: 'Cannot confirm a cancelled order.' }, { status: 409 });
  }

  // Idempotent terminal-state short-circuit: if the order is already at
  // a status >= staff_confirmed, the second confirm is a no-op success.
  if (order.status === 'staff_confirmed' || order.status === 'packing' ||
      order.status === 'shipped' || order.status === 'delivered' ||
      order.status === 'returned' || order.status === 'refunded') {
    return Response.json({ ok: true, status: order.status, alreadyConfirmed: true }, { status: 200 });
  }

  // For 'pending_review' / 'pending_payment' the confirmation deducts stock
  // from the active reservations and advances the order. The status guard
  // `status = ?3` ensures a concurrent request cannot double-deduct. Stock
  // mutation is routed exclusively through confirmReservationsForOrder (the
  // sanctioned D1 layer + DO sync) — route handlers MUST NOT touch
  // inventory_items directly (V8 Guardrail #17, drift D-41). The order-status
  // flip + history row are embedded in the same atomic batch so the whole
  // transition commits together.
  if (order.status === 'pending_review' || order.status === 'pending_payment') {
    const orderUpdate = env.DB.prepare(
      `UPDATE orders SET status = 'staff_confirmed', updated_at = ?2
       WHERE id = ?1 AND status = ?3`,
    ).bind(orderId, now, order.status);
    const historyInsert = env.DB.prepare(
      `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, created_at)
       VALUES (?1, ?2, ?3, 'staff_confirmed', ?4, ?5)`,
    ).bind(crypto.randomUUID(), orderId, order.status, user.id, now);

    const confirmResult = await confirmReservationsForOrder(
      env as unknown as Parameters<typeof confirmReservationsForOrder>[0],
      orderId,
      now,
      [orderUpdate, historyInsert],
    );

    if (!confirmResult.ok) {
      if (confirmResult.reason === 'no_active_reservations') {
        return Response.json(
          {
            ok: false,
            code: 'NO_ACTIVE_RESERVATIONS',
            error: 'Order has no active stock reservations. Customer should re-checkout.',
          },
          { status: 409 },
        );
      }
      // deduct_failed — D1 guard rejected a deduction. Should not happen
      // post-reserve; indicates DO/D1 drift. Surface as a conflict.
      return Response.json(
        {
          ok: false,
          code: 'DEDUCT_FAILED',
          error: `Stock deduction failed for variant ${confirmResult.failedVariantId}.`,
        },
        { status: 409 },
      );
    }
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
