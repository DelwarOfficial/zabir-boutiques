/**
 * Astro Middleware [v6.8A + Master_Prompt v7.0]
 * CSRF Protection: All non-GET staff/admin mutations must pass CSRF.
 * Includes /api/staff/*, /staff/* SSR form posts, and Astro actions that
 * mutate product, order, payment, fraud, or staff state.
 *
 * Also issues a per-request CSP nonce and sets strict-dynamic + nonce CSP
 * for script-src.
 */
import type { MiddlewareHandler } from 'astro';
import { generateRandomHex } from './lib/security';
import { getCurrentStaffUser, can } from './lib/rbac';
import { getCspScriptHashes } from './lib/csp-hashes';
import { safeLog } from './lib/pii-scrubber';
import { isLocalHttpDev } from './lib/staff-cookies';
import { validateCsrfDoubleSubmit } from './lib/csrf';
import { getRequiredStaffPermission } from './lib/staff-route-rbac';
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

  // Per-request CSP nonce. Available on context.locals.cspNonce so pages
  // can stamp inline scripts.
  const cspNonce = generateRandomHex(16);
  context.locals.cspNonce = cspNonce;

  if (url.pathname === '/api/staff/login' && !SAFE_METHODS.has(request.method) && !originAllowed(request, runtimeEnv?.PUBLIC_SITE_URL)) {
    return withSecurityHeaders(Response.json({ error: 'Invalid origin' }, { status: 403 }), cspNonce, request);
  }

  const limited = await rateLimit(context, url.pathname);
  if (limited) return withSecurityHeaders(limited, cspNonce, request);

  // Central authentication guard. Resolves the staff session exactly once and
  // caches it on locals so getCurrentStaffUser does not re-query D1.
  if (STAFF_PROTECTED.test(url.pathname) && !AUTH_EXEMPT_PATHS.has(url.pathname)) {
    const user = await getCurrentStaffUser(context);
    context.locals.staffUser = user;
    context.locals.staffUserResolved = true;
    if (!user) {
      if (url.pathname.startsWith('/api/')) {
        return withSecurityHeaders(Response.json({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required' }, { status: 401 }), cspNonce, request);
      }
      return withSecurityHeaders(context.redirect('/staff/login'), cspNonce, request);
    }

    // RBAC enforcement for /api/staff/*.
    if (url.pathname.startsWith('/api/staff/')) {
      const required = getRequiredStaffPermission(url.pathname, request.method);
      if (required && !can(user.role, required)) {
        return withSecurityHeaders(Response.json({ ok: false, code: 'FORBIDDEN_PERMISSION', error: `Missing permission: ${required}` }, { status: 403 }), cspNonce, request);
      }
    }
  }

  if (STAFF_MUTATION_PATHS.test(url.pathname) && !SAFE_METHODS.has(request.method) && !CSRF_EXEMPT_PATHS.has(url.pathname)) {
    const csrf = await validateCsrfDoubleSubmit(request, runtimeEnv?.SESSION_SECRET);
    if (!csrf.ok) {
      const message = csrf.reason === 'invalid_signature' ? 'Invalid CSRF token signature' : 'Invalid CSRF token';
      return withSecurityHeaders(Response.json({ error: message }, { status: 403 }), cspNonce, request);
    }
  }

  return withSecurityHeaders(await next(), cspNonce, request);
};

function originAllowed(request: Request, publicSiteUrl?: string): boolean {
  const origin = request.headers.get('Origin');
  // For state-changing login requests a same-origin browser always sends
  // Origin. A missing Origin on a non-safe method is treated as disallowed.
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
        { status: 429, headers: { 'Retry-After': String(rule.windowSeconds) } },
      );
    }
    await cache.put(key, String(current + 1), { expirationTtl: rule.windowSeconds * 2 });
  } catch (err) {
    safeLog.warn('[rate-limit] fail-open', { error: err instanceof Error ? err.message : String(err) });
  }

  return null;
}

function withSecurityHeaders(response: Response, nonce: string, request: Request): Response {
  const headers = new Headers(response.headers);
  const localDev = isLocalHttpDev(request);
  if (!localDev) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Astro dev serves inline script bodies with different whitespace, so
  // hash-only CSP blocks login and inline handlers on http://localhost.
  const scriptSrc = localDev
    ? "'self' 'unsafe-inline'"
    : [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        ...getCspScriptHashes(),
      ].join(' ');
  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https://cdn.zabirboutiques.com data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (!localDev) csp.push('upgrade-insecure-requests');
  headers.set('Content-Security-Policy', csp.join('; '));
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('x-csp-nonce', nonce);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
