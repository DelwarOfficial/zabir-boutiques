import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { nowSql } from '../../../lib/dates';
import { safeLog } from '../../../lib/pii-scrubber';
import { createPaymentCheckout } from '../../../lib/integrations/payments';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let body: any;
  try { body = await context.request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const orderId = body.order_id;
  if (!orderId) return Response.json({ error: 'Missing order_id' }, { status: 400 });

  // Master Plan §2.6: Idempotency-Key must be accepted for payment creation
  const idempotencyKey = context.request.headers.get('Idempotency-Key')?.trim() || null;
  if (idempotencyKey) {
    const existing = await env.DB.prepare(
      `SELECT id, checkout_url, invoice_id FROM payments WHERE id = ?1 AND status IN ('created','pending','processing')`
    ).bind(idempotencyKey).first<{ id: string; checkout_url: string | null; invoice_id: string }>();
    if (existing && existing.checkout_url) {
      return Response.json(
        { ok: true, payment_id: existing.id, checkout_url: existing.checkout_url, invoice_id: existing.invoice_id, reused: true },
        { status: 200 }
      );
    }
  }

  const order = await env.DB.prepare(
    `SELECT id, total_paisa, advance_paisa, payment_method, payment_status FROM orders WHERE id = ?1`
  ).bind(orderId).first<{ id: string; total_paisa: number; advance_paisa: number; payment_method: string; payment_status: string }>();

  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });
  if (!['uddoktapay', 'partial_prepay'].includes(order.payment_method)) {
    return Response.json({ error: 'Order is not set for online payment' }, { status: 400 });
  }
  if (order.payment_status === 'paid' || order.payment_status === 'partially_paid') {
    return Response.json({ error: 'Order is already paid' }, { status: 409 });
  }
  if (order.payment_status !== 'created' && order.payment_status !== 'pending') {
    return Response.json({ error: 'Payment cannot be initiated for this order' }, { status: 409 });
  }

  // For partial prepay, the payment amount is the advance, not the full total
  const paymentAmountPaisa = order.payment_method === 'partial_prepay' ? order.advance_paisa : order.total_paisa;

  // Idempotency: if a usable payment already exists for this order, reuse it.
  // The partial unique index idx_payments_order_unique_active (migration 0032)
  // prevents TOCTOU races: two concurrent inserts for the same order_id with
  // active status will conflict at the index level.
  const existing = await env.DB.prepare(
    `SELECT id, invoice_id, checkout_url, status FROM payments
     WHERE order_id = ?1 AND status IN ('created','pending','processing')
     ORDER BY created_at DESC LIMIT 1`
  ).bind(orderId).first<{ id: string; invoice_id: string; checkout_url: string | null; status: string }>();

  if (existing && existing.checkout_url) {
    return Response.json(
      { ok: true, payment_id: existing.id, checkout_url: existing.checkout_url, invoice_id: existing.invoice_id, reused: true },
      { status: 200 }
    );
  }

  const paymentId = idempotencyKey || crypto.randomUUID();
  const invoiceId = crypto.randomUUID();
  const checkout = await createPaymentCheckout(env, {
    invoiceId,
    amountPaisa: paymentAmountPaisa,
    customerName: body.customer_name ?? '',
    customerPhone: body.customer_phone ?? '',
    orderId,
    type: order.payment_method === 'partial_prepay' ? 'partial_prepay' : 'full',
    redirectUrl: `${body.redirect_url ?? env.PUBLIC_SITE_URL}/order-track`,
    cancelUrl: `${body.cancel_url ?? env.PUBLIC_SITE_URL}/checkout`,
  });

  if (!checkout.ok || !checkout.paymentUrl) {
    safeLog.error('[payments/create] provider error', { body: checkout.rawResponse, errorCode: checkout.errorCode, provider: checkout.provider });
    return Response.json({ error: 'Payment provider error' }, { status: 502 });
  }

  // Use INSERT OR IGNORE with unique index protection: if a concurrent request
  // already inserted a payment row for this order, this insert is silently
  // skipped and we return the existing payment below.
  const insertResult = await env.DB.prepare(
    `INSERT OR IGNORE INTO payments (id, order_id, invoice_id, provider, amount_paisa, status, checkout_url, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?7)`
  ).bind(paymentId, orderId, invoiceId, checkout.provider, paymentAmountPaisa, checkout.paymentUrl, now).run();

  if (insertResult.meta.changes === 0) {
    // Another request created the payment row first. Fetch and return it.
    const conflictRow = await env.DB.prepare(
      `SELECT id, checkout_url, invoice_id FROM payments
       WHERE order_id = ?1 AND status IN ('created','pending','processing')
       ORDER BY created_at DESC LIMIT 1`
    ).bind(orderId).first<{ id: string; checkout_url: string | null; invoice_id: string }>();
    if (conflictRow?.checkout_url) {
      return Response.json(
        { ok: true, payment_id: conflictRow.id, checkout_url: conflictRow.checkout_url, invoice_id: conflictRow.invoice_id, reused: true },
        { status: 200 }
      );
    }
  }

  await env.DB.prepare(
    `UPDATE orders SET payment_status = 'pending', updated_at = ?2 WHERE id = ?1`
  ).bind(orderId, now).run();

  return Response.json({ ok: true, payment_id: paymentId, checkout_url: checkout.paymentUrl, invoice_id: invoiceId }, { status: 201 });
}
