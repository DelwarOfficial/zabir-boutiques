/**
 * Astro Middleware [v6.8A + Master_Prompt v7.0 §9.5]
 * CSRF Protection: All non-GET staff/admin mutations must pass CSRF.
 * Includes /api/staff/*, /staff/* SSR form posts, and Astro actions that
 * mutate product, order, payment, fraud, or staff state.
 *
 * Also issues a per-request CSP nonce (Master_Prompt v7.0 §9.5) and
 * sets strict-dynamic + nonce-X CSP for script-src.
 */
import type { MiddlewareHandler } from 'astro';
import { verifyCsrfToken, generateRandomHex } from './lib/security';
import { getCurrentStaffUser } from './lib/rbac';
import { env as cloudflareEnv } from 'cloudflare:workers';

const STAFF_MUTATION_PATHS = new RegExp('^(?:/api/staff/|/staff/)');
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT_PATHS = new Set(['/api/staff/login']);
const AUTH_EXEMPT_PATHS = new Set(['/staff/login', '/api/staff/login']);
// Matches /staff, /staff/, /staff/*, and /api/staff/* for the auth guard.
const STAFF_PROTECTED = /^(?:\/api\/staff\/|\/staff(?:\/|$))/;
const RATE_LIMITS: Array<{ pattern: RegExp; limit: number; windowSeconds: number }> = [
  { pattern: /^\/api\/checkout$/, limit: 20, windowSeconds: 60 },
  { pattern: /^\/api\/orders\/track$/, limit: 30, windowSeconds: 60 },
  { pattern: /^\/api\/staff\/login$/, limit: 10, windowSeconds: 60 },
  { pattern: /^\/api\/payments\/create$/, limit: 20, windowSeconds: 60 },
  { pattern: /^\/api\/fraud\/check$/, limit: 30, windowSeconds: 60 },
  { pattern: /^\/api\/staff\/fraud\/override$/, limit: 10, windowSeconds: 60 },
  { pattern: /^\/api\/staff\/api-keys$/, limit: 20, windowSeconds: 60 },
];

export const onRequest: MiddlewareHandler = async (context, next) => {
  const { request } = context;
  const url = new URL(request.url);
  const runtimeEnv = cloudflareEnv as { CACHE?: KVNamespace; PUBLIC_SITE_URL?: string; SESSION_SECRET?: string };

  // Per-request CSP nonce (Master_Prompt v7.0 §9.5). Available on
  // context.locals.cspNonce so pages can stamp <script nonce={...}>.
  const cspNonce = generateRandomHex(16);
  context.locals.cspNonce = cspNonce;

  if (url.pathname === '/api/staff/login' && !SAFE_METHODS.has(request.method) && !originAllowed(request, runtimeEnv?.PUBLIC_SITE_URL)) {
    return withSecurityHeaders(Response.json({ error: 'Invalid origin' }, { status: 403 }), cspNonce);
  }

  const limited = await rateLimit(context, url.pathname);
  if (limited) return withSecurityHeaders(limited, cspNonce);

  // Central authentication guard (defense-in-depth). Resolves the staff session
  // exactly once and caches it on locals so getCurrentStaffUser does not re-query
  // D1 on the same request. A page that forgets its own check stays protected.
  if (STAFF_PROTECTED.test(url.pathname) && !AUTH_EXEMPT_PATHS.has(url.pathname)) {
    const user = await getCurrentStaffUser(context);
    context.locals.staffUser = user;
    context.locals.staffUserResolved = true;
    if (!user) {
      if (url.pathname.startsWith('/api/')) {
        return withSecurityHeaders(Response.json({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required' }, { status: 401 }), cspNonce);
      }
      return withSecurityHeaders(context.redirect('/staff/login'), cspNonce);
    }
  }

  if (STAFF_MUTATION_PATHS.test(url.pathname) && !SAFE_METHODS.has(request.method) && !CSRF_EXEMPT_PATHS.has(url.pathname)) {
    // Read either legacy or __Host- prefixed cookie. The __Host- prefix
    // binds the cookie to the exact host over HTTPS only; middleware is
    // host-agnostic so it accepts both names.
    const cookieToken = getCookieValue(request.headers.get('Cookie'), '__Host-csrf-token')
      ?? getCookieValue(request.headers.get('Cookie'), 'csrf-token');
    const headerToken = request.headers.get('X-CSRF-Token');

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return withSecurityHeaders(Response.json({ error: 'Invalid CSRF token' }, { status: 403 }), cspNonce);
    }

    const secret = runtimeEnv?.SESSION_SECRET;
    if (!secret || !(await verifyCsrfToken(cookieToken, secret))) {
      return withSecurityHeaders(Response.json({ error: 'Invalid CSRF token signature' }, { status: 403 }), cspNonce);
    }
  }

  return withSecurityHeaders(await next(), cspNonce);
};

function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function originAllowed(request: Request, publicSiteUrl?: string): boolean {
  const origin = request.headers.get('Origin');
  // For state-changing login requests a same-origin browser always sends Origin.
  // A missing Origin on a non-safe method is treated as disallowed (fail closed).
  if (!origin) return false;

  const requestOrigin = new URL(request.url).origin;
  const allowed = new Set([requestOrigin, 'http://localhost:4321', 'http://127.0.0.1:4321']);

  if (publicSiteUrl) {
    const site = new URL(publicSiteUrl);
    allowed.add(site.origin);
    if (!site.hostname.startsWith('www.')) {
      allowed.add(`${site.protocol}//www.${site.hostname}`);
    }
  }

  return allowed.has(origin);
}

async function rateLimit(context: Parameters<MiddlewareHandler>[0], pathname: string): Promise<Response | null> {
  const rule = RATE_LIMITS.find(item => item.pattern.test(pathname));
  const cache = (cloudflareEnv as { CACHE?: KVNamespace }).CACHE;
  if (!rule || !cache) return null;

  const ip = context.request.headers.get('CF-Connecting-IP') ?? context.request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown';
  const windowId = Math.floor(Date.now() / (rule.windowSeconds * 1000));
  const key = `rl:${pathname}:${ip}:${windowId}`;

  try {
    const current = Number(await cache.get(key) ?? '0');
    if (current >= rule.limit) {
      return Response.json(
        { error: 'Rate limit exceeded' },
        { status: 429, headers: { 'Retry-After': String(rule.windowSeconds) } }
      );
    }
    await cache.put(key, String(current + 1), { expirationTtl: rule.windowSeconds * 2 });
  } catch (err) {
    console.warn('[rate-limit] fail-open:', err);
  }

  return null;
}

function withSecurityHeaders(response: Response, nonce: string): Response {
  const headers = new Headers(response.headers);
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  // Per-request nonce (Master_Prompt v7.0 §9.5). All <script is:inline>
  // blocks in the codebase must be updated to include nonce={nonce};
  // until then we keep 'unsafe-inline' for existing inline scripts.
  // Migration plan: docs/csp.md.
  headers.set('Content-Security-Policy', [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; '));
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  // Expose the nonce so Astro pages can read it and stamp is:inline
  // <script> tags. This is a one-time hook until we migrate the pages.
  headers.set('x-csp-nonce', nonce);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
