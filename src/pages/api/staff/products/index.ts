import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission } from '../../../../lib/rbac';
import { writeCriticalAuditLog, clientIp, userAgent } from '../../../../lib/audit';
import { nowSql } from '../../../../lib/dates';
import type { CreateProductInput, CreateProductResult } from '../../../../types/product';

function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || 'untitled';
}

async function skuExists(db: D1Database, sku: string, excludeId?: string): Promise<boolean> {
  const row = excludeId
    ? await db.prepare('SELECT 1 FROM product_variants WHERE sku = ?1 AND id != ?2 AND is_deleted = 0').bind(sku, excludeId).first()
    : await db.prepare('SELECT 1 FROM product_variants WHERE sku = ?1 AND is_deleted = 0').bind(sku).first();
  return !!row;
}

export async function POST(context: APIContext): Promise<Response> {
  const user = await requireAuth(context);
  requirePermission(user, 'products.manage');

  const env = getEnv(context);
  const now = nowSql();

  let body: CreateProductInput;
  try { body = await context.request.json(); } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  if (!name) return Response.json({ ok: false, error: 'Product name is required' }, { status: 400 });
  if (name.length > 500) return Response.json({ ok: false, error: 'Product name too long (max 500 chars)' }, { status: 400 });

  const description = body.description?.trim() || null;
  if (description && description.length > 10000) return Response.json({ ok: false, error: 'Description too long (max 10000 chars)' }, { status: 400 });

  const categoryId = body.categoryId?.trim() || null;
  if (categoryId) {
    const cat = await env.DB.prepare('SELECT 1 FROM categories WHERE id = ?1 AND is_active = 1').bind(categoryId).first();
    if (!cat) return Response.json({ ok: false, error: 'Invalid category' }, { status: 400 });
  }

  let slug = slugify(body.slug ?? body.name);
  if (!slug) slug = slugify(name);
  if (slug.length > 200) slug = slug.slice(0, 200);
  const existingSlug = await env.DB.prepare('SELECT 1 FROM products WHERE slug = ?1').bind(slug).first();
  if (existingSlug) slug = slug + '-' + Date.now().toString(36);

  const rawPrice = body.pricePaisa;
  const pricePaisa = Number.isFinite(rawPrice) && rawPrice >= 0 ? Math.floor(rawPrice) : null;
  if (pricePaisa === null) return Response.json({ ok: false, error: 'Valid price_paisa is required (>= 0)' }, { status: 400 });

  const rawCompare = body.comparePricePaisa;
  const comparePricePaisa = rawCompare != null && Number.isFinite(rawCompare) && rawCompare >= 0 ? Math.floor(rawCompare) : null;

  const status: 'draft' | 'published' = body.status === 'published' ? 'published' : 'draft';
  const isFeatured = body.isFeatured === true ? 1 : 0;

  const metaTitle = body.metaTitle?.trim() || null;
  const metaDescription = body.metaDescription?.trim() || null;
  if (metaTitle && metaTitle.length > 500) return Response.json({ ok: false, error: 'Meta title too long (max 500 chars)' }, { status: 400 });
  if (metaDescription && metaDescription.length > 1000) return Response.json({ ok: false, error: 'Meta description too long (max 1000 chars)' }, { status: 400 });

  const variants = Array.isArray(body.variants) ? body.variants : [];
  if (variants.length === 0) return Response.json({ ok: false, error: 'At least one variant is required' }, { status: 400 });

  for (const [i, v] of variants.entries()) {
    const sku = (v.sku ?? '').trim();
    if (!sku) return Response.json({ ok: false, error: `Variant ${i + 1}: SKU is required` }, { status: 400 });
    if (sku.length > 100) return Response.json({ ok: false, error: `Variant ${i + 1}: SKU too long (max 100 chars)` }, { status: 400 });
    if (v.size && v.size.length > 50) return Response.json({ ok: false, error: `Variant ${i + 1}: Size too long (max 50 chars)` }, { status: 400 });
    if (v.color && v.color.length > 50) return Response.json({ ok: false, error: `Variant ${i + 1}: Color too long (max 50 chars)` }, { status: 400 });
  }

  const skus = variants.map(v => v.sku.trim().toUpperCase());
  const uniqueSkus = new Set(skus);
  if (uniqueSkus.size !== skus.length) return Response.json({ ok: false, error: 'Duplicate SKUs in request' }, { status: 400 });

  for (const sku of uniqueSkus) {
    const exists = await skuExists(env.DB, sku);
    if (exists) return Response.json({ ok: false, error: `SKU "${sku}" already exists` }, { status: 409 });
  }

  const productId = crypto.randomUUID();
  const variantRows = variants.map(v => ({
    id: crypto.randomUUID(),
    sku: v.sku.trim().toUpperCase(),
    size: v.size?.trim() || null,
    color: v.color?.trim() || null,
    pricePaisa: v.pricePaisa != null && Number.isFinite(v.pricePaisa) && v.pricePaisa > 0 ? Math.floor(v.pricePaisa) : null,
    stock: Number.isFinite(v.stock) && v.stock >= 0 ? Math.floor(v.stock) : 0,
  }));

  try {
    const stmts: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, meta_title, meta_description, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)`
      ).bind(productId, name, slug, description, categoryId, pricePaisa, comparePricePaisa, status, isFeatured, metaTitle, metaDescription, user.id, now),
    ];

    for (const v of variantRows) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO product_variants (id, product_id, sku, size, color, price_paisa, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`
        ).bind(v.id, productId, v.sku, v.size, v.color, v.pricePaisa, now)
      );
      stmts.push(
        env.DB.prepare(
          `INSERT INTO inventory_items (id, variant_id, quantity, updated_at)
           VALUES (?1, ?2, ?3, ?4)`
        ).bind(crypto.randomUUID(), v.id, v.stock, now)
      );
    }

    await env.DB.batch(stmts, { atomic: true });

    const variantIds = variantRows.map(v => v.id);

    await writeCriticalAuditLog(env.DB, {
      actorStaffId: user.id,
      actorRole: user.role,
      action: 'product.create',
      entityType: 'product',
      entityId: productId,
      metadata: {
        name, slug, pricePaisa, status,
        variantCount: variantRows.length,
        variantIds,
        categoryId,
      },
      ipAddress: clientIp(context.request),
      userAgent: userAgent(context.request),
    });

    const result: CreateProductResult = { ok: true, productId, variantIds };
    return Response.json(result, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
