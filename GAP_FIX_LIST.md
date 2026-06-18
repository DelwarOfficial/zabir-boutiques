# Gap Fix List

## P0 - Must Fix Before Production

| ID | Gap | Fix |
|---|---|---|
| GAP-P0-001 | Local migration dry-run cannot complete because existing migration `0003_staff_operations_v2.sql` fails on partially migrated local D1 state with `duplicate column name: created_by`. | Reset/recreate local D1 for clean dry-run or make old migrations idempotent through a repair strategy. Re-run all migrations from `0001` through latest. |
| GAP-P0-002 | Reservation lifecycle still does not fully thread `reservation_id` from `VariantInventoryDO.reserve()` through D1 `stock_reservations`, checkout release, confirm, and cleanup paths. | Refactor `reserveVariants`, `releaseReservedVariants`, `confirmReservedVariants`, and order insertion to persist and use DO-returned `reservation_id` everywhere. Add rollback tests for every failure branch. |
| GAP-P0-003 | Reservation cleanup cron still uses older expiry logic and does not fully implement `created_at < datetime('now', '-15 minutes')`, `release_requested_at IS NULL`, atomic claim/stamp, then DO release. | Update `cleanExpiredReservations()` to use the V7 claim-before-release cleanup contract and add concurrent cleanup race tests. |

## P1 - High Priority Plan Compliance

| ID | Gap | Fix |
|---|---|---|
| GAP-P1-001 | FraudBD Section 37 25-test circuit breaker suite is not implemented. | Add `tests/fraudbd-circuit-breaker/` with CB-01 through CB-25 fixtures and assertions. |
| GAP-P1-002 | FraudBD circuit breaker does not yet persist all state transitions and external-call audit rows to `api_audit_logs`. | Add audit writes for failure, success, open, half-open, close, timeout, malformed response, and circuit-open fallback. |
| GAP-P1-003 | FraudBD queue naming/config still has older `fraud-scoring` paths in `wrangler.jsonc` and consumers. | Rename/wire canonical `fraud-audit` queue and keep it async-only for post-checkout enrichment. |
| GAP-P1-004 | Payment, image, AI, and courier external APIs are not all behind canonical `src/lib/integrations/{provider}/` adapters. | Move direct API calls into provider adapters with timeout, retry, circuit breaker, schema validation, PII redaction, mock, and audit logging. |
| GAP-P1-005 | `src/lib/ai-content.ts` still calls DeepSeek/OpenAI directly. | Add `src/lib/integrations/deepseek/` and `src/lib/integrations/workers_ai/`; remove OpenAI unless explicitly approved by the Master Plan. |
| GAP-P1-006 | DeepSeek fallback flow is incomplete: staff AI actions do not fully preflight `canUseDeepSeek()`, fallback to Workers AI on timeout, and `recordUsage()` after success. | Wire BudgetCounterDO into staff AI generation flow and add fallback tests. |
| GAP-P1-007 | `BudgetCounterDO` has required methods but does not yet read durable config from D1 `ai_budget_limits`. | Load provider limits from D1 on first call per period, cache in DO, and enforce owner override semantics. |
| GAP-P1-008 | Checkout/payment creation does not fully initiate/reconcile UddoktaPay/SSLCommerz through canonical payment provider adapters. | Formalize payment provider contracts under integrations and ensure redirects/webhooks/reconciliation never trust redirect-only success. |
| GAP-P1-009 | POS same-day void restores D1 inventory directly instead of using `VariantInventoryDO.reverseDirectSale()` for stock restoration. | Route POS void stock restoration through `reverseDirectSale()` and keep invoice ledger immutable. |
| GAP-P1-010 | DirectCheckoutSessionDO uses binding verification, but contract-style methods from Section 36 are not fully implemented with `implements` interfaces. | Add complete contract stubs for all DOs and make concrete classes implement them. |
| GAP-P1-011 | Full abandoned-cart send path is minimal; it records queued email but does not render/send a real abandoned-cart provider email. | Add abandoned-cart email template and provider send path after consumer re-check. |
| GAP-P1-012 | Runtime schema and migration tests do not cover forward/rollback for new migrations. | Add migration fixture tests for `0021`-`0026`, including invalid inserts and rollback checks. |

## P2 - Complete Plan Coverage

| ID | Gap | Fix |
|---|---|---|
| GAP-P2-001 | Static legal/info pages are missing: `/about`, `/privacy`, `/terms`, `/return-policy`, `/size-guide`. | Add prerendered Astro pages with `export const prerender = true`. |
| GAP-P2-002 | Full Section 36 contracts directory is incomplete; only email contract was added. | Add contracts for VariantInventoryDO, BudgetCounterDO, DirectCheckoutSessionDO, CartDO, IdempotencyDO, ProviderHealthDO, PaymentProvider, AIProvider. |
| GAP-P2-003 | Drift audit script from Section 38 is not implemented. | Add `scripts/audit/audit-drift.ts` with all 35 checks and CI completeness guard. |
| GAP-P2-004 | Guardrail operational docs and dashboard are not complete. | Add `docs/guardrail-owners.md`, `docs/audit/` templates, and `/staff/guardrails` read-only dashboard if in current milestone scope. |
| GAP-P2-005 | Full provider adapter test matrix is missing for email/payment/fraud/image/AI/courier. | Add mocked schema validation, timeout, retry, circuit-breaker, sandbox/mock tests per adapter. |
| GAP-P2-006 | R2 bucket names in `wrangler.jsonc` use `zabir-media`, while Master Plan lists product images, email templates, logs, backups, reports buckets. | Align bucket bindings/names or document a launch waiver. |
| GAP-P2-007 | Some static route coverage from Section 3.4 is absent for collections/blog. | Add route files or document out-of-scope waiver for launch. |
| GAP-P2-008 | Full Cloudflare Access/Zero Trust coverage cannot be verified from repo alone. | Manually audit Cloudflare dashboard for `/staff/*` and `/api/staff/*` Access policies. |
| GAP-P2-009 | Full build/typecheck via Astro is blocked by Wrangler remote auth in this environment. | Configure local Cloudflare proxy behavior or run after `wrangler login` in CI/dev environment. |
| GAP-P2-010 | `npm audit` reports 12 vulnerabilities after dependency install. | Triage dependency vulnerabilities separately; avoid breaking upgrades without test/build confirmation. |
