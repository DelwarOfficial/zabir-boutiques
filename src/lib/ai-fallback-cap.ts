/**
 * Workers AI fallback cap (Master Plan §24.2, CF-08) — N-29.
 *
 * When `canUseDeepSeek()` is unreachable or its budget is spent, staff actions
 * fall back to Workers AI rather than blocking. That is the right call — a
 * budget-check timeout must not stop staff doing their job — but the plan is
 * explicit that it MUST be capped, because Workers AI overage on the Paid plan
 * is billed, not blocked. Without a cap, the fallback path is an unmetered
 * spend path that opens exactly when the metered one closes.
 *
 * The counter is KV, account-wide, keyed by UTC hour with a 2-hour TTL, and is
 * incremented BEFORE the call so a crash mid-generation still consumes budget.
 * KV is eventually consistent, so this is a spend ceiling with some slack, not
 * an exact quota — which is the correct trade for a backstop whose job is to
 * stop a runaway, not to bill precisely.
 */
export const AI_FALLBACK_HOURLY_CAP = 50;
const TTL_SECONDS = 7200;

export type FallbackCapEnv = { CACHE?: KVNamespace };

export function fallbackCapKey(now = new Date()): string {
  const iso = now.toISOString();
  return `ai_fallback:${iso.slice(0, 13)}`; // YYYY-MM-DDTHH
}

export type FallbackCapResult = { allowed: true; used: number } | { allowed: false; used: number };

/**
 * Claim one Workers AI fallback call for the current UTC hour.
 *
 * Fails OPEN when KV is unavailable: the cap is a cost backstop, and losing it
 * for one call is preferable to blocking a staff action because a cache
 * namespace hiccuped. The DO-level budget remains the primary control.
 */
export async function claimAiFallbackSlot(env: FallbackCapEnv, now = new Date()): Promise<FallbackCapResult> {
  if (!env.CACHE) return { allowed: true, used: 0 };
  const key = fallbackCapKey(now);
  try {
    const raw = await env.CACHE.get(key);
    const used = Number.parseInt(raw ?? '0', 10);
    const current = Number.isFinite(used) && used > 0 ? used : 0;
    if (current >= AI_FALLBACK_HOURLY_CAP) return { allowed: false, used: current };
    await env.CACHE.put(key, String(current + 1), { expirationTtl: TTL_SECONDS });
    return { allowed: true, used: current + 1 };
  } catch {
    return { allowed: true, used: 0 };
  }
}
