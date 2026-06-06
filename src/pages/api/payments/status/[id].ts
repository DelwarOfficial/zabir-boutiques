/**
 * GET /api/payments/status/[id] — Payment Status [v6.8A]
 * D1 read, optional provider verification.
 */
export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const paymentId = context.params.id;

  if (!paymentId) {
    return Response.json({ error: 'Missing payment ID' }, { status: 400 });
  }

  const payment = await env.DB.prepare(
    `SELECT id, order_id, invoice_id, status, amount_paisa, created_at, verified_at
     FROM payments WHERE id = ?1`
  ).bind(paymentId).first();

  if (!payment) {
    return Response.json({ error: 'Payment not found' }, { status: 404 });
  }

  return Response.json({ payment });
}
