export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { verifyUddoktaPayment } from '../../../lib/payments';
import { timingSafeEqualHex } from '../../../lib/security';
import { nowSql } from '../../../lib/dates';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  // Webhook authenticity: UddoktaPay sends the merchant API key in this header
  // on every IPN. Reject anything that does not carry the correct key before
  // doing any work (server-to-server verification below is the second gate).
  const ipnKey = context.request.headers.get('RT-UDDOKTAPAY-API-KEY');
  if (!ipnKey || !timingSafeEqualHex(ipnKey, env.UDDOKTAPAY_API_KEY)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawPayload = JSON.stringify(await context.request.json().catch(() => ({})));
  let body: any;
  try { body = JSON.parse(rawPayload); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const invoiceId = body.invoice_id;
  if (!invoiceId) return Response.json({ error: 'Missing invoice_id' }, { status: 400 });

  const { status, amountPaisa, metadata, rawResponse } = await verifyUddoktaPayment(invoiceId, env.UDDOKTAPAY_API_KEY, env.UDDOKTAPAY_BASE_URL);

  if (status !== 'paid') return Response.json({ received: true, status }, { status: 200 });

  const payment = await env.DB.prepare(
    `SELECT id, order_id, amount_paisa, status FROM payments WHERE invoice_id = ?1`
  ).bind(invoiceId).first<{ id: string; order_id: string; amount_paisa: number; status: string }>();

  if (!payment) return Response.json({ error: 'Payment not found' }, { status: 404 });

  // Amount authority: the verified paid amount MUST match what we charged.
  // Defends against amount tampering / partial settlement / invoice reuse.
  if (amountPaisa === null || amountPaisa !== payment.amount_paisa) {
    const firstItem = await env.DB.prepare(
      `SELECT variant_id FROM order_items WHERE order_id = ?1 LIMIT 1`
    ).bind(payment.order_id).first<{ variant_id: string }>();
    const alertVariantId = firstItem?.variant_id ?? 'unknown';
    await env.DB.prepare(
      `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
       VALUES (?1, ?2, ?3, ?4)`
    ).bind(
      crypto.randomUUID(),
      alertVariantId,
      `payment_amount_mismatch invoice=${invoiceId} expected=${payment.amount_paisa} verified=${amountPaisa}. Manual review required.`,
      now
    ).run();
    return Response.json({ error: 'Payment amount mismatch' }, { status: 409 });
  }

  if (metadata && typeof metadata.order_id === 'string' && metadata.order_id !== payment.order_id) {
    return Response.json({ error: 'Invoice does not belong to this order' }, { status: 409 });
  }

  const orderTotalPaisa = (await env.DB.prepare(`SELECT total_paisa FROM orders WHERE id = ?1`).bind(payment.order_id).first<{ total_paisa: number }>())?.total_paisa ?? Infinity;
  const isPartialPrepay = metadata?.type === 'partial_prepay' || payment.amount_paisa < orderTotalPaisa;

  const eventResult = await env.DB.prepare(
    `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
     VALUES (?1, ?2, ?3, 'webhook', ?4, ?5, ?6)`
  ).bind(crypto.randomUUID(), payment.id, invoiceId, isPartialPrepay ? 'partially_paid' : 'paid', rawResponse, now).run();

  if (eventResult.meta.changes !== 1) return Response.json({ received: true, status: 'duplicate' }, { status: 200 });

  const paidResult = await env.DB.prepare(
    `UPDATE payments SET status = 'paid', verified_at = ?2, updated_at = ?2
     WHERE id = ?1 AND status IN ('created','pending','processing')`
  ).bind(payment.id, now).run();

  if (paidResult.meta.changes !== 1) return Response.json({ error: 'Payment already confirmed' }, { status: 409 });

  if (isPartialPrepay) {
    await env.DB.prepare(
      `UPDATE orders SET payment_status = 'partially_paid', updated_at = ?2 WHERE id = ?1`
    ).bind(payment.order_id, now).run();
    return Response.json({ received: true, status: 'partially_paid' }, { status: 200 });
  }

  const reservations = await env.DB.prepare(
    `SELECT id, variant_id, quantity, status FROM stock_reservations
     WHERE order_id = ?1 AND status = 'active'`
  ).bind(payment.order_id).all<{ id: string; variant_id: string; quantity: number; status: string }>();

  if (reservations.results && reservations.results.length > 0) {
    // Atomic deduct: decrement reserved + quantity + mark reservation confirmed
    // in a single transactional batch. If any deduct fails (over-allocated),
    // the whole batch rolls back, leaving the order in pending_review to be
    // re-evaluated by the compensation path below.
    const deductStmts = reservations.results.map(r =>
      env.DB.prepare(
        `UPDATE inventory_items
         SET reserved_quantity = reserved_quantity - ?1,
             quantity = quantity - ?1,
             updated_at = ?3
         WHERE variant_id = ?2 AND reserved_quantity >= ?1 AND quantity >= ?1`
      ).bind(r.quantity, r.variant_id, now)
    );
    const confirmStmts = reservations.results.map(r =>
      env.DB.prepare(
        `UPDATE stock_reservations SET status = 'confirmed', updated_at = ?2 WHERE id = ?1`
      ).bind(r.id, now)
    );
    const orderStatusStmt = env.DB.prepare(
      `UPDATE orders SET payment_status = 'paid', status = 'payment_verified', updated_at = ?2 WHERE id = ?1`
    ).bind(payment.order_id, now);

    const deductResults = await env.DB.batch(
      [...deductStmts, ...confirmStmts, orderStatusStmt],
      { atomic: true }
    );
    void deductResults; // result is implicit; we re-check the order status below

    // After atomic batch, check which (if any) reservations failed by
    // looking at the order status. If it didn't transition to
    // 'payment_verified', at least one deduct returned changes !== 1.
    const orderAfter = await env.DB.prepare(
      `SELECT status FROM orders WHERE id = ?1`
    ).bind(payment.order_id).first<{ status: string }>();

    if (orderAfter?.status === 'payment_verified') {
      return Response.json({ received: true, status: 'paid' }, { status: 200 });
    }

    // At least one reservation failed to deduct. Since the atomic batch
    // either fully succeeded or fully rolled back, all inventory is still
    // intact. We need a paid_over_allocated path that:
    //   1. Marks the order paid_over_allocated (idempotent).
    //   2. Cancels all reservations for the order.
    //   3. Compensates ONLY when a compensation flag is absent
    //      (the compensation is itself idempotent — guarded by an INSERT
    //      into payment_events with a unique key on (payment, event_type)).
    await markPaidOverAllocated(env.DB, payment.order_id, payment.id, reservations.results, now);
    return Response.json({ received: true, status: 'paid_over_allocated' }, { status: 200 });
  } else {
    const orderItems = await env.DB.prepare(
      `SELECT variant_id, quantity FROM order_items WHERE order_id = ?1`
    ).bind(payment.order_id).all<{ variant_id: string; quantity: number }>();

    if (!orderItems.results || orderItems.results.length === 0) {
      return Response.json({ error: 'No order items found' }, { status: 500 });
    }

    const atomicStmts = orderItems.results.map(item =>
      env.DB.prepare(
        `UPDATE inventory_items
         SET quantity = quantity - ?1, updated_at = ?3
         WHERE variant_id = ?2 AND is_available = 1 AND (quantity - reserved_quantity) >= ?1`
      ).bind(item.quantity, item.variant_id, now)
    );
    const orderStatusStmt = env.DB.prepare(
      `UPDATE orders SET payment_status = 'paid', status = 'payment_verified', updated_at = ?2 WHERE id = ?1`
    ).bind(payment.order_id, now);

    const atomicResults = await env.DB.batch(
      [...atomicStmts, orderStatusStmt],
      { atomic: true }
    );
    void atomicResults; // result is implicit; we re-check the order status below

    const orderAfter = await env.DB.prepare(
      `SELECT status FROM orders WHERE id = ?1`
    ).bind(payment.order_id).first<{ status: string }>();

    if (orderAfter?.status === 'payment_verified') {
      return Response.json({ received: true, status: 'paid' }, { status: 200 });
    }

    // Atomic batch failed — every deduct was rolled back. Re-run the failed
    // subset one-by-one WITHOUT the order-status statement, identifying
    // which items actually had stock; only those need compensation added
    // back (which is a no-op here because the atomic batch rolled them back,
    // so we DON'T compensate). Then we mark the order paid_over_allocated.
    const fallbacks = orderItems.results.map(item =>
      env.DB.prepare(
        `UPDATE inventory_items SET quantity = quantity - ?1, updated_at = ?3
         WHERE variant_id = ?2 AND is_available = 1 AND (quantity - reserved_quantity) >= ?1`
      ).bind(item.quantity, item.variant_id, now)
    );
    const fallbackResults = await env.DB.batch(fallbacks);
    const succeededItems = orderItems.results.filter((_, index) => fallbackResults[index]?.meta.changes === 1);
    const failedItems = orderItems.results.filter((_, index) => fallbackResults[index]?.meta.changes !== 1);

    if (succeededItems.length > 0) {
      // Compensate ONLY for items that successfully deducted in this
      // fallback path. The compensation is itself guarded by a unique
      // payment_events row so a retry of this webhook cannot apply it twice.
      const compensationApplied = await tryApplyCompensation(env.DB, payment.id, payment.order_id, succeededItems, now);
      if (!compensationApplied) {
        // A previous run already compensated. Roll back the just-deducted
        // items in this invocation to keep inventory consistent.
        const rollbackStmts = succeededItems.map(item =>
          env.DB.prepare(
            `UPDATE inventory_items SET quantity = quantity + ?1, updated_at = ?3 WHERE variant_id = ?2`
          ).bind(item.quantity, item.variant_id, now)
        );
        await env.DB.batch(rollbackStmts, { atomic: true });
      }
    }

    await env.DB.prepare(
      `UPDATE orders SET payment_status = 'paid', status = 'paid_over_allocated', updated_at = ?2 WHERE id = ?1`
    ).bind(payment.order_id, now).run();

    const failedVariant = failedItems[0]?.variant_id ?? orderItems.results[0].variant_id;
    await env.DB.prepare(
      `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
       VALUES (?1, ?2, 'paid_over_allocated for order. Sourcing/substitution/refund needed.', ?3)`
    ).bind(crypto.randomUUID(), failedVariant, now).run();

    return Response.json({ received: true, status: 'paid_over_allocated' }, { status: 200 });
  }
}

/**
 * Marks the order as paid_over_allocated, cancels its reservations
 * (so the 30-minute expiry cron does not later try to release already-
 * compensated stock), and emits a low_stock_alert.
 *
 * Idempotent: cancelling reservations that are already 'cancelled' is a
 * no-op. Stock itself is unchanged because the deduct was rolled back.
 */
async function markPaidOverAllocated(
  db: D1Database,
  orderId: string,
  paymentId: string,
  reservations: Array<{ id: string; variant_id: string; quantity: number }>,
  now: string
): Promise<void> {
  const reservationIds = reservations.map(r => r.id);
  if (reservationIds.length === 0) return;
  const placeholders = reservationIds.map((_, i) => `?${i + 2}`).join(', ');
  // Only cancel reservations still 'active' — confirmed ones are out of scope.
  await db.prepare(
    `UPDATE stock_reservations
     SET status = 'cancelled', updated_at = ?1
     WHERE order_id = ?1 AND status = 'active' AND id IN (${placeholders})`
  ).bind(now, orderId, ...reservationIds).run();

  await db.prepare(
    `UPDATE orders SET payment_status = 'paid', status = 'paid_over_allocated', updated_at = ?2 WHERE id = ?1`
  ).bind(orderId, now).run();

  const firstVariant = reservations[0]?.variant_id ?? 'unknown';
  await db.prepare(
    `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
     VALUES (?1, ?2, 'paid_over_allocated for active reservation. Sourcing/substitution/refund needed.', ?3)`
  ).bind(crypto.randomUUID(), firstVariant, now).run();

  // Audit the compensation marker so the second webhook delivery (if it
  // gets through the INSERT OR IGNORE for the original event) can be told
  // that compensation has already been applied for this payment.
  await db.prepare(
    `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
     VALUES (?1, ?2, ?3, 'compensation_applied', 'paid', 'paid_over_allocated', ?4)`
  ).bind(crypto.randomUUID(), paymentId, orderId, now).run();
}

/**
 * Apply compensation for items that successfully deducted in the
 * no-reservation fallback path. Returns false if compensation was
 * already applied (i.e. a previous webhook delivery got there first),
 * in which case the caller must roll back the just-deducted quantity.
 *
 * Idempotency is enforced by the UNIQUE(invoice_id, event_type, status)
 * constraint on payment_events; the row below uses event_type =
 * 'compensation_applied' which is distinct from the main 'webhook'
 * event row.
 */
async function tryApplyCompensation(
  db: D1Database,
  paymentId: string,
  orderId: string,
  deductedItems: Array<{ variant_id: string; quantity: number }>,
  now: string
): Promise<boolean> {
  const claim = await db.prepare(
    `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
     VALUES (?1, ?2, ?3, 'compensation_applied', 'paid', 'compensate', ?4)`
  ).bind(crypto.randomUUID(), paymentId, orderId, now).run();
  if (claim.meta.changes !== 1) return false;

  // We are ADDING BACK stock (positive delta). No `>=` guard. The atomic
  // batch above rolled back any stock changes for items that didn't
  // actually have availability, so the only items in `deductedItems` are
  // those we successfully subtracted — adding them back restores the
  // original state.
  const compensateStmts = deductedItems.map(item =>
    db.prepare(
      `UPDATE inventory_items SET quantity = quantity + ?1, updated_at = ?3 WHERE variant_id = ?2`
    ).bind(item.quantity, item.variant_id, now)
  );
  await db.batch(compensateStmts, { atomic: true });
  return true;
}
