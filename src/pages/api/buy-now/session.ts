/**
 * POST /api/buy-now/session — Create Direct Checkout Session [Master Plan §10.3]
 *
 * Creates a short-lived DirectCheckoutSessionDO for a Buy Now flow.
 * Does NOT mutate the normal cart.
 */
export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { safeLog } from '../../../lib/pii-scrubber';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const productId = typeof body.product_id === 'string' ? body.product_id : '';
  const variantId = typeof body.variant_id === 'string' ? body.variant_id : '';
  const quantity = Number(body.quantity) || 0;
  const selectedOptions = (body.selected_options && typeof body.selected_options === 'object')
    ? body.selected_options as Record<string, string>
    : {};
  const sourcePage = typeof body.source_page === 'string' ? body.source_page : null;
  const utmParams = (body.utm_params && typeof body.utm_params === 'object')
    ? body.utm_params as Record<string, string>
    : null;

  if (!productId || !variantId || !Number.isSafeInteger(quantity) || quantity < 1) {
    return Response.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 });
  }

  // Validate product and variant exist and are available
  const product = await env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.status
     FROM products p
     WHERE p.id = ?1 AND p.status = 'published'`
  ).bind(productId).first<{ id: string; slug: string; name: string; status: string }>();

  if (!product) {
    return Response.json({ ok: false, error: 'PRODUCT_NOT_FOUND' }, { status: 404 });
  }

  const variant = await env.DB.prepare(
    `SELECT v.id, v.is_deleted
     FROM product_variants v
     WHERE v.id = ?1 AND v.product_id = ?2 AND v.is_deleted = 0`
  ).bind(variantId, productId).first<{ id: string; is_deleted: number }>();

  if (!variant) {
    return Response.json({ ok: false, error: 'VARIANT_NOT_FOUND' }, { status: 404 });
  }

  // Create the DirectCheckoutSessionDO
  if (!env.DIRECT_CHECKOUT_DO) {
    return Response.json({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  const sessionId = crypto.randomUUID();
  const id = env.DIRECT_CHECKOUT_DO.idFromName(sessionId);
  const stub = env.DIRECT_CHECKOUT_DO.get(id);
  const res = await stub.fetch('https://do/create', {
    method: 'POST',
    body: JSON.stringify({
      productId,
      variantId,
      quantity,
      selectedOptions,
      sourcePage,
      utmParams,
    }),
  });

  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!data?.ok) {
    safeLog.error('[buy-now/session] DO create failed', { error: data?.error });
    return Response.json({ ok: false, error: 'Session creation failed' }, { status: 500 });
  }

  return Response.json({
    ok: true,
    session_id: sessionId,
    redirect_url: `/buy-now/${product.slug}?sid=${sessionId}`,
  }, { status: 201 });
}
