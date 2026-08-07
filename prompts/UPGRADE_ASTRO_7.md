# TASK: Upgrade Astro 6.4.4 → 7.2.0 (Zabir Boutiques)

You are upgrading the Astro framework in the Zabir Boutiques repo from **Astro 6.4.4 to Astro 7.2.0**. This is a **MAJOR version jump (6 → 7)**, not a patch. Treat it as high-risk: a major bump can silently break the Cloudflare adapter, the `output: 'server'` rendering mode, the React 19 islands, the build-time CSP hashing plugin, and the V8 guardrails.

Work one step at a time. Do NOT bundle dependency bumps, code changes, and config changes into a single commit. Verify after each step. Stop and report if any step fails.

---

## 0. Non-negotiable project guardrails (Master Plan V8)

These constrain the upgrade. Violating any of them fails the task:

- `output: 'server'` is mandatory. `output: 'static'` is FORBIDDEN anywhere. (Guardrail #1/#2)
- Exactly five routes are prerendered via `export const prerender = true`: `/about`, `/privacy`, `/terms`, `/return-policy`, `/size-guide`. Catalog routes (`/`, `/products/[slug]`, `/categories/[slug]`, `/collections/[slug]`, `/blog/[slug]`) MUST stay on-demand. Setting `prerender = false` is forbidden anti-pattern noise — omit the flag. (§3.3)
- The adapter is `@astrojs/cloudflare` in advanced mode (`output: 'server'`). It must keep working with `wrangler deploy`.
- React 19 islands via `@astrojs/react`. Styling is Tailwind CSS 4 via `@tailwindcss/vite`.
- CSP is per-request nonce + build-time SHA-256 hashes via `scripts/csp-hashes-plugin.mjs`. Any change to how Astro emits inline scripts breaks the hash set and must be reflected in the plugin.
- Money is integer paisa; pricing is server-authoritative. The upgrade must not alter any runtime business logic.
- Node 22.12.0 is pinned via `.nvmrc`.

---

## 1. Research first (do this before touching any file)

Fetch and read BOTH of these — the 7.2 blog post alone is insufficient for a major bump:

1. **The Astro 7.0 migration guide** — `https://docs.astro.build/en/guides/upgrade-to/v7/` (or the current "Upgrade to Astro v7" guide). This is where breaking changes from 6.x → 7.0 live.
2. **The 7.2 release notes** — `https://astro.build/blog/astro-720/`.

Produce a short written summary covering:
- Every **breaking change** between 6.4.4 and 7.2.0 that affects: `output: 'server'`, the Cloudflare adapter, React islands integration, `getStaticPaths`, the Vite plugin API, `astro:content`, config schema, or inline-script emission.
- Every **deprecation** that this repo currently relies on.
- The **minimum compatible versions** of `@astrojs/cloudflare` and `@astrojs/react` for Astro 7.2.0. Do not assume the currently pinned adapter versions work with Astro 7.

Show me this summary before proceeding to step 2. Do not guess — if a compatibility fact is not stated in the official docs, say so explicitly.

---

## 2. Check current state

Run and report:
- `cat package.json` — current versions of `astro`, `@astrojs/cloudflare`, `@astrojs/react`, `@tailwindcss/vite`, `tailwindcss`, `react`, `react-dom`.
- `cat astro.config.mjs` — current adapter/integration config.
- `cat scripts/csp-hashes-plugin.mjs` — how CSP hashes are computed (this is the most likely thing to break).
- `git status` — confirm a clean working tree before starting.

Create a feature branch: `git checkout -b chore/upgrade-astro-7.2`.

---

## 3. Upgrade dependencies (in this exact order)

Astro integrations must be bumped together with the core — mismatched versions cause hard-to-diagnose runtime errors.

1. Bump `astro` to `^7.2.0`.
2. Bump `@astrojs/cloudflare` to the version whose changelog declares Astro 7.2 compatibility.
3. Bump `@astrojs/react` to the version whose changelog declares Astro 7.2 compatibility.
4. Leave `@tailwindcss/vite`, `tailwindcss`, `react`, `react-dom` unless step 1's research says they must move for Astro 7.

Install with the repo's package manager (npm — `package-lock.json` is present). Use `npm install astro@latest @astrojs/cloudflare@latest @astrojs/react@latest` then verify the resolved versions in `package.json` are `>=7.2.0` for astro and the matching adapter/integration majors.

Commit: `chore: bump astro 6.4.4 → 7.2.0 with cloudflare + react adapters`.

---

## 4. Apply breaking-change fixes

From step 1's summary, fix each breaking change one at a time. Likely candidates to check (verify against the actual migration guide, don't assume):
- `astro.config.mjs` adapter options (the Cloudflare adapter may have renamed/moved advanced-mode flags between 6.x and 7.x).
- `getStaticPaths` return shape (the 7.2 `cacheKey` feature is additive, but 7.0 may have changed the `params`/`props` contract).
- Any `import` paths under `astro:` (e.g. `astro:content`, `astro:env`) that moved.
- `export const prerender` behavior — confirm the five static routes still prerender and dynamic routes still render on demand under Astro 7's defaults.
- Inline script emission — if Astro 7 changes how it stamps inline scripts (nonce handling, ordering), update `scripts/csp-hashes-plugin.mjs` so the SHA-256 hash set stays correct. A wrong hash set = CSP blocks the checkout/staff islands at runtime.

