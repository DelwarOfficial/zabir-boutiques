/**
 * Session Blacklist [Master_Prompt v7.0 §9.1]
 *
 * KV-backed blacklist of revoked session tokens. On logout or
 * forced revocation (e.g. password reset, role change), add the
 * token hash to the blacklist with a TTL matching the session's
 * remaining absolute lifetime.
 *
 * `requireAuth` (in rbac.ts) checks the blacklist before allowing
 * the request through. D1's `session_blacklist` table is a mirror
 * for admin lookups.
 */
import type { Env } from "../env";

const KV_PREFIX = "session-blacklist:";

function keyFor(tokenHash: string): string {
  return `${KV_PREFIX}${tokenHash}`;
}

export async function revokeSession(env: Env, tokenHash: string, ttlSeconds: number): Promise<void> {
  if (env.SESSION) {
    await env.SESSION.put(keyFor(tokenHash), "1", { expirationTtl: Math.max(60, ttlSeconds) });
  }
  // Mirror to D1 for admin queries.
  const { writeAuditLog } = await import("./audit");
  await env.DB
    .prepare(
      `INSERT OR REPLACE INTO session_blacklist (token_hash, staff_user_id, revoked_at, expires_at)
       SELECT ?1, staff_user_id, ?2, ?3 FROM staff_sessions WHERE token_hash = ?1`,
    )
    .bind(tokenHash, new Date().toISOString().replace("T", " ").slice(0, 19), new Date(Date.now() + ttlSeconds * 1000).toISOString().replace("T", " ").slice(0, 19))
    .run()
    .catch(() => {});
  await writeAuditLog(env.DB, {
    actorStaffId: null,
    actorRole: null,
    action: "session.revoke",
    entityType: "staff_session",
    entityId: tokenHash.slice(0, 12),
    metadata: { ttlSeconds },
  });
}

export async function isSessionRevoked(env: Env, tokenHash: string): Promise<boolean> {
  if (!env.SESSION) return false;
  return (await env.SESSION.get(keyFor(tokenHash))) !== null;
}
