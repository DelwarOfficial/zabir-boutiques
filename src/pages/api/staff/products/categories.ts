import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission } from '../../../../lib/rbac';
import type { Category } from '../../../../types/product';

export async function GET(context: APIContext): Promise<Response> {
  const user = await requireAuth(context);
  requirePermission(user, 'products.manage');

  const env = getEnv(context);
  const rows = await env.DB.prepare(
    `SELECT id, name, slug, parent_id, sort_order, is_active
     FROM categories
     WHERE is_active = 1
     ORDER BY sort_order ASC, name ASC`
  ).all<any>();

  const categories: Category[] = (rows.results ?? []).map(r => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    parentId: r.parent_id ?? null,
    sortOrder: r.sort_order ?? 0,
    isActive: r.is_active === 1,
  }));

  return Response.json({ ok: true, categories });
}
