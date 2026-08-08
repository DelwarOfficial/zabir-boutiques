# 01 — System Truth Sheet (REDTEAM Step 1)

**Audit:** Zabir Boutiques V8 red-team review
**Date:** 2026-08-08
**Repo HEAD:** migration `0047_create_goods_receipts.sql` (drift vs V8 plan head `0039` — see conflict C1)
**Authority:** `Zabir_Boutiques_Master_Plan_V8_Part-1.md`, `Part-2.md`, `V8_MIGRATION_PLAN.md`

> Every later finding references this sheet. All evidence is file:line-anchored, read at HEAD.

---

## 1.1 Architecture (verified from `wrangler.jsonc`)

| Layer | Binding(s) | Value / note |
|---|---|---|
| Worker | `name: zabirboutiques`, `main: ./src/entry-cloudflare.ts` | `compatibility_date 2026-06-04`, `nodejs_compat` |
| Astro | `output: 'server'` (`astro.config.mjs:9`), `session: false`, `@astrojs/cloudflare` advanced mode | ✅ server mode; `'static'`/`'hybrid'` absent |
| D1 | `DB` → `zabir-db` | 1 database (prod; staging/dev variants in `env`) |
| KV | `CACHE`, `SESSION` | 2 namespaces (V8 §6.4 names 6; only 2 bound — see note) |
| R2 | `MEDIA` `zabir-product-images`, `BACKUPS` `zabir-backups`, `LOGS` `zabir-logs`, `EMAIL_TEMPLATES` `zabir-email-templates-prod`, `REPORTS` `zabir-reports` | ⚠️ email-templates bucket name has `-prod` suffix vs V8 §6.5 bare `zabir-email-templates` |
| Workers AI | `AI` (remote) | |
| Analytics Engine | `ANALYTICS` → `zabir_metrics` | |
| Cron | `*/5 * * * *`, `*/15 * * * *`, `0 * * * *` | multiplexed in `src/lib/cron-dispatch.ts` |
| Queues | 6 producers + 6 consumers | `payment-webhooks`(DLQ), `order-emails`, `image-processing`, `fraud-audit`(DLQ), `d1-backup`(DLQ), `cart-activity` |

### Durable Objects (8) — single-writer invariant

| DO binding | Class | Object ID format (actual) | V8 §6.6 mandated | Match? |
|---|---|---|---|---|
| `VARIANT_INVENTORY_DO` | VariantInventoryDO | `idFromName(variantId)` raw | `variant:{variant_id}` | ❌ no prefix |
| `IDEMPOTENCY_DO` | IdempotencyDO | `idFromName(key)` raw | `idem:{key}` | ❌ no prefix; also **no alarm** (records never self-clean) |
| `AI_BUDGET` | BudgetCounterDO | `{provider}:{date}` | `budget:{provider}` | ❌ wrong format (G49) |
| `WAF_RULES` | WafRules | raw | not in V8 §6.6 (8th DO) | n/a |
| `CART_DO` | CartDO | `idFromName(sessionId)` raw | `cart:{session_id}` | ❌ no prefix (alarm handoff ✅) |
| `DIRECT_CHECKOUT_DO` | DirectCheckoutSessionDO | `idFromName(sessionId)` raw | `buy:{session_id}` | ❌ no prefix |
| `PROVIDER_HEALTH_DO` | ProviderHealthDO | `idFromName(provider)` raw | `provider:{name}` | ❌ no prefix |
| `INVOICE_COUNTER_DO` | InvoiceCounterDO | `invoice-counter:{YYYYMMDD}` (documented) | same | ⚠️ format correct but **never instantiated** (`grep INVOICE_COUNTER_DO.get src/` = 0) |

DO migrations append-only v1→v4 ✅. **6 of 8 DOs use raw unprefixed object IDs** — flat namespace, cross-type collision risk; fixing later = data migration across object space.

### Prerender whitelist (V8 §3.3 / drift D-03)

`export const prerender = true` appears in **11 route files**: 5 legal (`/about`,`/privacy`,`/terms`,`/return-policy`,`/size-guide` ✅) + **6 catalog violations** (`index.astro`, `robots.txt.ts`, `products/[slug].astro`, `categories/[slug].astro`, `collections/[slug].astro`, `blog/[slug].astro` ❌ RT-009). Waived under W-2026-01 (M1/M13-bound). `prerender = false` appears nowhere ✅.

---

## 1.2 Trust primitives — root of trust (direct read)

