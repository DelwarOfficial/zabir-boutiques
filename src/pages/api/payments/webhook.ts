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
    // Resolve a real variant_id for the alert (use the first order_item's variant)
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

  // Invoice/order binding: if the gateway echoes our metadata.order_id, it must
  // match this payment's order. Skipped when metadata is absent (older invoices).
  if (metadata && typeof metadata.order_id === 'string' && metadata.order_id !== payment.order_id) {
    return Response.json({ error: 'Invoice does not belong to this order' }, { status: 409 });
  }

  // Determine if this is a partial prepayment or a full payment
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

  // Partial prepayment: mark the advance as paid, but do NOT deduct inventory.
  // Stock reservations remain active; staff will confirm the order manually.
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
    const deductStmts = reservations.results.map(r =>
      env.DB.prepare(
        `UPDATE inventory_items
         SET reserved_quantity = reserved_quantity - ?1,
             quantity = quantity - ?1,
             updated_at = ?3
         WHERE variant_id = ?2 AND reserved_quantity >= ?1 AND quantity >= ?1`
      ).bind(r.quantity, r.variant_id, now)
    );
    const deductResults = await env.DB.batch(deductStmts);
    const failedReservation = reservations.results.find((_, index) => deductResults[index]?.meta.changes !== 1);

    if (failedReservation) {
      const deductedReservations = reservations.results.filter((_, index) => deductResults[index]?.meta.changes === 1);
      if (deductedReservations.length > 0) {
        // Compensate ONLY items that were successfully deducted in this batch (caller filters).
        // We are *adding back* stock that was subtracted, so no " >= " guard on the positive delta.
        // Protection against double-compensate: (1) only the successfully-deducted subset,
        // (2) payment_events INSERT OR IGNORE + early return on duplicate webhook, (3) status check before.
        const compensateStmts = deductedReservations.map(r =>
          env.DB.prepare(
            `UPDATE inventory_items
             SET reserved_quantity = reserved_quantity + ?1,
                 quantity = quantity + ?1,
                 updated_at = ?3
             WHERE variant_id = ?2`
          ).bind(r.quantity, r.variant_id, now)
        );
        await env.DB.batch(compensateStmts);
      }

      await env.DB.prepare(
        `UPDATE orders SET payment_status = 'paid', status = 'paid_over_allocated', updated_at = ?2 WHERE id = ?1`
      ).bind(payment.order_id, now).run();

      await env.DB.prepare(
        `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
         VALUES (?1, ?2, 'paid_over_allocated for active reservation. Sourcing/substitution/refund needed.', ?3)`
      ).bind(crypto.randomUUID(), failedReservation.variant_id, now).run();

      return Response.json({ received: true, status: 'paid_over_allocated' }, { status: 200 });
    }

    const confirmStmts = reservations.results.map(r =>
      env.DB.prepare(
        `UPDATE stock_reservations SET status = 'confirmed', updated_at = ?2 WHERE id = ?1`
      ).bind(r.id, now)
    );
    await env.DB.batch(confirmStmts);

    await env.DB.prepare(
      `UPDATE orders SET payment_status = 'paid', status = 'payment_verified', updated_at = ?2 WHERE id = ?1`
    ).bind(payment.order_id, now).run();
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

    const atomicResults = await env.DB.batch(atomicStmts);
    const allDeducted = atomicResults.every(r => r.meta.changes === 1);

    if (allDeducted) {
      await env.DB.prepare(
        `UPDATE orders SET payment_status = 'paid', status = 'payment_verified', updated_at = ?2 WHERE id = ?1`
      ).bind(payment.order_id, now).run();
    } else {
      await env.DB.prepare(
        `UPDATE orders SET payment_status = 'paid', status = 'paid_over_allocated', updated_at = ?2 WHERE id = ?1`
      ).bind(payment.order_id, now).run();

      const deductedItems = orderItems.results.filter((_, index) => atomicResults[index]?.meta.changes === 1);
      if (deductedItems.length > 0) {
        // Compensate ONLY items successfully deducted in the atomic no-reservation fallback path.
        // Pure quantity + (no reserved change here). Double-apply prevented by payment_events
        // idempotency (INSERT OR IGNORE on the webhook event) and the 'allDeducted' / paid_over_allocated branch.
        const compensateStmts = deductedItems.map(item =>
          env.DB.prepare(
            `UPDATE inventory_items
             SET quantity = quantity + ?1, updated_at = ?3
             WHERE variant_id = ?2`
          ).bind(item.quantity, item.variant_id, now)
        );
        await env.DB.batch(compensateStmts);
      }

      const failedItem = orderItems.results.find((_, index) => atomicResults[index]?.meta.changes !== 1);
      await env.DB.prepare(
        `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
         VALUES (?1, ?2, 'paid_over_allocated for order. Sourcing/substitution/refund needed.', ?3)`
      ).bind(crypto.randomUUID(), failedItem?.variant_id ?? orderItems.results[0].variant_id, now).run();
    }
  }

  return Response.json({ received: true, status: 'paid' }, { status: 200 });
}
