/**
 * POST /api/staff/orders/:id/courier — Create courier shipment and mark order shipped.
 *
 * Body: { provider: 'pathao' | 'steadfast' | 'redx', mock?: boolean }
 * RBAC: orders.ship
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../../lib/env';
import { nowSql } from '../../../../../lib/dates';
import { requireAuth, requirePermission, RbacError } from '../../../../../lib/rbac';
import { writeAuditLog, clientIp, userAgent } from '../../../../../lib/audit';
import { createCourierClient, validateProvider } from '../../../../../lib/integrations/courier';
import type { CourierEnv } from '../../../../../lib/integrations/courier/types';

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

  let body: { provider?: string; mock?: boolean };
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const provider = validateProvider(body.provider ?? '');
  if (!provider) {
    return Response.json({ error: 'Invalid courier provider', code: 'INVALID_PROVIDER' }, { status: 400 });
  }

  const order = await env.DB.prepare(
    `SELECT id, order_number, name, phone, address, shipping_zone, status,
            total_paisa, balance_paisa, advance_paisa, note,
            courier_tracking_number
     FROM orders WHERE id = ?1`,
  ).bind(orderId).first<{
    id: string;
    order_number: string;
    name: string;
    phone: string;
    address: string;
    shipping_zone: string | null;
    status: string;
    total_paisa: number;
    balance_paisa: number;
    advance_paisa: number;
    note: string | null;
    courier_tracking_number: string | null;
  }>();

  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });

  if (order.courier_tracking_number) {
    return Response.json({
      ok: true,
      code: 'ALREADY_HANDED_OFF',
      trackingNumber: order.courier_tracking_number,
    });
  }

  if (!['packing', 'staff_confirmed'].includes(order.status)) {
    return Response.json({
      error: 'Order is not ready for courier handoff',
      code: 'INVALID_STATUS',
      status: order.status,
    }, { status: 409 });
  }

  const itemCount = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM order_items WHERE order_id = ?1`,
  ).bind(orderId).first<{ count: number }>();

  const codAmountPaisa = order.balance_paisa > 0 ? order.balance_paisa : order.total_paisa;
  const city = order.shipping_zone?.trim() || 'Dhaka';

  const client = createCourierClient(provider, env as CourierEnv, { mock: body.mock === true });
  const shipment = await client.createShipment({
    orderId: order.order_number,
    recipientName: order.name,
    recipientPhone: order.phone,
    recipientAddress: order.address,
    recipientCity: city,
    recipientZone: city,
    codAmountPaisa,
    weight: 0.5,
    itemCount: itemCount?.count ?? 1,
    specialNote: order.note ?? undefined,
  });

  if (!shipment.ok || !shipment.trackingNumber) {
    return Response.json({
      ok: false,
      code: shipment.errorCode ?? 'COURIER_CREATE_FAILED',
    }, { status: 502 });
  }

  const now = nowSql();
  const update = await env.DB.prepare(
    `UPDATE orders
     SET status = 'shipped',
         courier_provider = ?2,
         courier_tracking_number = ?3,
         courier_handoff_at = ?4,
         updated_at = ?4
     WHERE id = ?1 AND status IN ('packing', 'staff_confirmed')`,
  ).bind(orderId, provider, shipment.trackingNumber, now).run();

  if (update.meta.changes !== 1) {
    return Response.json({ ok: false, code: 'STATUS_RACE' }, { status: 409 });
  }

  await env.DB.prepare(
    `INSERT INTO order_status_history (id, order_id, from_status, to_status, note, created_at)
     VALUES (?1, ?2, ?3, 'shipped', ?4, ?5)`,
  ).bind(
    crypto.randomUUID(),
    orderId,
    order.status,
    `Courier handoff via ${provider}: ${shipment.trackingNumber}`,
    now,
  ).run();

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'order.courier_handoff',
    entityType: 'order',
    entityId: orderId,
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
    metadata: { provider, tracking_number: shipment.trackingNumber },
  });

  return Response.json({
    ok: true,
    provider,
    trackingNumber: shipment.trackingNumber,
    status: 'shipped',
  });
}