| Primitive | File | Invariant holds? | Evidence | Deviation |
|---|---|---|---|---|
| `security.ts` | `src/lib/security.ts:9-30` | ✅ Y | `timingSafeEqualHex` byte-XOR constant-time loop (L9-14); HMAC-SHA256 via `crypto.subtle` (L23-30); `crypto.getRandomValues` (L18); `verifyCsrfToken` uses CT compare (L55) | None in this file. Note: CT primitive not reused everywhere (K-29). |
| `payment-webhook-ingress` | `src/lib/payment-webhook-ingress.ts` | ⚠️ Partial | HMAC over `rawBody` before any DB write (L13-22 ✅); `recordWebhookReceipt` `INSERT OR IGNORE` + `changes===1` (L71-79 ✅) | **PAY-003 open**: `readWebhookSignature` accepts `X-UddoktaPay-Signature` \|\| `X-Signature` \|\| `Signature` (L24-31). **Event-id fallback** to `sha256(rawBody)` (L44-53) weakens replay protection (K-06). Dedup is on body-hash id, NOT `UNIQUE(provider, provider_event_id)`. |
| `csrf.ts` | `src/lib/csrf.ts` | ✅ Y | Token `nonce.HMAC(nonce)` (via security.ts); cookie `__Host-csrf-token; HttpOnly; Secure; SameSite=Strict` (L10,17); 3 checks: presence / equality / signature (L28-36) | L31 `cookieToken !== headerToken` non-constant-time (low risk — equality of two client copies; the real check is the CT HMAC verify). "Only login exempt" enforced in middleware, not here. |
| `pii-scrubber.ts` | `src/lib/pii-scrubber.ts` | ⚠️ Partial | `safeLog` chokepoint exists (L74-78); PHONE/EMAIL regex scrub (L25-29) | `PII_KEYS` (L9-23) **omits** `nid`/`national_id`/`passport`/`postal_code`/`full_name`/`name`/`dob`/`date_of_birth` (K-30). **No ESLint config** — `safeLog` is sanctioned but unenforced; raw `console.*` allowed anywhere. |

---

## 1.3 Guardrails inventory (§30, 50 rules)

From the traceability pass: **~22 Implemented, ~16 Partial, ~9 Missing/Conflicting, 3 Unverifiable** of 50. Heaviest P0 load in Cluster 1 (Money) + Cluster 2 (Inventory). Full matrix in `docs/audit/drift-v8-landing-2026-08-07.md` (traceability section).

## 1.4 Drift codes (§38, D-01..D-46)

`scripts/audit/audit-drift.ts` contains **44 checks** (D-01..D-44); gate at `main()` asserts `checks.length !== 44`. V8 §38.4 specifies **46**. **ADR 0001** (`docs/adr/0001-audit-drift-v8-realignment.md`) flags this + two **inverted** checks:
- **D-19** enforces the retired `VAT_RATE_PERCENT` (would fail a correct V8 codebase).
- **D-23** enforces the retired `idx_stock_reservations_order_active` (would fail a correct V8 codebase).

The merge gate is currently enforcing V7, not V8.

## 1.5 Acceptance gates & KPIs

| Gate | Target | Current state |
|---|---|---|
| 50 guardrails | all satisfied or waived | ~28 satisfied, ~22 partial/missing |
| 27 mandatory tests (§37.0) | all green | **1 of 27** by canonical name (`cart-do-alarm-handoff`); oversell test #1 absent |
| 25 FraudBD CB tests (§37.1) | all green | present (single consolidated file, not 25-file layout) |
| 46 drift checks | 0 active P0 | **0 active, 6 waived** (W-2026-01) — but gate is V7-aligned |
| Performance (LCP/INP/TTFB) | LCP<2.5s, INP<200ms, checkout TTFB<800ms | not run this audit |
| `payment_webhook_latency_ms` p99 | <5000ms | not measured |
| `cache_hit_rate` | ≥70% | not measured |

---

## Conflicts requiring Owner decision

| # | Conflict | Impact |
|---|---|---|
| C1 | Migration head `0047` vs V8 plan head `0039`; repo `0040-0047` occupy plan's numbers | V8 schema migrations blocked; must land at `0048+` |
| C7 | Order state machine is V7 (missing `created`/`confirmed`/`processing`) | auto-confirm unreachable; schema rebuild of live `orders` table |
| C8 | `confirm()` decrements `stock` (V8 §11.3 mandates invariant) | inventory arithmetic self-contradictory |
| C9 | 6 of 8 DO object IDs raw (no V8 prefixes) | namespace-collision risk; expensive to defer |
| C10 | Migration `0034` creates D1 tables "to replace" the DOs | contradicts V8 §6.6 |
