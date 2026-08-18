// N-13: static-hash coverage for literal style="..." attributes in .astro
// source (see docs/audit/N-13-CSP-STYLE-HASH-DESIGN.md). Local dev keeps
// 'unsafe-inline' since dev-mode Vite HMR can inject its own inline
// <style>/style attributes outside this hash list. 218 dynamic .tsx
// style={} sites were converted to Tailwind classes (compiled into the
// bundled external stylesheet, already covered by style-src 'self') — none
// of them ever needed a hash to begin with.
function buildStyleSrc(localDev: boolean, styleHashes: string[]): string {
  if (localDev) return "style-src 'self' 'unsafe-inline'";
  return ["style-src 'self'", "'unsafe-hashes'", ...styleHashes].join(' ');
}

export function generatePublicCSP(nonce: string, localDev: boolean, scriptHashes: string[], styleHashes: string[] = []): string {
  const scriptSrc = localDev
    ? "'self' 'unsafe-inline'"
    : ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...scriptHashes].join(' ');

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    buildStyleSrc(localDev, styleHashes),
    "img-src 'self' https://cdn.zabirboutiques.com https://*.r2.dev data: blob:",
    "connect-src 'self' https://api.uddoktapay.com https://uddoktapay.com https://securepay.sslcommerz.com https://api.fraudbd.com https://api.resend.com https://api.deepseek.com https://*.imagify.com https://api.pathao.com https://portal.packzy.com https://api.redx.com.bd https://*.r2.cloudflarestorage.com",
    "frame-src 'self' https://challenges.cloudflare.com https://securepay.sslcommerz.com https://uddoktapay.com",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' https://uddoktapay.com https://securepay.sslcommerz.com`,
    "media-src 'self' https://cdn.zabirboutiques.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
  ];

  if (!localDev) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function generateStaffCSP(nonce: string, localDev: boolean, scriptHashes: string[], styleHashes: string[] = []): string {
  const scriptSrc = localDev
    ? "'self' 'unsafe-inline'"
    : ["'self'", `'nonce-${nonce}'`, ...scriptHashes].join(' ');

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    buildStyleSrc(localDev, styleHashes),
    "img-src 'self' https://cdn.zabirboutiques.com https://*.r2.dev data: blob:",
    "connect-src 'self'",
    `frame-src 'self' https://challenges.cloudflare.com`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (!localDev) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
