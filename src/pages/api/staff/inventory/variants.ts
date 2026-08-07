import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission } from '../../../../lib/rbac';
import type { InventoryVariant } from '../../../../types/inventory';

export async function GET(context: APIContext): Promise<Response> {
  const user = await requireAuth(context);
  requirePermission(user, 'inventory.manage');

  const env = getEnv(context);
  const url = new URL(context.request.url);
  const search = url.searchParams.get('search')?.trim() || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
  const offset = (page - 1) * limit;

  const searchPattern = search ? `%${search}%` : '%';

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.is_deleted = 0
     AND (v.sku LIKE ?1 OR p.name LIKE ?1 OR v.size LIKE ?1 OR v.color LIKE ?1)`
  ).bind(searchPattern).first<{ total: number }>();

  const total = countRow?.total ?? 0;

  const rows = await env.DB.prepare(
    `SELECT v.id, v.product_id, p.name as product_name, v.sku, v.size, v.color,
            v.price_paisa, v.stock as quantity, v.reserved, v.sold, v.available,
            COALESCE(i.is_available, 1) as is_available
     FROM variants v
     JOIN products p ON p.id = v.product_id
     LEFT JOIN inventory_items i ON i.variant_id = v.id
     WHERE v.is_deleted = 0
     AND (v.sku LIKE ?1 OR p.name LIKE ?1 OR v.size LIKE ?1 OR v.color LIKE ?1)
     ORDER BY p.name ASC, v.sku ASC
     LIMIT ?2 OFFSET ?3`
  ).bind(searchPattern, limit, offset).all<any>();

  const variants: InventoryVariant[] = (rows.results ?? []).map(r => ({
    id: r.id,
    variantId: r.id,
    productId: r.product_id,
    productName: r.product_name,
    sku: r.sku,
    size: r.size ?? null,
    color: r.color ?? null,
    pricePaisa: r.price_paisa ?? 0,
    quantity: r.quantity ?? 0,
    reserved: r.reserved ?? 0,
    sold: r.sold ?? 0,
    available: r.available ?? 0,
    isAvailable: r.is_available ?? 1,
  }));

  return Response.json({
    ok: true,
    variants,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
