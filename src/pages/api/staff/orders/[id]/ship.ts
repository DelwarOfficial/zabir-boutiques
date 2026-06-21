/**
 * POST /api/staff/orders/:id/ship — Manually mark a packed order shipped.
 *
 * Transition: packing → shipped (state-machine guarded). This is the
 * manual handoff path for orders shipped WITHOUT a courier-API integration
 * (the courier.ts route handles API-backed shipments + tracking numbers).
 * RBAC: orders.ship
 *
 * Fixes the dead "Mark Shipped" button on staff/orders/[id].astro which
 * POSTed to this route while it did not exist (404).
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../../lib/env';
import { nowSql } from '../../../../../lib/dates';
import { requireAuth, requirePermission, RbacError } from '../../../../../lib/rbac';
import { writeAuditLog, clientIp, userAgent } from '../../../../../lib/audit';
import { canTransition, type OrderStatus } from '../../../../../lib/order-state-machine';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const orderId = context.params.id;
  if (!orderId) return Response.json({ error: 'Missing order ID' }, { status: 400 });

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'orders.ship');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const order = await env.DB.prepare(
    `SELECT id, status, courier_tracking_number FROM orders WHERE id = ?1`,
  ).bind(orderId).first<{ id: string; status: string; courier_tracking_number: string | null }>();

  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });

  // Idempotent: already shipped returns success no-op.
  if (order.status === 'shipped') {
    return Response.json({ ok: true, status: 'shipped', alreadyShipped: true }, { status: 200 });
  }

  if (!canTransition(order.status as OrderStatus, 'shipped')) {
    return Response.json(
      { ok: false, code: 'INVALID_TRANSITION', error: `Cannot move ${order.status} → shipped.`, status: order.status },
      { status: 409 },
    );
  }

  const now = nowSql();
  const update = await env.DB.prepare(
    `UPDATE orders SET status = 'shipped', courier_handoff_at = ?2, updated_at = ?2
     WHERE id = ?1 AND status = ?3`,
  ).bind(orderId, now, order.status).run();

  if (update.meta.changes !== 1) {
    return Response.json({ ok: false, code: 'STATUS_RACE', status: order.status }, { status: 409 });
  }

  await env.DB.prepare(
    `INSERT INTO order_status_history (id, order_id, from_status, to_status, note, changed_by, created_at)
     VALUES (?1, ?2, ?3, 'shipped', ?4, ?5, ?6)`,
  ).bind(crypto.randomUUID(), orderId, order.status, 'Manual ship (no courier API)', user.id, now).run();

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'orders.ship',
    entityType: 'order',
    entityId: orderId,
    metadata: { from_status: order.status, to_status: 'shipped', manual: true },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({ ok: true, status: 'shipped' }, { status: 200 });
}
