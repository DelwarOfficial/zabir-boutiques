/**
 * CSRF Key Rotation [Master Plan §18.3, K-36]
 *
 * Monthly rotation of the CSRF signing key. Uses dual-key verification
 * (current + previous key) so a token signed just before rotation is
 * still accepted, instead of failing every in-flight session's CSRF
 * check the moment rotation runs.
 */
import { rotateCsrfSigningKey } from '../csrf-keys';

export async function rotateCsrfKey(
  env: { DB: D1Database; SESSION_SECRET: string },
): Promise<{ ok: boolean; rotated: boolean; error?: string }> {
  const lastRotation = await env.DB.prepare(
    `SELECT value FROM site_settings WHERE key = 'csrf_key_rotated_at'`
  ).first<{ value: string }>();

  const now = new Date();
  if (lastRotation) {
    const lastDate = new Date(lastRotation.value);
    const daysSinceRotation = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceRotation < 30) {
      return { ok: true, rotated: false };
    }
  }

  try {
    await rotateCsrfSigningKey(env.DB, env.SESSION_SECRET, now.toISOString().replace('T', ' ').slice(0, 19));
  } catch (err) {
    return { ok: false, rotated: false, error: err instanceof Error ? err.message : String(err) };
  }

  // K-36: site_settings.label/created_at are NOT NULL with no default —
  // the original INSERT OR REPLACE only listed (key, value, updated_at)
  // and would throw a NOT NULL constraint violation on every call (this
  // path was never actually exercised before, since rotateCsrfKey had no
  // caller anywhere until this fix wired it into cron-dispatch.ts).
  await env.DB.prepare(
    `INSERT INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
     VALUES ('csrf_key_rotated_at', ?1, 'text', 'CSRF Key Last Rotated', '', 'System', 0, ?1, ?1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(now.toISOString()).run();

  return { ok: true, rotated: true };
}
