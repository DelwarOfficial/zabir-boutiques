/**
 * Autocomplete Prefix Index [Master_Prompt v7.0 §13.2, Phase 6.2]
 *
 * A KV-backed tri-gram prefix index over product names. On the
 * cheap side, the index is just a key `ac:<tri-gram>:<product_id>`
 * for every (tri-gram, product-id) pair. Lookup is:
 *
 *   1. Trim q to 1..3 trailing tri-grams.
 *   2. For each tri-gram, KV.get(`ac:<tri-gram>:*`) — actually
 *      Cloudflare KV doesn't support list-by-prefix cheaply, so
 *      we read `ac:meta:<q>` which is a JSON array of product IDs
 *      keyed by the whole query.
 *   3. Fall back to FTS5 (see /api/search) if the index miss.
 *
 * Populated on the d1-backup cron (weekly) and on product create
 * (see staff/products/create API).
 */
import type { D1Database } from "@cloudflare/workers-types";

type KV = KVNamespace;

const META_PREFIX = "ac:meta:";
const PRODUCT_PREFIX = "ac:product:";

export function triGrams(s: string): string[] {
  const norm = s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const words = norm.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    for (let i = 0; i < w.length - 2; i++) out.push(w.slice(i, i + 3));
    out.push(w);
  }
  return out;
}

export async function addProduct(env: { DB: D1Database; CACHE: KV }, product: { id: string; name: string }): Promise<void> {
  const grams = triGrams(product.name);
  // Store the product's name + id keyed by product id, so we can
  // resolve a hit back to a display label.
  await env.CACHE.put(
    `${PRODUCT_PREFIX}${product.id}`,
    JSON.stringify({ id: product.id, name: product.name }),
    { expirationTtl: 60 * 60 * 24 * 30 },
  );
  // For each tri-gram, append the product id to the per-gram list.
  // The list is kept short (max 100 ids per tri-gram) — autocomplete
  // is a coarse discovery tool; full search is FTS5.
  for (const g of grams) {
    const key = `${META_PREFIX}${g}`;
    const current = (await env.CACHE.get(key, "json").catch(() => null)) as string[] | null;
    const next = Array.from(new Set([...(current ?? []), product.id])).slice(-100);
    await env.CACHE.put(key, JSON.stringify(next), { expirationTtl: 60 * 60 * 24 * 30 });
  }
}

export async function removeProduct(env: { CACHE: KV }, productId: string): Promise<void> {
  await env.CACHE.delete(`${PRODUCT_PREFIX}${productId}`);
}

export async function autocomplete(env: { CACHE: KV }, q: string, limit = 8): Promise<Array<{ id: string; name: string }>> {
  if (q.length < 1) return [];
  const grams = triGrams(q);
  const matches = new Map<string, number>();
  for (const g of grams) {
    const list = (await env.CACHE.get(`${META_PREFIX}${g}`, "json").catch(() => null)) as string[] | null;
    if (!list) continue;
    for (const id of list) matches.set(id, (matches.get(id) ?? 0) + 1);
  }
  const ranked = Array.from(matches.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
  const out: Array<{ id: string; name: string }> = [];
  for (const [id] of ranked) {
    const p = (await env.CACHE.get(`${PRODUCT_PREFIX}${id}`, "json").catch(() => null)) as { id: string; name: string } | null;
    if (p) out.push(p);
  }
  return out;
}

export async function rebuildIndexFromD1(env: { DB: D1Database; CACHE: KV }): Promise<{ count: number }> {
  // For maintenance: list all products and re-add. We don't try to
  // delete stale entries — entries naturally expire after 30 days
  // of no re-add. Acceptable for an autocomplete index; the full
  // product listing is rebuilt each rebuild cycle (cron daily).
  const rows = await env.DB
    .prepare("SELECT id, name FROM products WHERE status = 'published'")
    .all<{ id: string; name: string }>();
  for (const p of rows.results ?? []) {
    await addProduct(env, p);
  }
  return { count: rows.results?.length ?? 0 };
}
