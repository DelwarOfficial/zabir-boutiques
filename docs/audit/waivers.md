# Active Guardrail Waivers

Per V8 Section 34.7. A waiver is a time-boxed, Owner-approved exception to a
specific guardrail for a specific scope. The drift-audit CI job reads this file:
a finding with an active, in-scope waiver reports WAIVED instead of FAIL, and
the waiver ID appears in the CI output.

Waivers cannot be renewed more than twice (90 days total). A P0-closing
guardrail (44-50) MUST NOT be waived. Expiry is hard — an expired waiver fails
the build; there is no reminder step.

## W-2026-01

- code: D-03
- guardrail: #2 (RT-009 — catalog routes on-demand rendered)
- expires: 2026-09-06
- scope: catalog-prerender P0s surfaced by the V8 landing D-03 realignment
- files:
  - src/pages/index.astro
  - src/pages/robots.txt.ts
  - src/pages/products/[slug].astro
  - src/pages/categories/[slug].astro
  - src/pages/collections/[slug].astro
  - src/pages/blog/[slug].astro
- reason: These routes are V7-era prerendered mock pages importing from @/data/catalog (hardcoded seed), not D1. The V8 §3.3 dynamic-from-D1 + Cache API/SWR + cache-tag-purge layer is not yet implemented; it is M1 (Product Catalog) + M13 (Performance) milestone work. Removing `export const prerender = true` now would break the build (getStaticPaths dependency for the [slug] routes) and add per-request Worker-CPU cost with zero benefit while the data source is still static.
- mitigation: Catalog pages show no live inventory or price that could drift; availability is shown via /api/stock/[variant_id] (band only) and checkout revalidates server-side. No oversell path exists through these static pages.
- milestone_bound: M1, M13
- requested_by: V8 landing audit (2026-08-07)
- approved_by: Owner (sign-off pending — this waiver is provisional until the Owner signs at the next monthly review per §34.2)
