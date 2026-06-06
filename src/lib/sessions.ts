/**
 * Staff Authentication [v6.8A]
 * - Staff sessions use HttpOnly, Secure, SameSite=Strict cookies.
 * - Only HMAC-SHA256 session token hashes are stored in D1.
 * - Every authenticated request re-reads session and staff role from D1.
 */

export async function hashSessionToken(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Clean expired sessions. Called by daily maintenance cron.
 */
export async function cleanExpiredSessions(db: D1Database): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare(
    `DELETE FROM staff_sessions WHERE absolute_expires_at < ?1 OR (is_revoked = 1)`
  ).bind(now).run();
}
