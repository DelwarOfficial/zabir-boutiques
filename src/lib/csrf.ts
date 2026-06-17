/**
 * CSRF cookie helpers [Master Plan §9.1]
 *
 * Double-submit: HttpOnly `__Host-csrf-token` cookie + matching
 * `X-CSRF-Token` request header. Token format: `nonce.HMAC(nonce)`.
 */
import { verifyCsrfToken } from './security';

export const CSRF_COOKIE_NAME = '__Host-csrf-token';

export function readCsrfCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  const escaped = CSRF_COOKIE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function buildCsrfSetCookie(token: string, maxAgeSeconds: number): string {
  return `${CSRF_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function buildCsrfClearCookie(): string {
  return `${CSRF_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export async function validateCsrfDoubleSubmit(
  request: Request,
  secret: string | undefined,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cookieToken = readCsrfCookie(request);
  const headerToken = request.headers.get('X-CSRF-Token');

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return { ok: false, reason: 'token_mismatch' };
  }
  if (!secret || !(await verifyCsrfToken(cookieToken, secret))) {
    return { ok: false, reason: 'invalid_signature' };
  }
  return { ok: true };
}