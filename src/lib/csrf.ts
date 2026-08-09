/**
 * CSRF cookie helpers [Master Plan §9.1]
 *
 * Double-submit: HttpOnly `__Host-csrf-token` cookie + matching
 * `X-CSRF-Token` request header. Token format: `nonce.HMAC(nonce)`.
 */
import { verifyCsrfToken, timingSafeEqualHex } from './security';
import { readStaffCsrfCookie } from './staff-cookies';
import { getCsrfSigningKeys } from './csrf-keys';

export const CSRF_COOKIE_NAME = '__Host-csrf-token';

export function readCsrfCookie(request: Request): string | null {
  return readStaffCsrfCookie(request);
}

export function buildCsrfSetCookie(token: string, maxAgeSeconds: number): string {
  return `${CSRF_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function buildCsrfClearCookie(): string {
  return `${CSRF_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export async function validateCsrfDoubleSubmit(
  request: Request,
  sessionSecret: string | undefined,
  db?: D1Database,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cookieToken = readCsrfCookie(request);
  const headerToken = request.headers.get('X-CSRF-Token');

  // K-29: constant-time compare, matching the constant-time HMAC check below.
  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length || !timingSafeEqualHex(cookieToken, headerToken)) {
    return { ok: false, reason: 'token_mismatch' };
  }
  if (!sessionSecret) {
    return { ok: false, reason: 'invalid_signature' };
  }

  // K-36: dual-key verification — a token signed with the just-rotated-out
  // "previous" key is still accepted, so rotation never hard-fails an
  // in-flight session's CSRF check.
  if (db) {
    const { current, previous } = await getCsrfSigningKeys(db, sessionSecret);
    const validCurrent = await verifyCsrfToken(cookieToken, current);
    const validPrevious = !validCurrent && previous ? await verifyCsrfToken(cookieToken, previous) : false;
    if (!validCurrent && !validPrevious) return { ok: false, reason: 'invalid_signature' };
    return { ok: true };
  }

  // No DB available (shouldn't happen in production) — fall back to the
  // pre-rotation behavior rather than failing every request.
  if (!(await verifyCsrfToken(cookieToken, sessionSecret))) {
    return { ok: false, reason: 'invalid_signature' };
  }
  return { ok: true };
}
