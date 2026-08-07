/**
 * POST /api/buy-now/session — Create Direct Checkout Session [Master Plan §10.3]
 *
 * Creates a short-lived DirectCheckoutSessionDO for a Buy Now flow.
 * Does NOT mutate the normal cart.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { safeLog } from '../../../lib/pii-scrubber';

async function createHmacSessionId(secret: string): Promise<string> {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const payload = `${Date.now()}:${Array.from(random, b => b.toString(16).padStart(2, '0')).join('')}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join('');
}

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

  const sessionId = await createHmacSessionId(env.SESSION_SECRET);

  // Create the DirectCheckoutSessionDO or fallback to D1
  if (!env.DIRECT_CHECKOUT_DO) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO checkout_sessions (sessionId, productId, variantId, quantity, selectedOptions, createdAt)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(
      sessionId,
      productId,
      variantId,
      quantity,
      JSON.stringify(selectedOptions),
      now
    ).run();

    return Response.json({
      ok: true,
      session_id: sessionId,
      redirect_url: `/buy-now/${product.slug}?sid=${sessionId}`,
    }, { status: 201 });
  }

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
      sessionId,
      origin: context.request.headers.get('Origin') ?? new URL(context.request.url).origin,
      userAgent: context.request.headers.get('User-Agent') ?? '',
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
