/**
 * Secondary-provider fallback cap (Master Plan §24.2, CF-08) — N-29.
 *
 * When the primary provider for a staff AI action is over budget, the action
 * falls back to the secondary provider rather than blocking — a budget problem
 * must not stop staff doing their job. That detour still has to be bounded,
 * because it opens exactly when the metered path closes and it is the path a
 * runaway loop or an outage will hammer.
 *
 * Product descriptions run Workers AI primary / DeepSeek secondary (§24.1), so
 * today this caps DeepSeek detours. It is deliberately written in terms of
 * "the fallback", not a named provider: the cap belongs to the detour, not to
 * whichever model currently sits on either side of it, and the precedence has
 * already been reversed once.
 *
 * The counter is KV, account-wide, keyed by UTC hour with a 2-hour TTL, and is
 * incremented BEFORE the call so a crash mid-generation still consumes budget.
 * KV is eventually consistent, so this is a spend ceiling with some slack, not
 * an exact quota — the correct trade for a backstop whose job is to stop a
 * runaway, not to bill precisely.
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
