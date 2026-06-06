export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../../../lib/env';
import { hashSessionToken } from '../../../../../lib/sessions';
import { nowSql } from '../../../../../lib/dates';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const orderId = context.params.id;
  const now = nowSql();

  if (!orderId) return Response.json({ error: 'Missing order ID' }, { status: 400 });

  const cookie = context.request.headers.get('Cookie') ?? '';
  const match = cookie.match(new RegExp('(?:^|;\\s*)session=([^;]+)'));
  const sessionToken = match ? decodeURIComponent(match[1]) : null;
  if (!sessionToken) return Response.json({ error: 'Not authenticated' }, { status: 401 });

  const tokenHash = await hashSessionToken(sessionToken, env.SESSION_SECRET);
  const session = await env.DB.prepare(
    `SELECT s.staff_user_id, u.role, u.full_name
     FROM staff_sessions s JOIN staff_users u ON u.id = s.staff_user_id
     WHERE s.token_hash = ?1 AND s.is_revoked = 0 AND s.expires_at > ?2 AND u.is_active = 1`
  ).bind(tokenHash, now).first<{ staff_user_id: string; role: string; full_name: string }>();

  if (!session) return Response.json({ error: 'Invalid session' }, { status: 401 });
  if (session.role === 'viewer' || session.role === 'support_agent') {
    return Response.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const order = await env.DB.prepare(
    `SELECT id, status, payment_status FROM orders WHERE id = ?1`
  ).bind(orderId).first<{ id: string; status: string; payment_status: string }>();

  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });

  if (order.status === 'pending_review' || order.status === 'pending_payment') {
    const reservations = await env.DB.prepare(
      `SELECT id, variant_id, quantity FROM stock_reservations
       WHERE order_id = ?1 AND status = 'active'`
    ).bind(orderId).all<{ id: string; variant_id: string; quantity: number }>();

    if (reservations.results && reservations.results.length > 0) {
      const deductStmts = reservations.results.map(r =>
        env.DB.prepare(
          `UPDATE inventory_items
           SET reserved_quantity = reserved_quantity - ?1,
               quantity = quantity - ?1,
               updated_at = ?3
           WHERE variant_id = ?2 AND reserved_quantity >= ?1`
        ).bind(r.quantity, r.variant_id, now)
      );
      const confirmStmts = reservations.results.map(r =>
        env.DB.prepare(
          `UPDATE stock_reservations SET status = 'confirmed', updated_at = ?2 WHERE id = ?1`
        ).bind(r.id, now)
      );
      await env.DB.batch([...deductStmts, ...confirmStmts]);
    }

    await env.DB.prepare(
      `UPDATE orders SET status = 'staff_confirmed', updated_at = ?2 WHERE id = ?1`
    ).bind(orderId, now).run();
  } else {
    await env.DB.prepare(
      `UPDATE orders SET status = 'staff_confirmed', updated_at = ?2 WHERE id = ?1`
    ).bind(orderId, now).run();
  }

  await env.DB.prepare(
    `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, created_at)
     VALUES (?1, ?2, ?3, 'staff_confirmed', ?4, ?5)`
  ).bind(crypto.randomUUID(), orderId, order.status, session.staff_user_id, now).run();

  return Response.json({ ok: true, status: 'staff_confirmed' }, { status: 200 });
}
