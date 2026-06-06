export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { nowSql } from '../../../lib/dates';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let body: any;
  try { body = await context.request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const orderId = body.order_id;
  if (!orderId) return Response.json({ error: 'Missing order_id' }, { status: 400 });

  const order = await env.DB.prepare(
    `SELECT id, total_paisa, payment_method, payment_status FROM orders WHERE id = ?1`
  ).bind(orderId).first<{ id: string; total_paisa: number; payment_method: string; payment_status: string }>();

  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });
  if (order.payment_method !== 'uddoktapay') {
    return Response.json({ error: 'Order is not set for online payment' }, { status: 400 });
  }
  if (order.payment_status !== 'created' && order.payment_status !== 'pending') {
    return Response.json({ error: 'Payment already initiated' }, { status: 409 });
  }

  const invoiceId = crypto.randomUUID();
  const checkoutRes = await fetch(`${env.UDDOKTAPAY_BASE_URL}/api/checkout`, {
    method: 'POST',
    headers: {
      'RT-UDDOKTAPAY-API-KEY': env.UDDOKTAPAY_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      invoice_id: invoiceId,
      amount: (order.total_paisa / 100).toFixed(2),
      currency: 'BDT',
      customer_name: body.customer_name ?? '',
      customer_phone: body.customer_phone ?? '',
      redirect_url: `${body.redirect_url ?? env.PUBLIC_SITE_URL}/order-track`,
      cancel_url: `${body.cancel_url ?? env.PUBLIC_SITE_URL}/checkout`
    })
  });

  const checkoutData = await checkoutRes.json().catch(() => ({})) as any;
  if (!checkoutRes.ok || !checkoutData?.payment_url) {
    return Response.json({ error: 'Payment provider error', details: checkoutData }, { status: 502 });
  }

  const paymentId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO payments (id, order_id, invoice_id, provider, amount_paisa, status, checkout_url, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'uddoktapay', ?4, 'pending', ?5, ?6, ?6)`
  ).bind(paymentId, orderId, invoiceId, order.total_paisa, checkoutData.payment_url, now).run();

  await env.DB.prepare(
    `UPDATE orders SET payment_status = 'pending', updated_at = ?2 WHERE id = ?1`
  ).bind(orderId, now).run();

  return Response.json({ ok: true, payment_id: paymentId, checkout_url: checkoutData.payment_url, invoice_id: invoiceId }, { status: 201 });
}
