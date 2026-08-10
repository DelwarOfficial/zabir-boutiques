# N-13: Removing `style-src 'unsafe-inline'` — design

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

## Phase 2 (separate, future deploy)

1. Convert the 218 dynamic `.tsx` `style={...}` sites to CSS custom
   properties set via `className`/`data-*` + a stylesheet rule (e.g.
   `style={{'--w': pct}}` → CSS `width: var(--w)` — note CSS custom
   *properties* themselves are exempt from `style-src` entirely, only the
   literal declarations are checked, so this specific pattern is CSP-safe
   without needing a hash at all).
2. Re-run the hash collector against a real build, confirm `reachedHead`-
   style coverage (no residual literal `style=` sites without a matching
   hash).
3. Flip `src/lib/security/csp.ts`'s `style-src` to
   `'self' 'unsafe-hashes' ${styleHashes.join(' ')}` (dropping
   `'unsafe-inline'`) in one atomic deploy, gated on step 1 being fully
   complete — a partial cutover is worse than not doing it at all.
