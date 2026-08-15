/**
 * Password policy validation [Master_Prompt v7.0 §18.1]
 * Minimum 10 characters, at least one uppercase, one number, one special character.
 */
export function validatePasswordPolicy(password: string): { ok: true } | { ok: false; error: string } {
  if (password.length < 10) return { ok: false, error: 'Password must be at least 10 characters' };
  if (!/[A-Z]/.test(password)) return { ok: false, error: 'Password must contain at least one uppercase letter' };
  if (!/[0-9]/.test(password)) return { ok: false, error: 'Password must contain at least one number' };
  if (!/[^A-Za-z0-9]/.test(password)) return { ok: false, error: 'Password must contain at least one special character' };
  return { ok: true };
}

// N-17: K-25 raised this to 600,000 citing OWASP's PBKDF2-SHA256
// recommendation, but Cloudflare Workers' WebCrypto PBKDF2 implementation
// hard-caps at 100,000 iterations (crypto.subtle.deriveBits throws
// NotSupportedError above that, unconditionally) — this made every login
// attempt 500, both new and legacy hashes, since deriveHash throws before
// verifyPasswordWithUpgrade ever reaches its legacy fallback. 100,000 is
// the actual ceiling this runtime supports, not a stopgap; OWASP's number
// assumes a platform without this cap. PBKDF2_LEGACY_ITERATIONS is kept
// (now equal) so verifyPasswordWithUpgrade's dual-check/upgrade path and
// its callers don't need to change.
export const PBKDF2_ITERATIONS = 100_000;
export const PBKDF2_LEGACY_ITERATIONS = 100_000;

async function deriveHash(password: string, salt: string, pepper: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const combinedSalt = new TextEncoder().encode(salt + pepper);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: combinedSalt, iterations, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string, salt: string, pepper: string): Promise<string> {
  return deriveHash(password, salt, pepper, PBKDF2_ITERATIONS);
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export async function verifyPassword(password: string, storedHash: string, salt: string | null, pepper: string): Promise<boolean> {
  if (!salt) return false;
  const computed = await hashPassword(password, salt, pepper);
  return timingSafeStringEqual(computed, storedHash);
}

/**
 * Verify against either the current or the legacy (pre-K-25) iteration
 * count, so accounts hashed before the bump to 600k can still log in.
 * Returns which count actually matched, so the caller can transparently
 * re-hash at the current count (same conditional-UPDATE upgrade pattern
 * used for the pre-PBKDF2 HMAC migration).
 */
export async function verifyPasswordWithUpgrade(
  password: string,
  storedHash: string,
  salt: string | null,
  pepper: string,
): Promise<{ valid: boolean; matchedIterations: number | null }> {
  if (!salt) return { valid: false, matchedIterations: null };
  const current = await deriveHash(password, salt, pepper, PBKDF2_ITERATIONS);
  if (timingSafeStringEqual(current, storedHash)) {
    return { valid: true, matchedIterations: PBKDF2_ITERATIONS };
  }
  const legacy = await deriveHash(password, salt, pepper, PBKDF2_LEGACY_ITERATIONS);
  if (timingSafeStringEqual(legacy, storedHash)) {
    return { valid: true, matchedIterations: PBKDF2_LEGACY_ITERATIONS };
  }
  return { valid: false, matchedIterations: null };
}

/** HMAC-SHA256 fallback for legacy hashes (pre-PBKDF2 migration). */
export async function legacyHashPassword(password: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(password));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}
