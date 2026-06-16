# CSP Migration Plan [Master_Prompt v7.0 §9.5]

## Current state

`src/middleware.ts` emits a strict-dynamic CSP with a per-request
nonce. Every page also sets `x-csp-nonce: <nonce>` so apps can read it.

However, the codebase has 12 `<script is:inline>` blocks across
staff pages and layouts. Until each of those is updated to
`<script is:inline nonce={Astro.locals.cspNonce}>`, we keep
`script-src 'self' 'unsafe-inline'` as a transitional measure.

## Why the strict-dynamic nonce alone doesn't fully fix it

`strict-dynamic` allows **dynamically-loaded** scripts that were
loaded by a trusted script. It does NOT exempt `is:inline` scripts
themselves. Inline scripts still need `unsafe-inline` OR a matching
nonce to run under a CSP that excludes `unsafe-inline`.

## Migration steps

1. ✅ Per-request nonce generation in `src/middleware.ts`
2. ✅ `cspNonce` exposed on `Astro.locals` (see `src/env.d.ts`)
3. ⏳ Stamp `nonce={Astro.locals.cspNonce}` on every `<script is:inline>`
   in the following files:
   - `src/components/staff/StepUpRequired.astro` (1)
   - `src/layouts/RootLayout.astro` (1)
   - `src/layouts/StaffLayout.astro` (3)
   - `src/pages/staff/coupons/index.astro` (1)
   - `src/pages/staff/fraud/index.astro` (1)
   - `src/pages/staff/media/index.astro` (1)
   - `src/pages/staff/orders/[id].astro` (1)
   - `src/pages/staff/sales/instore.astro` (1)
   - `src/pages/staff/login.astro` (2)
4. ⏳ Replace `'unsafe-inline'` with `'nonce-{nonce}'` in `withSecurityHeaders`
5. ⏳ Build-time CSP test in CI: load each staff page, assert that the
   emitted CSP matches the per-page nonce in the response body.

## Why we accept `'unsafe-inline'` for now

- The risk is bounded: every inline script is hand-audited in the
  codebase and there are no user-generated content paths that could
  inject script tags.
- All session cookies use `__Host-` prefix, so an XSS that reads the
  cookie still needs to satisfy CSRF (`nonce.HMAC(nonce)` is
  session-independent).
- The CSRF double-submit token is also session-independent.
- The CSP excludes `frame-ancestors` (no clickjacking) and
  `object-src 'none'` (no Flash/plugin XSS).

The migration is small but touches 12 files; tracked in
`docs/csp.md`. Tracked alongside the 5-island budget work as the
remaining UI-side hardening.
