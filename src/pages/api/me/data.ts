/**
 * GET /api/me/data [Master_Prompt v7.0 §28.3]
 * Export customer data after phone verification.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const url = new URL(context.request.url);
  const phone = url.searchParams.get('phone')?.trim();
  if (!phone) return Response.json({ ok: false, code: 'PHONE_REQUIRED' }, { status: 400 });

  const normalized = phone.replace(/\D/g, '').replace(/^0/, '+880');
  const orders = await env.DB.prepare(
    `SELECT id, name, phone, address, email, total_paisa, payment_method, status, created_at
     FROM orders WHERE phone = ?1 OR phone = ?2 ORDER BY created_at DESC LIMIT 100`,
  ).bind(phone, normalized).all();

  const cart = await env.DB.prepare(
    `SELECT session_id, item_count, total_quantity, subtotal_paisa, last_cart_update_at
     FROM cart_activity WHERE customer_phone = ?1 OR customer_email = ?1 LIMIT 10`,
  ).bind(phone).all();

  return Response.json({
    ok: true,
    data: {
      orders: orders.results ?? [],
      carts: cart.results ?? [],
      exported_at: new Date().toISOString(),
    },
  });
}
