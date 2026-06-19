/**
 * GET /api/me/data [Master_Prompt v7.0 §28.3]
 * Export customer data after phone verification.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { extractBearerToken, verifyPhoneToken } from '../../../lib/phone-verification';
import { normalizeBangladeshPhone } from '../../../lib/phone';

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const url = new URL(context.request.url);
  const phone = url.searchParams.get('phone')?.trim();
  if (!phone) return Response.json({ ok: false, code: 'PHONE_REQUIRED' }, { status: 400 });

  const token = extractBearerToken(context.request);
  const verified = await verifyPhoneToken(token ?? '', env.SESSION_SECRET);
  if (!verified.valid) {
    return Response.json({ ok: false, code: 'PHONE_VERIFICATION_REQUIRED' }, { status: 401 });
  }

  const normalized = normalizeBangladeshPhone(phone);
  if (!normalized.ok || normalized.phone !== verified.phone) {
    return Response.json({ ok: false, code: 'PHONE_TOKEN_MISMATCH' }, { status: 403 });
  }

  const localPhone = normalized.local;
  const e164Phone = normalized.phone;
  const orders = await env.DB.prepare(
    `SELECT id, name, phone, address, email, total_paisa, payment_method, status, created_at
     FROM orders WHERE phone = ?1 OR phone = ?2 ORDER BY created_at DESC LIMIT 100`,
  ).bind(e164Phone, localPhone).all();

  const cart = await env.DB.prepare(
    `SELECT session_id, item_count, total_quantity, subtotal_paisa, last_cart_update_at
     FROM cart_activity WHERE customer_phone = ?1 OR customer_phone = ?2 LIMIT 10`,
  ).bind(e164Phone, localPhone).all();

  return Response.json({
    ok: true,
    data: {
      orders: orders.results ?? [],
      carts: cart.results ?? [],
      exported_at: new Date().toISOString(),
    },
  });
}
