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

// K-26: the KV binding being absent means every login attempt fails open
// (brute-force protection silently disappears). That should never happen
// in production, so it's a misconfiguration worth an operational alert —
// not something to keep silently degrading on. low_stock_alerts.variant_id
// has a NOT NULL FK to product_variants, so it can't hold a general
// system/ops alert like this one (a fake 'system' id violates the FK and
// silently fails, same latent bug present elsewhere in this codebase) —
// audit_log is the correct sink. Throttled to at most one alert per hour
// so a sustained outage doesn't flood it.
async function alertRateLimiterDisabled(db: D1Database | undefined): Promise<void> {
  if (!db) return;
  try {
    const recent = await db
      .prepare(`SELECT id FROM audit_log WHERE action = 'login_rate_limit.kv_unbound' AND created_at > datetime('now', '-1 hour') LIMIT 1`)
      .first<{ id: string }>();
    if (recent) return;
    const { writeAuditLog } = await import('./audit');
    await writeAuditLog(db, {
      actorStaffId: null,
      actorRole: null,
      action: 'login_rate_limit.kv_unbound',
      entityType: 'system',
      entityId: 'SESSION_KV',
      metadata: { message: 'SESSION KV binding missing — staff login brute-force protection is disabled' },
    });
  } catch {
    // Best-effort — never let the alert write itself block login.
  }
}

export async function checkLoginRateLimit(
  kv: KVNamespace | undefined,
  kind: 'ip' | 'identifier',
  key: string,
  db?: D1Database,
): Promise<RateLimitResult> {
  const cfg = kind === 'ip' ? LOGIN_RATE_LIMIT.perIp : LOGIN_RATE_LIMIT.perIdentifier;
  if (!kv) {
    await alertRateLimiterDisabled(db);
    return { ok: true, remaining: cfg.max, retryAfterSeconds: 0 };
  }

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
