/**
 * KV and Cloudflare Budget Strategy [v6.8A]
 *
 * RULES:
 * - Public stock badge must NOT write KV. Use CDN-cached D1 response.
 * - Checkout uses D1 only.
 * - KV writes only allowed for: admin settings, product listing cache, rate-limit counters, AI budget counters.
 */

export async function getCachedOrNull(kv: KVNamespace, key: string): Promise<string | null> {
  return kv.get(key);
}

export async function setCached(kv: KVNamespace, key: string, value: string, ttlSeconds: number): Promise<void> {
  await kv.put(key, value, { expirationTtl: ttlSeconds });
}

export async function deleteCached(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key);
}
