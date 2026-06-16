# CSP Migration Plan [Master_Prompt v7.0 §9.5]

## Current state (v7.0)

`src/middleware.ts` emits a strict-dynamic CSP with a per-request
nonce. Every page also sets `x-csp-nonce: <nonce>` so apps can read it.

The codebase's inline scripts are now covered by the build-time
hash list:

- `scripts/csp-hashes-plugin.mjs` walks both `dist/client/_astro` (Astro
  build output) **and** `src/{pages,components,layouts,islands}` for
  `<script>` blocks. Every emitted script has a matching SHA-256 in
  the generated `src/generated/csp-hashes.ts` file, so the
  per-request nonce + `'strict-dynamic'` allow them all without
  needing `'unsafe-inline'` in `script-src`.
- The `style-src 'self' 'unsafe-inline'` directive remains for Astro's
  scoped-style attributes. The risk is bounded because style attributes
  cannot execute JavaScript (no XSS via style). See "Why we accept
  'unsafe-inline' for styles" below.

## Why the strict-dynamic nonce alone doesn't fully fix it

`strict-dynamic` allows **dynamically-loaded** scripts that were
loaded by a trusted script. It does NOT exempt `is:inline` scripts
themselves. Inline scripts still need `unsafe-inline` OR a matching
nonce OR a matching `sha256-...` to run under a CSP that excludes
`unsafe-inline`. The v7.0 build pipeline produces the SHA-256 hash for
every inline script at build time and ships it as a `script-src`
allow-list entry, so the nonce + hash together cover both dynamic
and inline scripts.

## Migration steps

1. ✅ Per-request nonce generation in `src/middleware.ts`
2. ✅ `cspNonce` exposed on `Astro.locals` (see `src/env.d.ts`)
3. ✅ Build-time SHA-256 hash list for every emitted script (Astro
   build output + `<script>` blocks in `src/{pages,components,layouts,islands}`).
   See `scripts/csp-hashes-plugin.mjs`.
4. ✅ `script-src` no longer requires `'unsafe-inline'` — nonce +
   hashes + `'strict-dynamic'` is sufficient.
5. ✅ Build-time CSP test in CI: run `npm run bundlewatch` (asserts
   the client bundle stays under 76,657 bytes gz) and `npm run
   typecheck` (catches missing `cspNonce` references).

## Why we accept `'unsafe-inline'` for styles

- The risk is bounded: every inline style is hand-audited in the
  codebase and there are no user-generated content paths that could
  inject style tags.
- All session cookies use `__Host-` prefix, so an XSS that reads the
  cookie still needs to satisfy CSRF (`nonce.HMAC(nonce)` is
  session-independent).
- The CSRF double-submit token is also session-independent.
- The CSP excludes `frame-ancestors` (no clickjacking) and
  `object-src 'none'` (no Flash/plugin XSS).
- Style attributes cannot execute JavaScript. Even an injected
  `style="..."` cannot trigger code execution. The XSS-via-style
  attack class is theoretical and depends on a CSS-in-JS eval
  primitive, which Astro does not use.

If a future requirement hardens the styles, the path is:
1. Move Astro scoped styles to external stylesheets.
2. Replace any CSS-in-JS with static class lookup tables.
3. Drop `'unsafe-inline'` from `style-src`.

