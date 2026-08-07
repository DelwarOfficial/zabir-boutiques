import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission } from '../../../../lib/rbac';
import type { InventoryMovement } from '../../../../types/inventory';
import { ADJUSTMENT_REASONS } from '../../../../types/inventory';

export async function GET(context: APIContext): Promise<Response> {
  const user = await requireAuth(context);
  requirePermission(user, 'inventory.manage');

  const env = getEnv(context);
  const url = new URL(context.request.url);
  const variantId = url.searchParams.get('variantId')?.trim() || '';
  const reason = url.searchParams.get('reason')?.trim() || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
  const offset = (page - 1) * limit;

  let where = 'WHERE pv.is_deleted = 0';
  const params: any[] = [];
  let paramIdx = 1;

  if (variantId) {
    where += ` AND sa.variant_id = ?${paramIdx++}`;
    params.push(variantId);
  }
  if (reason) {
    where += ` AND sa.reason = ?${paramIdx++}`;
    params.push(reason);
  }

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM stock_adjustments sa
     JOIN product_variants pv ON pv.id = sa.variant_id
     ${where}`
  ).bind(...params).first<{ total: number }>();

  const total = countRow?.total ?? 0;

  const rows = await env.DB.prepare(
    `SELECT sa.id, sa.variant_id, sa.delta, sa.reason,
            sa.prev_quantity, sa.new_quantity, sa.notes,
            sa.adjusted_by, sa.created_at,
            pv.sku, pv.size, pv.color,
            p.name as product_name,
            su.full_name as adjusted_by_name
     FROM stock_adjustments sa
     JOIN product_variants pv ON pv.id = sa.variant_id
     JOIN products p ON p.id = pv.product_id
     LEFT JOIN staff_users su ON su.id = sa.adjusted_by
     ${where}
     ORDER BY sa.created_at DESC
     LIMIT ?${paramIdx++} OFFSET ?${paramIdx++}`
  ).bind(...params, limit, offset).all<any>();

  const movements: InventoryMovement[] = (rows.results ?? []).map(r => ({
    id: r.id,
    variantId: r.variant_id,
    productName: r.product_name,
    sku: r.sku,
    size: r.size ?? null,
    color: r.color ?? null,
    delta: r.delta,
    reason: r.reason,
    prevQuantity: r.prev_quantity ?? null,
    newQuantity: r.new_quantity ?? null,
    notes: r.notes ?? null,
    adjustedBy: r.adjusted_by ?? null,
    adjustedByName: r.adjusted_by_name ?? null,
    createdAt: r.created_at,
  }));

  return Response.json({
    ok: true,
    movements,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    reasons: ADJUSTMENT_REASONS.map(r => ({ value: r.value, label: r.label })),
  });
}