Commit each fix separately with a message that cites the migration-guide section it addresses.

---

## 5. Evaluate the 7.2 features for this project (do NOT auto-apply)

Astro 7.2 adds four features. Decide for each whether to adopt; **default is to NOT adopt unless it clearly helps**:

- **`session: false` opt-out** — RELEVANT. This project runs on Cloudflare with `output: 'server'` but does NOT use Astro's built-in sessions (it uses CartDO + staff HttpOnly cookies + KV). Verify by grepping for `Astro.session`. If unused, set `session: false` in `astro.config.mjs` so the session runtime is tree-shaken (smaller bundle, aligns with the §21 performance budget). If `Astro.session` IS used anywhere, leave sessions on.
- **Incremental static builds (experimental)** — SKIP for now. It's experimental and this repo only prerenders 5 static legal pages; the build is already fast. Do not enable `experimental.incrementalBuild`.
- **Preview background mode (`astro preview --background`)** — informational only; no code change.
- **Relative logger entrypoints** — informational only; no code change unless the project has a custom logger entrypoint (it does not today).

Report your decision for each feature with the grep evidence.

---

## 6. Verify — run the full gate before declaring done

These must all pass. Report actual output, not a summary claim:

1. **Type check:** `npx astro check` (or `npx tsc --noEmit` if that's the repo's gate). Zero errors.
2. **Build:** `npm run build` succeeds. Inspect the output for the Cloudflare adapter artifacts (`dist/` or `functions/` per adapter version).
3. **CSP hash regeneration:** if the build emits any new/changed inline scripts, regenerate hashes and confirm the CSP plugin's output is non-empty and stable across two consecutive builds (hashes must be deterministic).
4. **Unit tests:** `npm test` (Vitest). The repo has 391+ tests covering checkout, fraud, inventory, CSRF, payment state, backups. All must pass. Any failure here means the upgrade altered runtime behavior — do not "fix" tests to make them green without understanding why.
5. **Local Cloudflare dev:** `npx wrangler dev` (or `npm run dev` if it wraps wrangler) boots without adapter errors. Hit `/`, `/products/[slug]`, `/checkout`, `/staff/login` and confirm they render.
6. **Guardrail re-check:** confirm `output: 'server'` is still set, the 5 prerender routes still have `export const prerender = true`, and no dynamic route accidentally got `prerender = false` added.

---

## 7. Report

When done, report:
- Final resolved versions of `astro`, `@astrojs/cloudflare`, `@astrojs/react`.
- The list of breaking changes you applied (with migration-guide citations).
- Which 7.2 features you adopted and why (with grep evidence).
- Test/build/wrangler results (actual numbers, not "passed").
- Any step where you deviated from this prompt and why.
- The branch name and the list of commits, ready for PR.

If anything in steps 3–6 fails and you cannot resolve it from the official docs, STOP, leave the branch in a clean failing state, and report the exact error + the doc section you consulted. Do not paper over failures.
