/**
 * Login rate limiting [Master Plan §18.5 / AUTH-3]
 *
 * Throttles staff-login attempts per client IP and per identifier to blunt
 * brute force and credential stuffing. Counters live in KV with a fixed
 * window so they self-expire. The route fails open when no KV is bound.
 */

export interface RateLimitConfig {
  max: number;
  windowSeconds: number;
}

export const LOGIN_RATE_LIMIT = {
  perIp: { max: 10, windowSeconds: 15 * 60 } satisfies RateLimitConfig,
  perIdentifier: { max: 5, windowSeconds: 15 * 60 } satisfies RateLimitConfig,
};

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const PREFIX = 'ratelimit:login';

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function checkLoginRateLimit(
  kv: KVNamespace | undefined,
  kind: 'ip' | 'identifier',
  key: string,
): Promise<RateLimitResult> {
  const cfg = kind === 'ip' ? LOGIN_RATE_LIMIT.perIp : LOGIN_RATE_LIMIT.perIdentifier;
  if (!kv) return { ok: true, remaining: cfg.max, retryAfterSeconds: 0 };

  const counterKey = `${PREFIX}:${kind}:${key}`;
  const raw = await kv.get(counterKey);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= cfg.max) {
    return { ok: false, remaining: 0, retryAfterSeconds: cfg.windowSeconds };
  }
  await kv.put(counterKey, String(count + 1), { expirationTtl: cfg.windowSeconds });
  return { ok: true, remaining: cfg.max - count - 1, retryAfterSeconds: 0 };
}

export async function resetLoginRateLimit(
  kv: KVNamespace | undefined,
  kind: 'ip' | 'identifier',
  key: string,
): Promise<void> {
  if (!kv) return;
  await kv.delete(`${PREFIX}:${kind}:${key}`);
}
