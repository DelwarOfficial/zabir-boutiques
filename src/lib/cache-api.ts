import { CloudflareCacheClient } from './integrations/cloudflare_cache';

/**
 * Cloudflare Cache API [Master_Prompt v7.0 §19.1]
 *
 * Wraps `caches.default` with stale-while-revalidate semantics for the
 * main public content types. Purging is via the Cloudflare API using
 * cache tags.
 */

const CACHE_TTL: Record<string, { maxAge: number; staleWhileRevalidate: number; tags: string[] }> = {
  product_detail: { maxAge: 3600, staleWhileRevalidate: 86400, tags: [] },
  category_listing: { maxAge: 1800, staleWhileRevalidate: 7200, tags: [] },
  homepage: { maxAge: 600, staleWhileRevalidate: 3600, tags: ["homepage"] },
  api_product: { maxAge: 300, staleWhileRevalidate: 600, tags: [] },
};

export type CacheType = keyof typeof CACHE_TTL;

/** Generate dynamic cache tags for products and categories [Master_Prompt v7.0 §19.2] */
export function productCacheTag(productId: string): string {
  return `product-${productId}`;
}

export function categoryCacheTag(categoryId: string): string {
  return `category-${categoryId}`;
}

export async function cachedFetch(request: Request, type: CacheType): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const cached = await cache.match(request);
  if (cached) {
    void revalidate(request, type).catch((err) => import('./pii-scrubber').then(({ safeLog }) => safeLog.warn("[cache] revalidate failed", { error: err instanceof Error ? err.message : String(err) })).catch(() => {}));
    return cached;
  }
  return revalidate(request, type);
}

async function revalidate(request: Request, type: CacheType): Promise<Response> {
  const ttl = CACHE_TTL[type];
  const response = await fetch(request);
  if (response.ok) {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", `public, max-age=${ttl.maxAge}, s-maxage=${ttl.staleWhileRevalidate}, stale-while-revalidate=${ttl.staleWhileRevalidate}`);
    if (ttl.tags.length > 0) {
      headers.set("Cache-Tag", ttl.tags.join(","));
    }
    const cacheable = new Response(response.clone().body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    try {
      const cache = (caches as unknown as { default: Cache }).default;
      await cache.put(request, cacheable.clone());
    } catch (err) {
      try { const { safeLog } = await import('./pii-scrubber'); safeLog.warn("[cache] put failed", { error: err instanceof Error ? err.message : String(err) }); } catch {}
    }
    return cacheable;
  }
  return response;
}

/**
 * Purge by cache tag via Cloudflare API.
 * Requires env.CF_API_TOKEN + env.CF_ZONE_ID.
 */
export async function purgeCacheTag(env: { CF_API_TOKEN?: string; CF_ZONE_ID?: string; DB?: D1Database; PROVIDER_HEALTH_DO?: DurableObjectNamespace }, tag: string): Promise<void> {
  await new CloudflareCacheClient(env).purgeTags([tag]);
}
