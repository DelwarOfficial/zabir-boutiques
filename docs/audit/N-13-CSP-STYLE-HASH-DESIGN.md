# N-13: Removing `style-src 'unsafe-inline'` — design

**Status: cutover shipped.** Phase 1 (hash mechanism) and phase 2 (convert
the 218 dynamic `.tsx` sites, flip `csp.ts`) are both done. Production
`style-src` no longer contains `'unsafe-inline'` — see the bottom of this
doc. Local dev keeps `'unsafe-inline'` (Vite HMR can inject its own inline
styles outside the hash list).

## Scope, measured

- 148 literal `style="..."` attribute occurrences across `src/pages`,
  `src/components`, `src/layouts`, `src/islands` (`.astro` only) → 84
  unique values once deduplicated.
- 218 `style={...}` occurrences in `.tsx` islands/components. These are
  React/JSX — the `style` prop there is always an object expression
  (`style={{...}}`), never a hashable literal string, and its value is
  frequently computed at render time (progress-bar widths, computed
  colors). **Not solvable by hashing at all.**

## Mechanism (phase 1 — this change)

Extends `scripts/csp-hashes-plugin.mjs`, which already hashes inline
`<script>` blocks and build output into `CSP_SCRIPT_HASHES` for
`script-src`. Style attributes need a different CSP feature: CSP3's
`'unsafe-hashes'` source expression, which — unlike a plain hash source —
allow-lists specific inline event-handler *and* `style="..."` **attribute**
values by hash (a `<style>`-tag-content hash alone doesn't cover the
`style=` HTML attribute at all).

`collectStyleAttrHashes()` walks the same source trees, matches only
literal `style="..."`/`style='...'` (regex requires an immediate quote
after `=`, so it can never match `style={expr}`), and hashes the exact
attribute value bytes — the same value the browser parses out of the DOM,
since Astro's templating has no way to interpolate `{expr}` inside a
plain quoted attribute. Every match is guaranteed static.

Output: `CSP_STYLE_HASHES` + `CSP_STYLE_HASHES_VERSION`, written into the
same generated `src/generated/csp-hashes.ts` module the Worker already
imports (no `node:fs` at runtime, same as the script-hash mechanism).

## Ship-dark: what does NOT change in this deploy

`src/lib/security/csp.ts` still emits `style-src 'self' 'unsafe-inline'`,
untouched. `getCspStyleHashes()` exists and is tested, but nothing calls
it yet. This is deliberate, mirroring N-2's Case A phase split: land the
additive, zero-risk infrastructure first, confirm hash coverage is
correct against real source, *then* do the actual cutover as its own
reviewed deploy.

## Why the direct cutover isn't safe yet

1. **The 218 `.tsx` dynamic sites are the real blocker.** Flipping
   `style-src` to hash-only (dropping `'unsafe-inline'`) today would break
   every one of them — CSP silently drops `'unsafe-inline'` once any
   hash/nonce source is present in the same directive (spec behavior, not
   a bug), so a missed dynamic site doesn't degrade gracefully, it just
   stops applying the style.
2. **Browser support for `'unsafe-hashes'` on style attributes** needs a
   reasonably modern engine (Safari 15.4+, current Chrome/Firefox) — fine
   for a 2026 baseline, but worth confirming against the actual traffic
   mix (a meaningful slice of Bangladeshi mobile traffic goes through
   in-app WebViews — Facebook/Messenger browser — which can lag behind
   stock Safari/Chrome) before removing the `'unsafe-inline'` fallback.

## Phase 2 — done

1. **Converted, not just re-pointed.** All 218 `.tsx` `style={...}` sites
   (`InventoryAdjustmentManager.tsx`: 115, `ProductForm.tsx`: 102,
   `MergedProductUpload.tsx`: 1) became Tailwind arbitrary-property
   classes (`className="[padding:0.6rem_1.2rem] ..."` — one class per CSS
   property, exact same value). This turned out to be a *better* outcome
   than the CSS-custom-property plan sketched above: Tailwind classes
   compile into the already-bundled `global.css` (loaded via `<link>`,
   `@tailwindcss/vite`), so these sites never needed a hash at all —
   they're no longer inline styles in any sense CSP cares about, static or
   dynamic. Confirmed no `dangerouslySetInnerHTML` or `.style.` DOM writes
   remained in any of the three files.
2. Spread-and-override call sites (e.g. `{...inputStyle, fontSize:
   '0.78rem'}`) were resolved to a single final value per property before
   emitting a class — never two classes for the same CSS property, since
   Tailwind's generated stylesheet order (not JSX className string order)
   decides precedence, unlike a JS object spread which is always
   deterministic.
3. `src/lib/security/csp.ts`'s `style-src` flipped in one deploy:
   production is now `'self' 'unsafe-hashes' ${styleHashes.join(' ')}`
   (no `'unsafe-inline'`); local dev keeps `'self' 'unsafe-inline'`
   unconditionally, gated on `localDev` the same way `script-src` already
   was. `src/middleware.ts` wires `getCspStyleHashes()` through to both
   `generatePublicCSP`/`generateStaffCSP` calls.
4. 14 tests added/updated in `tests/csp-style-hash-mechanism.test.ts`
   covering the cutover directly: no `unsafe-inline` in prod, `unsafe-
   hashes` + every hash present, dev-mode unaffected, middleware wiring,
   and that the real generated hash set (not a stub) is what's asserted.
