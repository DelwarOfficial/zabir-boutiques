/**
 * GET /api/payments/status/[id] — Payment Status [v6.8A]
 * D1 read, optional provider verification.
 *
 * K-04: ownership proof required (phone + order_number query params,
 * same pattern as /api/orders/track) — payment id alone is not a secret
 * (K-03 lets a client choose it) and must not authorize disclosure.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { normalizeBangladeshPhone } from '../../../../lib/phone';

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const paymentId = context.params.id;

  if (!paymentId) {
    return Response.json({ error: 'Missing payment ID' }, { status: 400 });
  }

  const url = new URL(context.request.url);
  const phoneResult = normalizeBangladeshPhone(url.searchParams.get('phone') ?? '');
  const orderNumber = url.searchParams.get('order_number');
  if (!phoneResult.ok || !orderNumber) {
    return Response.json({ error: 'Missing phone or order_number' }, { status: 400 });
  }

  const payment = await env.DB.prepare(
    `SELECT p.id, p.order_id, p.invoice_id, p.status, p.amount_paisa, p.created_at, p.verified_at
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.id = ?1 AND o.order_number = ?2 AND o.phone = ?3`
  ).bind(paymentId, orderNumber, phoneResult.phone).first();

  if (!payment) {
    return Response.json({ error: 'Payment not found' }, { status: 404 });
  }

  return Response.json({ payment });
}
