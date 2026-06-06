/**
 * Astro Middleware [v6.8A]
 * CSRF Protection: All non-GET staff/admin mutations must pass CSRF.
 * Includes /api/staff/*, /staff/* SSR form posts, and Astro actions that
 * mutate product, order, payment, fraud, or staff state.
 */
import type { MiddlewareHandler } from 'astro';
import { verifyCsrfToken } from './lib/security';

const STAFF_MUTATION_PATHS = new RegExp('^(?:/api/staff/|/staff/)');
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT_PATHS = new Set(['/api/staff/login']);
const RATE_LIMITS: Array<{ pattern: RegExp; limit: number; windowSeconds: number }> = [
  { pattern: /^\/api\/checkout$/, limit: 20, windowSeconds: 60 },
  { pattern: /^\/api\/orders\/track$/, limit: 30, windowSeconds: 60 },
  { pattern: /^\/api\/staff\/login$/, limit: 10, windowSeconds: 60 },
  { pattern: /^\/api\/stock\/[^/]+$/, limit: 120, windowSeconds: 60 },
  { pattern: /^\/api\/fraud\/check$/, limit: 30, windowSeconds: 60 },
];

export const onRequest: MiddlewareHandler = async (context, next) => {
  const { request, locals } = context;
  const url = new URL(request.url);
  const runtimeEnv = (locals as { runtime?: { env?: { CACHE?: KVNamespace; PUBLIC_SITE_URL?: string; SESSION_SECRET?: string } } }).runtime?.env;

  if (url.pathname === '/api/staff/login' && !originAllowed(request, runtimeEnv?.PUBLIC_SITE_URL)) {
    return withSecurityHeaders(Response.json({ error: 'Invalid origin' }, { status: 403 }));
  }

  const limited = await rateLimit(context, url.pathname);
  if (limited) return withSecurityHeaders(limited);

  if (STAFF_MUTATION_PATHS.test(url.pathname) && !SAFE_METHODS.has(request.method) && !CSRF_EXEMPT_PATHS.has(url.pathname)) {
    const cookieToken = getCookieValue(request.headers.get('Cookie'), 'csrf-token');
    const headerToken = request.headers.get('X-CSRF-Token');

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return withSecurityHeaders(Response.json({ error: 'Invalid CSRF token' }, { status: 403 }));
    }

    const secret = runtimeEnv?.SESSION_SECRET;
    if (!secret || !(await verifyCsrfToken(cookieToken, secret))) {
      return withSecurityHeaders(Response.json({ error: 'Invalid CSRF token signature' }, { status: 403 }));
    }
  }

  return withSecurityHeaders(await next());
};

function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function originAllowed(request: Request, publicSiteUrl?: string): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;

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
  const cache = (context.locals as { runtime?: { env?: { CACHE?: KVNamespace } } }).runtime?.env?.CACHE;
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

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
