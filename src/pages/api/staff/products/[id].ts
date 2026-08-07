import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission } from '../../../../lib/rbac';
import { writeCriticalAuditLog, clientIp, userAgent } from '../../../../lib/audit';
import { nowSql } from '../../../../lib/dates';

type ProductStatus = 'draft' | 'published' | 'archived';

interface ProductUpdateBody {
  name?: string;
  slug?: string;
  description?: string | null;
  categoryId?: string | null;
  pricePaisa?: number;
  comparePricePaisa?: number | null;
  status?: ProductStatus;
  isFeatured?: boolean;
  metaTitle?: string | null;
  metaDescription?: string | null;
}

function slugify(value: string): string {
  return value.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || 'untitled';
}

function cleanNullable(value: unknown, max: number): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

export async function PATCH(context: APIContext): Promise<Response> {
  const user = await requireAuth(context);
  requirePermission(user, 'products.manage');

  const env = getEnv(context);
  const { id } = context.params;
  if (!id) return Response.json({ ok: false, error: 'Product ID is required' }, { status: 400 });

  const existing = await env.DB.prepare(
    `SELECT id, name, slug, status FROM products WHERE id = ?1`
  ).bind(id).first<{ id: string; name: string; slug: string; status: ProductStatus }>();
  if (!existing) return Response.json({ ok: false, error: 'Product not found' }, { status: 404 });

  let body: ProductUpdateBody;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : existing.name;
  if (!name) return Response.json({ ok: false, error: 'Product name is required' }, { status: 400 });
  if (name.length > 500) return Response.json({ ok: false, error: 'Product name too long (max 500 chars)' }, { status: 400 });

  let slug = typeof body.slug === 'string' && body.slug.trim() ? slugify(body.slug) : existing.slug;
  if (!slug) slug = slugify(name);
  const slugConflict = await env.DB.prepare(
    `SELECT 1 FROM products WHERE slug = ?1 AND id != ?2`
  ).bind(slug, id).first();
  if (slugConflict) return Response.json({ ok: false, error: 'Slug already exists' }, { status: 409 });

  const categoryId = body.categoryId === undefined ? undefined : cleanNullable(body.categoryId, 64);
  if (categoryId) {
    const category = await env.DB.prepare(
      `SELECT 1 FROM categories WHERE id = ?1 AND is_active = 1`
    ).bind(categoryId).first();
    if (!category) return Response.json({ ok: false, error: 'Invalid category' }, { status: 400 });
  }

  const status = body.status ?? existing.status;
  if (!['draft', 'published', 'archived'].includes(status)) {
    return Response.json({ ok: false, error: 'Invalid product status' }, { status: 400 });
  }

  const pricePaisa = body.pricePaisa;
  if (pricePaisa !== undefined && (!Number.isFinite(pricePaisa) || pricePaisa < 0)) {
    return Response.json({ ok: false, error: 'pricePaisa must be a non-negative number' }, { status: 400 });
  }
  const comparePricePaisa = body.comparePricePaisa;
  if (comparePricePaisa !== undefined && comparePricePaisa !== null && (!Number.isFinite(comparePricePaisa) || comparePricePaisa < 0)) {
    return Response.json({ ok: false, error: 'comparePricePaisa must be null or a non-negative number' }, { status: 400 });
  }

  const now = nowSql();
  await env.DB.prepare(
    `UPDATE products
     SET name = ?2,
         slug = ?3,
         description = COALESCE(?4, description),
         category_id = CASE WHEN ?5 = '__UNCHANGED__' THEN category_id ELSE ?5 END,
         price_paisa = COALESCE(?6, price_paisa),
         compare_price_paisa = CASE WHEN ?7 = '__UNCHANGED__' THEN compare_price_paisa ELSE ?7 END,
         status = ?8,
         is_featured = COALESCE(?9, is_featured),
         meta_title = CASE WHEN ?10 = '__UNCHANGED__' THEN meta_title ELSE ?10 END,
         meta_description = CASE WHEN ?11 = '__UNCHANGED__' THEN meta_description ELSE ?11 END,
         updated_at = ?12
     WHERE id = ?1`
  ).bind(
    id,
    name,
    slug,
    body.description === undefined ? null : cleanNullable(body.description, 10000),
    categoryId === undefined ? '__UNCHANGED__' : categoryId,
    pricePaisa === undefined ? null : Math.floor(pricePaisa),
    comparePricePaisa === undefined ? '__UNCHANGED__' : (comparePricePaisa === null ? null : Math.floor(comparePricePaisa)),
    status,
    body.isFeatured === undefined ? null : (body.isFeatured ? 1 : 0),
    body.metaTitle === undefined ? '__UNCHANGED__' : cleanNullable(body.metaTitle, 500),
    body.metaDescription === undefined ? '__UNCHANGED__' : cleanNullable(body.metaDescription, 1000),
    now,
  ).run();

  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'product.update',
    entityType: 'product',
    entityId: id,
    metadata: { previous: existing, update: body },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({ ok: true, productId: id });
}

export async function DELETE(context: APIContext): Promise<Response> {
  const user = await requireAuth(context);
  requirePermission(user, 'products.manage');

  const env = getEnv(context);
  const { id } = context.params;
  if (!id) return Response.json({ ok: false, error: 'Product ID is required' }, { status: 400 });

  const existing = await env.DB.prepare(
    `SELECT id, name, status FROM products WHERE id = ?1`
  ).bind(id).first<{ id: string; name: string; status: ProductStatus }>();
  if (!existing) return Response.json({ ok: false, error: 'Product not found' }, { status: 404 });

  const now = nowSql();
  await env.DB.batch([
    env.DB.prepare(`UPDATE products SET status = 'archived', is_featured = 0, updated_at = ?2 WHERE id = ?1`).bind(id, now),
    env.DB.prepare(`UPDATE product_variants SET is_deleted = 1, updated_at = ?2 WHERE product_id = ?1`).bind(id, now),
  ], { atomic: true });

  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'product.archive',
    entityType: 'product',
    entityId: id,
    metadata: { previous: existing, archivedVariants: true },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({ ok: true, productId: id, status: 'archived' });
}
