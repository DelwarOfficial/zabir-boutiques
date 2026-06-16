globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as generateRandomHex, v as verifyCsrfToken } from "./chunks/security_CY3I9xIU.mjs";
import { g as getCurrentStaffUser } from "./chunks/rbac_cfH-YcoZ.mjs";
import { env } from "cloudflare:workers";
import { s as sequence } from "./chunks/sequence_XySMyPne.mjs";
const CSP_SCRIPT_HASHES = [];
function getCspScriptHashes() {
  return CSP_SCRIPT_HASHES;
}
const STAFF_MUTATION_PATHS = new RegExp("^(?:/api/staff/|/staff/)");
const SAFE_METHODS = /* @__PURE__ */ new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_EXEMPT_PATHS = /* @__PURE__ */ new Set(["/api/staff/login"]);
const AUTH_EXEMPT_PATHS = /* @__PURE__ */ new Set(["/staff/login", "/api/staff/login"]);
const STAFF_PROTECTED = /^(?:\/api\/staff\/|\/staff(?:\/|$))/;
const RATE_LIMITS = [
  { pattern: /^\/api\/checkout$/, limit: 20, windowSeconds: 60 },
  { pattern: /^\/api\/orders\/track$/, limit: 30, windowSeconds: 60 },
  { pattern: /^\/api\/staff\/login$/, limit: 10, windowSeconds: 60 },
  { pattern: /^\/api\/payments\/create$/, limit: 20, windowSeconds: 60 },
  { pattern: /^\/api\/fraud\/check$/, limit: 30, windowSeconds: 60 },
  { pattern: /^\/api\/staff\/fraud\/override$/, limit: 10, windowSeconds: 60 },
  { pattern: /^\/api\/staff\/api-keys$/, limit: 20, windowSeconds: 60 }
];
const onRequest$1 = async (context, next) => {
  const { request } = context;
  const url = new URL(request.url);
  const runtimeEnv = env;
  const cspNonce = generateRandomHex(16);
  context.locals.cspNonce = cspNonce;
  if (url.pathname === "/api/staff/login" && !SAFE_METHODS.has(request.method) && !originAllowed(request, runtimeEnv?.PUBLIC_SITE_URL)) {
    return withSecurityHeaders(Response.json({ error: "Invalid origin" }, { status: 403 }), cspNonce);
  }
  const limited = await rateLimit(context, url.pathname);
  if (limited) return withSecurityHeaders(limited, cspNonce);
  if (STAFF_PROTECTED.test(url.pathname) && !AUTH_EXEMPT_PATHS.has(url.pathname)) {
    const user = await getCurrentStaffUser(context);
    context.locals.staffUser = user;
    context.locals.staffUserResolved = true;
    if (!user) {
      if (url.pathname.startsWith("/api/")) {
        return withSecurityHeaders(Response.json({ ok: false, code: "UNAUTHENTICATED", error: "Authentication required" }, { status: 401 }), cspNonce);
      }
      return withSecurityHeaders(context.redirect("/staff/login"), cspNonce);
    }
  }
  if (STAFF_MUTATION_PATHS.test(url.pathname) && !SAFE_METHODS.has(request.method) && !CSRF_EXEMPT_PATHS.has(url.pathname)) {
    const cookieToken = getCookieValue(request.headers.get("Cookie"), "__Host-csrf-token") ?? getCookieValue(request.headers.get("Cookie"), "csrf-token");
    const headerToken = request.headers.get("X-CSRF-Token");
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return withSecurityHeaders(Response.json({ error: "Invalid CSRF token" }, { status: 403 }), cspNonce);
    }
    const secret = runtimeEnv?.SESSION_SECRET;
    if (!secret || !await verifyCsrfToken(cookieToken, secret)) {
      return withSecurityHeaders(Response.json({ error: "Invalid CSRF token signature" }, { status: 403 }), cspNonce);
    }
  }
  return withSecurityHeaders(await next(), cspNonce);
};
function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
function originAllowed(request, publicSiteUrl) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const requestOrigin = new URL(request.url).origin;
  const allowed = /* @__PURE__ */ new Set([requestOrigin, "http://localhost:4321", "http://127.0.0.1:4321"]);
  if (publicSiteUrl) {
    const site = new URL(publicSiteUrl);
    allowed.add(site.origin);
    if (!site.hostname.startsWith("www.")) {
      allowed.add(`${site.protocol}//www.${site.hostname}`);
    }
  }
  return allowed.has(origin);
}
async function rateLimit(context, pathname) {
  const rule = RATE_LIMITS.find((item) => item.pattern.test(pathname));
  const cache = env.CACHE;
  if (!rule || !cache) return null;
  const ip = context.request.headers.get("CF-Connecting-IP") ?? context.request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
  const windowId = Math.floor(Date.now() / (rule.windowSeconds * 1e3));
  const key = `rl:${pathname}:${ip}:${windowId}`;
  try {
    const current = Number(await cache.get(key) ?? "0");
    if (current >= rule.limit) {
      return Response.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(rule.windowSeconds) } }
      );
    }
    await cache.put(key, String(current + 1), { expirationTtl: rule.windowSeconds * 2 });
  } catch (err) {
    console.warn("[rate-limit] fail-open:", err);
  }
  return null;
}
function withSecurityHeaders(response, nonce) {
  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  const scriptHashes = getCspScriptHashes();
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...scriptHashes
  ].join(" ");
  headers.set("Content-Security-Policy", [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests"
  ].join("; "));
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("x-csp-nonce", nonce);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
const onRequest = sequence(
  onRequest$1
);
export {
  onRequest
};
