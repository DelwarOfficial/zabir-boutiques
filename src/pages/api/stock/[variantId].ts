/**
 * GET /api/stock/[variantId] — Stock Badge [v6.8A]
 * CDN cache, rate limit, zero KV write.
 * Public stock badge must NOT write KV. Use CDN-cached D1 response.
 */
import type { APIContext } from 'astro';
import { env as cloudflareEnv } from 'cloudflare:workers';

export async function GET(context: APIContext): Promise<Response> {
  const { params } = context;
  const env = cloudflareEnv as { DB: D1Database };
  const variantId = params.variantId;

  if (!variantId || typeof variantId !== 'string') {
    return Response.json({ error: 'Invalid variant ID' }, { status: 400 });
  }

  const row = await env.DB.prepare(
    `SELECT (quantity - reserved_quantity) AS available
     FROM inventory_items
     WHERE variant_id = ?1 AND is_available = 1`
  ).bind(variantId).first<{ available: number }>();

  const available = Math.max(0, row?.available ?? 0);

  return new Response(JSON.stringify({ available, source: 'd1-cdn-cached' }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=30, s-maxage=60'
    }
  });
}
