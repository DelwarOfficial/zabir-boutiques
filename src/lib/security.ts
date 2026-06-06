/**
 * Security Controls [v6.8B]
 * - CSRF Protection: double-submit token of the form `nonce.HMAC(nonce)`.
 *   The CSRF token is INDEPENDENT of the staff session token, so an XSS that
 *   reads the non-HttpOnly csrf-token cookie cannot recover the session token.
 * - All non-GET staff/admin mutations must pass CSRF.
 */

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

/** Cryptographically random hex string of `byteLength` bytes (default 32). */
export function generateRandomHex(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA256 of `value` keyed by `secret`, returned as lowercase hex. */
export async function hmacSha256Hex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a CSRF token of the form `nonce.HMAC(nonce)`.
 * The nonce is independently random and never derived from the session token.
 */
export async function createCsrfToken(secret: string): Promise<string> {
  const nonce = generateRandomHex(32);
  const hmac = await hmacSha256Hex(nonce, secret);
  return `${nonce}.${hmac}`;
}

/**
 * Verify a CSRF token: split into nonce + hmac, recompute HMAC(nonce) with the
 * secret, and compare in constant time. Tokens not of the `nonce.hmac` shape
 * (including the legacy `sessionToken.tokenHash` format) fail verification
 * because the second segment will not equal HMAC(firstSegment).
 */
export async function verifyCsrfToken(token: string, secret: string): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [nonce, hmac] = parts;
  if (!nonce || !hmac) return false;
  const expected = await hmacSha256Hex(nonce, secret);
  return timingSafeEqualHex(expected, hmac);
}
