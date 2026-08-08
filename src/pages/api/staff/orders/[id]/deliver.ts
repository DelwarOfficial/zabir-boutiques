/**
 * POST /api/staff/orders/:id/deliver — Mark a shipped order delivered.
 *
 * Transition: shipped → delivered (state-machine guarded), mirroring the
 * ship.ts / courier.ts pattern. For COD orders, captures the cash the
 * courier collected on delivery (T-24, F-03) — distinct from the handoff
 * step in courier.ts, which only records that a parcel left the shop.
 * This is what courier_cod_remittance reconciles against later.
 *
 * Body: { cod_collected_paisa?: number }  — required for payment_method='cod'
 * RBAC: orders.ship
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

  let body: { cod_collected_paisa?: number };
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }

  const order = await env.DB.prepare(
    `SELECT id, status, payment_method, total_paisa, balance_paisa FROM orders WHERE id = ?1`,
  ).bind(orderId).first<{ id: string; status: string; payment_method: string; total_paisa: number; balance_paisa: number }>();

  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });

  if (order.status === 'delivered') {
    return Response.json({ ok: true, status: 'delivered', alreadyDelivered: true }, { status: 200 });
  }

  if (!canTransition(order.status as OrderStatus, 'delivered')) {
    return Response.json(
      { ok: false, code: 'INVALID_TRANSITION', error: `Cannot move ${order.status} → delivered.`, status: order.status },
      { status: 409 },
    );
  }

  // COD (or partial-prepay with a COD balance) requires the amount actually
  // collected — it is not assumed to equal the order total, because a
  // courier can under-collect or the customer can pay a different amount
  // at the door. This is the figure courier_cod_remittance reconciles.
  const requiresCodAmount = (order.payment_method === 'cod' || order.balance_paisa > 0);
  let codCollectedPaisa: number | null = null;
  if (requiresCodAmount) {
    if (typeof body.cod_collected_paisa !== 'number' || !Number.isSafeInteger(body.cod_collected_paisa) || body.cod_collected_paisa < 0) {
      return Response.json({ ok: false, code: 'COD_AMOUNT_REQUIRED', error: 'cod_collected_paisa is required for this order.' }, { status: 400 });
    }
    codCollectedPaisa = body.cod_collected_paisa;
  }

  const now = nowSql();
  const update = await env.DB.prepare(
    `UPDATE orders SET status = 'delivered', cod_collected_paisa = ?2, updated_at = ?3
     WHERE id = ?1 AND status = ?4`,
  ).bind(orderId, codCollectedPaisa, now, order.status).run();

  if (update.meta.changes !== 1) {
    return Response.json({ ok: false, code: 'STATUS_RACE', status: order.status }, { status: 409 });
  }

  await env.DB.prepare(
    `INSERT INTO order_status_history (id, order_id, from_status, to_status, note, changed_by, created_at)
     VALUES (?1, ?2, ?3, 'delivered', ?4, ?5, ?6)`,
  ).bind(crypto.randomUUID(), orderId, order.status, codCollectedPaisa !== null ? `COD collected: ${codCollectedPaisa}` : null, user.id, now).run();

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'orders.deliver',
    entityType: 'order',
    entityId: orderId,
    metadata: { from_status: order.status, to_status: 'delivered', cod_collected_paisa: codCollectedPaisa },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({ ok: true, status: 'delivered', cod_collected_paisa: codCollectedPaisa }, { status: 200 });
}
