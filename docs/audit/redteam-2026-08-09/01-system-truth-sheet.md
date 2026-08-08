# System Truth Sheet

Audit date: 2026-08-09. Authority paths are under `docs/`; Master Plan parts outrank migration plan, README, diagram, traceability matrix, and changelog.

## Architecture

| Area | Actual | Verdict |
|---|---|---|
| Astro | `output: "server"`, Cloudflare adapter, React, Tailwind (`astro.config.mjs:2-21`) | Pass |
| Prerender | 11 routes; catalog routes and `robots.txt.ts` included | Fail: whitelist must contain exactly 5 |
| D1 | `DB`; prod/staging/dev IDs differ (`wrangler.jsonc:43-49,151-156,212-217`) | Pass |
| KV | `CACHE`, `SESSION`; environment IDs differ | Partial: plan names more logical namespaces |
| R2 | `MEDIA`, `BACKUPS`, `LOGS`, `EMAIL_TEMPLATES`, `REPORTS`; environment buckets differ | Pass |
| DOs | Seven required classes plus `WafRules`; bindings exist | Partial: object IDs/contracts drift |
| Queues | Six queues | Fail: `sitemap-generation` absent |
| Cron | `*/5`, `*/15`, `0 * * * *`; hourly dispatcher multiplexes slower jobs | Partial: code exists, no distributed run lock |
| Environments | prod root plus staging/dev overrides | Pass |

## Durable Objects

| Object | Actual ID | Contract verdict |
|---|---|---|
| VariantInventoryDO | raw `variantId` (`src/lib/do-client.ts:39`) | Fail: no `variant:` prefix; missing `reverseConfirm`, `restoreFromSnapshot`; wrong confirm arithmetic |
| CartDO | raw `sessionId` (`src/lib/do-client.ts:286`) | Partial: alarm handoff exists; `mergeCart` does not throw canonical `NOT_IMPLEMENTED` |
| DirectCheckoutSessionDO | raw `sessionId` | Partial: cookie binding exists; empty binding and URL/session issues remain |
| IdempotencyDO | raw client key (`src/lib/do-client.ts:207-244`) | Fail: no checkout scope, no 2-hour cleanup alarm |
| BudgetCounterDO | provider+date (`src/do/budget-counter-do.ts:330-354`) | Fail: must be `budget:{provider}` |
| ProviderHealthDO | raw provider | Partial: breaker exists; ID prefix drifts |
| InvoiceCounterDO | documented daily ID | Fail: no production caller; D1 SELECT-next remains |

## Trust Primitives

| Primitive | Holds | Evidence | Deviation |
|---|---|---|---|
| Constant-time HMAC | Yes | `src/lib/security.ts:9-29` | Length check leaks length only; signatures fixed-length |
| Webhook raw-body HMAC before DB | Partial | `src/pages/api/payments/webhook.ts:18-41` | Generic signature headers, optional API-key check, body-hash event fallback |
| CSRF double-submit | Partial | `src/lib/csrf.ts:24-37`; `src/middleware.ts:84-90` | Three exemptions, not only login; previous key not accepted; rotation placeholder |
| PII logger | Partial | `src/lib/pii-scrubber.ts:9-78` | Missing required keys; raw `console.*` in three source files; no lint gate |

## Acceptance Gates

| Gate | Required | Actual |
|---|---:|---:|
| Absolute guardrails | 50 | 17 pass, 15 partial, 18 fail/unverified |
| Pre-release checks | 34 | 9 pass, 7 partial, 18 fail/unverified |
| Mandatory test files | 31 | 8 present, 23 missing |
| FraudBD cases | 25 | 25 identifiers present |
| Drift checks | 46 | D-01..D-44 only |
| Migration gate | 9 checks | 47 migrations; 40 multi-statement; 0 preflights |
| Dependency audit | no high findings | 11 high, 8 moderate |

No existing test suite was executed because its `pretest` generates `public/sw.js`, violating this engagement's read-only rule. Static inventory found 67 test files and 563 test declarations.
