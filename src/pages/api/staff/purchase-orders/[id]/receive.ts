/**
 * POST /api/staff/purchase-orders/:id/receive — Receive stock against a PO
 * (T-26, RT-003). The only legal way opening stock / restocked supply
 * enters the system besides a customer return — routes through
 * doAdjustStock exactly like returns/approve.ts, with a deterministic
 * per-(PO, variant) idempotency key so a retry cannot double-stock.
 *
 * Body: { items: Array<{ variant_id: string; quantity: number; unit_cost_paisa: number }> }
 * RBAC: inventory.adjust
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../../lib/env';
import { nowSql } from '../../../../../lib/dates';
import { requireAuth, requirePermission, RbacError } from '../../../../../lib/rbac';
import { doAdjustStock } from '../../../../../lib/do-client';
import { writeAuditLog, clientIp, userAgent } from '../../../../../lib/audit';
import { safeLog } from '../../../../../lib/pii-scrubber';

interface ReceiveItem {
  variant_id: string;
  quantity: number;
  unit_cost_paisa: number;
}

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const poId = context.params.id;
  if (!poId) return Response.json({ ok: false, error: 'Missing purchase order ID' }, { status: 400 });

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'inventory.adjust');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let body: { items?: ReceiveItem[] };
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ ok: false, code: 'EMPTY_ITEMS' }, { status: 400 });
  }
  for (const item of items) {
    if (typeof item.variant_id !== 'string' || !Number.isSafeInteger(item.quantity) || item.quantity <= 0
      || !Number.isSafeInteger(item.unit_cost_paisa) || item.unit_cost_paisa < 0) {
      return Response.json({ ok: false, code: 'INVALID_ITEM' }, { status: 400 });
    }
  }

  const po = await env.DB.prepare(
    `SELECT id, status FROM purchase_orders WHERE id = ?1`,
  ).bind(poId).first<{ id: string; status: string }>();
  if (!po) return Response.json({ ok: false, code: 'PO_NOT_FOUND' }, { status: 404 });
  if (po.status === 'cancelled') {
    return Response.json({ ok: false, code: 'PO_CANCELLED' }, { status: 409 });
  }
  if (po.status === 'received') {
    // Idempotent no-op: the PO was already fully received (possibly by a
    // retried request). Not an error.
    return Response.json({ ok: true, code: 'ALREADY_RECEIVED', purchase_order_id: poId }, { status: 200 });
  }

  const now = nowSql();
  let totalCostPaisa = 0;

  for (const item of items) {
    const adjustmentId = `po:${poId}:${item.variant_id}`;
    const result = await doAdjustStock(env, item.variant_id, item.quantity, 'received', user.id, undefined, adjustmentId);
    if (!result.ok) {
      safeLog.error('[purchase-orders/receive] adjustStock failed', { variantId: item.variant_id, error: result.error });
      return Response.json({ ok: false, code: 'RECEIVE_FAILED', variant_id: item.variant_id, error: result.error }, { status: 409 });
    }

    // Idempotent per (purchase_order_id, variant_id) via the unique index
    // on adjustment_id — a retry that already applied the stock update
    // (doAdjustStock no-ops on replay) also no-ops this ledger row.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO goods_receipts
         (id, purchase_order_id, variant_id, quantity, unit_cost_paisa, adjustment_id, received_by_staff_id, received_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(crypto.randomUUID(), poId, item.variant_id, item.quantity, item.unit_cost_paisa, adjustmentId, user.id, now).run();

    totalCostPaisa += item.quantity * item.unit_cost_paisa;
  }

  await env.DB.prepare(
    `UPDATE purchase_orders SET status = 'received', total_cost_paisa = ?2, updated_at = ?3 WHERE id = ?1 AND status != 'received'`,
  ).bind(poId, totalCostPaisa, now).run();

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'purchase_order.receive',
    entityType: 'purchase_order',
    entityId: poId,
    metadata: { item_count: items.length, total_cost_paisa: totalCostPaisa },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({ ok: true, purchase_order_id: poId, status: 'received', total_cost_paisa: totalCostPaisa }, { status: 200 });
}
