export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { nowSql } from '../../../lib/dates';
import { safeLog } from '../../../lib/pii-scrubber';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let body: any;
  try { body = await context.request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const orderId = body.order_id;
  if (!orderId) return Response.json({ error: 'Missing order_id' }, { status: 400 });

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

  // Idempotency: if a usable payment was already created for this order, reuse
  // its checkout URL instead of creating a duplicate invoice/payment row.
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

  const invoiceId = crypto.randomUUID();
  const checkoutRes = await fetch(`${env.UDDOKTAPAY_BASE_URL}/api/checkout`, {
    method: 'POST',
    headers: {
      'RT-UDDOKTAPAY-API-KEY': env.UDDOKTAPAY_API_KEY,
      'accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      invoice_id: invoiceId,
      amount: (paymentAmountPaisa / 100).toFixed(2),
      currency: 'BDT',
      customer_name: body.customer_name ?? '',
      customer_phone: body.customer_phone ?? '',
      // Bind the invoice to this order so the webhook can reconcile it.
      metadata: { order_id: orderId, type: order.payment_method === 'partial_prepay' ? 'partial_prepay' : 'full' },
      redirect_url: `${body.redirect_url ?? env.PUBLIC_SITE_URL}/order-track`,
      cancel_url: `${body.cancel_url ?? env.PUBLIC_SITE_URL}/checkout`
    })
  });

  const checkoutData = await checkoutRes.json().catch(() => ({})) as any;
  if (!checkoutRes.ok || !checkoutData?.payment_url) {
    safeLog.error('[payments/create] provider error', { status: checkoutRes.status, body: JSON.stringify(checkoutData) });
    return Response.json({ error: 'Payment provider error' }, { status: 502 });
  }

  const paymentId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO payments (id, order_id, invoice_id, provider, amount_paisa, status, checkout_url, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'uddoktapay', ?4, 'pending', ?5, ?6, ?6)`
  ).bind(paymentId, orderId, invoiceId, paymentAmountPaisa, checkoutData.payment_url, now).run();

  await env.DB.prepare(
    `UPDATE orders SET payment_status = 'pending', updated_at = ?2 WHERE id = ?1`
  ).bind(orderId, now).run();

  return Response.json({ ok: true, payment_id: paymentId, checkout_url: checkoutData.payment_url, invoice_id: invoiceId }, { status: 201 });
}
