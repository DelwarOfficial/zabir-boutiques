/**
 * POST /api/staff/orders/:id/pack — Advance a confirmed order into packing.
 *
 * Transition: staff_confirmed → packing (state-machine guarded, no stock effect).
 * RBAC: orders.pack
 *
 * Fixes the dead "Mark Packing" button on staff/orders/[id].astro which
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
    requirePermission(user, 'orders.pack');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const order = await env.DB.prepare(
    `SELECT id, status FROM orders WHERE id = ?1`,
  ).bind(orderId).first<{ id: string; status: string }>();

  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });

  // Idempotent: already packing (or beyond) returns success no-op.
  if (order.status === 'packing') {
    return Response.json({ ok: true, status: 'packing', alreadyPacking: true }, { status: 200 });
  }

  if (!canTransition(order.status as OrderStatus, 'packing')) {
    return Response.json(
      { ok: false, code: 'INVALID_TRANSITION', error: `Cannot move ${order.status} → packing.`, status: order.status },
      { status: 409 },
    );
  }

  const now = nowSql();
  // Status guard prevents a concurrent double-transition.
  const update = await env.DB.prepare(
    `UPDATE orders SET status = 'packing', updated_at = ?2 WHERE id = ?1 AND status = ?3`,
  ).bind(orderId, now, order.status).run();

  if (update.meta.changes !== 1) {
    return Response.json({ ok: false, code: 'STATUS_RACE', status: order.status }, { status: 409 });
  }

  await env.DB.prepare(
    `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, created_at)
     VALUES (?1, ?2, ?3, 'packing', ?4, ?5)`,
  ).bind(crypto.randomUUID(), orderId, order.status, user.id, now).run();

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'orders.pack',
    entityType: 'order',
    entityId: orderId,
    metadata: { from_status: order.status, to_status: 'packing' },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({ ok: true, status: 'packing' }, { status: 200 });
}
