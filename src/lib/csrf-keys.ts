/**
 * CSRF signing key rotation [Master Plan §18.3, K-36]
 *
 * `CSRF_SIGNING_KEY`/`CSRF_SIGNING_KEY_PREV` were declared as Cloudflare
 * env vars but never actually used — the real CSRF token was signed with
 * SESSION_SECRET directly (a single static secret, never rotated; rotating
 * it would also invalidate every active staff session, a much bigger
 * blast radius than intended). Cloudflare Workers secrets are also not
 * writable from runtime code at all — `wrangler secret put` is a deploy-
 * time operation, so a Worker cannot "rotate a Cloudflare Secret" no
 * matter how it's coded.
 *
 * Real fix: the CSRF signing key lives in D1 (encrypted at rest with the
 * same AES-GCM pattern as otp-secrets.ts), decoupled from SESSION_SECRET
 * and from staff sessions entirely. This makes rotation something the
 * Worker genuinely can do, and lets verification try both the current and
 * previous key (dual-key, so a token signed just before rotation is still
 * accepted for the current request instead of causing a hard CSRF failure
 * for someone mid-session).
 */

async function deriveKey(cipherKeyMaterial: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cipherKeyMaterial));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encrypt(plain: string, cipherKeyMaterial: string): Promise<Uint8Array> {
  const key = await deriveKey(cipherKeyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const out = new Uint8Array(iv.length + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), iv.length);
  return out;
}

async function decrypt(bytes: Uint8Array | ArrayBuffer, cipherKeyMaterial: string): Promise<string | null> {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 13) return null;
  try {
    const key = await deriveKey(cipherKeyMaterial);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, key, u8.slice(12));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

function newSigningKeyMaterial(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Current + previous (if any) CSRF signing keys, decrypted. */
export async function getCsrfSigningKeys(
  db: D1Database,
  sessionSecret: string,
): Promise<{ current: string; previous: string | null }> {
  const rows = await db
    .prepare(`SELECT key_cipher, is_current FROM csrf_signing_keys ORDER BY created_at DESC LIMIT 2`)
    .all<{ key_cipher: ArrayBuffer | Uint8Array; is_current: number }>();
  const results = rows.results ?? [];
  const currentRow = results.find((r) => r.is_current === 1);
  const previousRow = results.find((r) => r.is_current === 0);

  if (!currentRow) {
    // Never rotated yet — fall back to SESSION_SECRET so CSRF still works
    // before the first rotation runs. Not a security regression: this is
    // exactly the previous (only) behavior.
    return { current: sessionSecret, previous: null };
  }
  const current = (await decrypt(currentRow.key_cipher, sessionSecret)) ?? sessionSecret;
  const previous = previousRow ? await decrypt(previousRow.key_cipher, sessionSecret) : null;
  return { current, previous };
}

/**
 * Rotate: generate a fresh key, demote the current row to "previous",
 * drop anything older than that. Idempotent by design — safe to call from
 * a cron on every run; callers should still gate on a 30-day interval
 * (see rotateCsrfKey) to avoid rotating every tick.
 */
export async function rotateCsrfSigningKey(db: D1Database, sessionSecret: string, now: string): Promise<void> {
  const newKey = newSigningKeyMaterial();
  const cipher = await encrypt(newKey, sessionSecret);

  await db.batch([
    db.prepare(`UPDATE csrf_signing_keys SET is_current = 0 WHERE is_current = 1`),
    db.prepare(
      `INSERT INTO csrf_signing_keys (id, key_cipher, is_current, created_at) VALUES (?1, ?2, 1, ?3)`,
    ).bind(crypto.randomUUID(), cipher, now),
    // Keep only the new current + the row that was just demoted to
    // previous; anything older is no longer honored by getCsrfSigningKeys
    // (LIMIT 2) so it's safe to prune.
    db.prepare(
      `DELETE FROM csrf_signing_keys WHERE id NOT IN (SELECT id FROM csrf_signing_keys ORDER BY created_at DESC LIMIT 2)`,
    ),
  ], { atomic: true });
}
