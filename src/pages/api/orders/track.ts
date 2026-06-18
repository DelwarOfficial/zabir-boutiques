/**
 * POST /api/orders/track — Order Tracking [v6.8A]
 * Rate limit, phone normalization.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { normalizeBangladeshPhone } from '../../../lib/phone';

const phoneErrorMessage = 'Invalid Bangladeshi mobile number. Enter 11 digits starting with 01X.';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const phoneResult = normalizeBangladeshPhone(body.phone ?? '');
  if (!phoneResult.ok) {
    return Response.json({ error: phoneResult.reason === 'EMPTY' ? 'Missing phone' : phoneErrorMessage }, { status: 400 });
  }

  const orderNumber = body.order_number;
  if (!orderNumber || typeof orderNumber !== 'string') {
    return Response.json({ error: 'Missing order_number' }, { status: 400 });
  }

  const order = await env.DB.prepare(
    `SELECT order_number, status, payment_status, total_paisa, created_at, updated_at
     FROM orders
     WHERE order_number = ?1 AND phone = ?2`
  ).bind(orderNumber, phoneResult.phone).first();

  if (!order) {
    return Response.json({ error: 'Order not found' }, { status: 404 });
  }

  return Response.json({ order });
}
