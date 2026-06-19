/**
 * Owner TOTP secrets in D1 otp_secrets (Master Plan V7 §6.1, §18.1).
 * Legacy staff_users.totp_secret rows are migrated lazily on read.
 */

const EMPTY_BACKUP_HASH = 'none';

async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptTotpSecret(plainSecret: string, cipherKeyMaterial: string): Promise<Uint8Array> {
  const key = await deriveKey(cipherKeyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plainSecret),
  );
  const out = new Uint8Array(iv.length + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), iv.length);
  return out;
}

export async function decryptTotpSecret(cipherBytes: Uint8Array | ArrayBuffer, cipherKeyMaterial: string): Promise<string | null> {
  const bytes = cipherBytes instanceof Uint8Array ? cipherBytes : new Uint8Array(cipherBytes);
  if (bytes.length < 13) return null;
  const iv = bytes.slice(0, 12);
  const payload = bytes.slice(12);
  try {
    const key = await deriveKey(cipherKeyMaterial);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, payload);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

function cipherMaterial(env: { SESSION_SECRET?: string; TOTP_CIPHER_KEY?: string }): string {
  return env.TOTP_CIPHER_KEY ?? env.SESSION_SECRET ?? '';
}

export async function loadStaffTotpSecret(
  db: D1Database,
  staffId: string,
  env: { SESSION_SECRET?: string; TOTP_CIPHER_KEY?: string },
): Promise<string | null> {
  const row = await db.prepare(
    `SELECT secret_cipher FROM otp_secrets WHERE staff_id = ?1 LIMIT 1`,
  ).bind(staffId).first<{ secret_cipher: ArrayBuffer | Uint8Array }>();

  if (row?.secret_cipher) {
    const material = cipherMaterial(env);
    if (!material) return null;
    return decryptTotpSecret(row.secret_cipher, material);
  }

  const legacy = await db.prepare(
    `SELECT totp_secret FROM staff_users WHERE id = ?1 LIMIT 1`,
  ).bind(staffId).first<{ totp_secret: string | null }>();

  if (!legacy?.totp_secret) return null;

  await storeStaffTotpSecret(db, staffId, legacy.totp_secret, env);
  return legacy.totp_secret;
}

export async function isStaffTotpEnabled(db: D1Database, staffId: string): Promise<boolean> {
  const otp = await db.prepare(`SELECT staff_id FROM otp_secrets WHERE staff_id = ?1 LIMIT 1`).bind(staffId).first();
  if (otp) return true;
  const legacy = await db.prepare(
    `SELECT totp_required, totp_secret FROM staff_users WHERE id = ?1 LIMIT 1`,
  ).bind(staffId).first<{ totp_required: number; totp_secret: string | null }>();
  return legacy?.totp_required === 1 && !!legacy?.totp_secret;
}

export async function storeStaffTotpSecret(
  db: D1Database,
  staffId: string,
  plainSecret: string,
  env: { SESSION_SECRET?: string; TOTP_CIPHER_KEY?: string },
): Promise<void> {
  const material = cipherMaterial(env);
  if (!material) throw new Error('TOTP_CIPHER_KEY or SESSION_SECRET required');

  const cipher = await encryptTotpSecret(plainSecret, material);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  await db.batch([
    db.prepare(
      `INSERT INTO otp_secrets (staff_id, secret_cipher, backup_codes_hash, enabled_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT(staff_id) DO UPDATE SET
         secret_cipher = excluded.secret_cipher,
         backup_codes_hash = excluded.backup_codes_hash,
         enabled_at = excluded.enabled_at,
         updated_at = excluded.updated_at`,
    ).bind(staffId, cipher, EMPTY_BACKUP_HASH, now),
    db.prepare(
      `UPDATE staff_users SET totp_secret = NULL, totp_required = 1, updated_at = ?2 WHERE id = ?1`,
    ).bind(staffId, now),
  ]);
}

export async function clearStaffTotpSecret(db: D1Database, staffId: string): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.batch([
    db.prepare(`DELETE FROM otp_secrets WHERE staff_id = ?1`).bind(staffId),
    db.prepare(
      `UPDATE staff_users SET totp_secret = NULL, totp_required = 0, updated_at = ?2 WHERE id = ?1`,
    ).bind(staffId, now),
  ]);
}