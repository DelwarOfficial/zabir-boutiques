import { isLocalHttpDev } from './staff-cookies';

/**
 * Buy Now session binding cookies [Master Plan V8 §10.6, RT-005, S-02].
 *
 * The session is bound to a secret the attacker cannot supply (bn_bind),
 * never to Origin or User-Agent. Origin is checked on state-changing POSTs
 * only, by the route handler, using the standard `Origin` header check —
 * not stored per-session. There is no User-Agent check anywhere: it is a
 * false control that 403s real customers whose UA legitimately changes
 * mid-session (in-app-browser -> external browser hand-off).
 *
 * `__Host-` prefix is skipped only for plain-HTTP loopback dev, matching
 * the staff-cookie convention in staff-cookies.ts.
 */

export function buyNowSessionCookieName(request: Request): string {
  return isLocalHttpDev(request) ? 'bn_sid' : '__Host-bn_sid';
}

export function buyNowBindingCookieName(request: Request): string {
  return isLocalHttpDev(request) ? 'bn_bind' : '__Host-bn_bind';
}

function cookieBaseAttrs(request: Request, maxAgeSeconds: number): string {
  const parts = ['Path=/', `Max-Age=${maxAgeSeconds}`, 'SameSite=Lax'];
  if (!isLocalHttpDev(request)) parts.push('Secure');
  return parts.join('; ');
}

/** 30 minutes, matching the DirectCheckoutSessionDO session lifetime. */
export const BUY_NOW_SESSION_MAX_AGE_SECONDS = 30 * 60;

export function appendBuyNowSessionCookies(
  headers: Headers,
  request: Request,
  opts: { sessionId: string; bindingSecret: string; maxAgeSeconds?: number },
): void {
  const base = cookieBaseAttrs(request, opts.maxAgeSeconds ?? BUY_NOW_SESSION_MAX_AGE_SECONDS);
  headers.append('Set-Cookie', `${buyNowSessionCookieName(request)}=${opts.sessionId}; HttpOnly; ${base}`);
  headers.append('Set-Cookie', `${buyNowBindingCookieName(request)}=${opts.bindingSecret}; HttpOnly; ${base}`);
}

export function clearBuyNowSessionCookies(headers: Headers, request: Request): void {
  const base = cookieBaseAttrs(request, 0);
  headers.append('Set-Cookie', `${buyNowSessionCookieName(request)}=; HttpOnly; ${base}`);
  headers.append('Set-Cookie', `${buyNowBindingCookieName(request)}=; HttpOnly; ${base}`);
}

function readNamedCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie') ?? '';
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function readBuyNowSessionCookie(request: Request): string | null {
  return readNamedCookie(request, buyNowSessionCookieName(request));
}

export function readBuyNowBindingCookie(request: Request): string | null {
  return readNamedCookie(request, buyNowBindingCookieName(request));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
