export function generatePublicCSP(nonce: string, localDev: boolean, scriptHashes: string[]): string {
  const scriptSrc = localDev
    ? "'self' 'unsafe-inline'"
    : ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...scriptHashes].join(' ');

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https://cdn.zabirboutiques.com https://*.r2.dev data: blob:",
    `connect-src 'self'
      https://api.uddoktapay.com
      https://uddoktapay.com
      https://securepay.sslcommerz.com
      https://api.fraudbd.com
      https://api.resend.com
      https://api.deepseek.com
      https://*.imagify.com
      https://api.pathao.com
      https://portal.packzy.com
      https://api.redx.com.bd
      https://*.r2.cloudflarestorage.com`,
    `frame-src 'self'
      https://challenges.cloudflare.com
      https://securepay.sslcommerz.com
      https://uddoktapay.com`,
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

export function generateStaffCSP(nonce: string, localDev: boolean, scriptHashes: string[]): string {
  const scriptSrc = localDev
    ? "'self' 'unsafe-inline'"
    : ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...scriptHashes].join(' ');

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
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
