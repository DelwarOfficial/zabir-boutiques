# Gap Fix List

## P0 - Must Fix Before Production

| ID | Gap | Fix |
|---|---|---|
| GAP-P0-001 | Local migration dry-run cannot complete because existing migration `0003_staff_operations_v2.sql` fails on partially migrated local D1 state with `duplicate column name: created_by`. | Reset/recreate local D1 for clean dry-run or make old migrations idempotent through a repair strategy. Re-run all migrations from `0001` through latest. |
| GAP-P0-002 | Completed. Reservation IDs are now threaded consistently from `VariantInventoryDO.reserve()` into D1 `stock_reservations.id`, then reused for release, confirm, and cleanup flows. | Expand deeper end-to-end failure/retry coverage if new reservation entry points are added later. |
| GAP-P0-003 | Completed. Expired reservation cleanup now uses `created_at < datetime('now', '-15 minutes')`, `release_requested_at IS NULL`, atomic claim/stamp, then DO release plus D1 finalize steps. | Keep concurrency tests growing if cleanup logic becomes more complex. |

## P1 - High Priority Plan Compliance

| ID | Gap | Fix |
|---|---|---|
| GAP-P1-001 | Partially completed. Added focused FraudBD Section 37 core circuit-breaker coverage for thresholding, 60s window behavior, open fallback, half-open recovery, 4xx non-failure behavior, malformed-success failure behavior, and other core breaker semantics. | Expand this into the full CB-01 through CB-25 matrix with queue retry/DLQ and performance-path fixtures. |
| GAP-P1-002 | Partially completed. FraudBD external checks now write `api_audit_logs` entries for success, error, timeout, and circuit-open fallback through the canonical adapter, and 4xx/malformed-body semantics are aligned with the breaker rules. | Expand coverage to include every state-transition/audit permutation from the full Section 37 suite. |
| GAP-P1-003 | Completed. Fraud queue naming/config now uses canonical `fraud-audit` wiring in `wrangler.jsonc`, `src/queues/consumers.ts`, and related bindings. | Keep async-only enrichment behavior as new fraud events are added. |
| GAP-P1-004 | Completed for current repo-scoped providers. Payment, image, AI, fraud, email, Turnstile, and Cloudflare cache purge paths now run through canonical `src/lib/integrations/{provider}/` adapters. | Courier remains the primary provider area still needing equivalent adapter coverage if/when that flow is expanded. |
| GAP-P1-005 | Completed. `src/lib/ai-content.ts` and `src/lib/ai-client.ts` now use canonical DeepSeek and Workers AI adapters; OpenAI path was removed. | Broader route-level AI tests can still be expanded later if new AI entry points are added. |
| GAP-P1-006 | Completed for the current AI generation path. Staff/product-content fallback coverage now includes adapterized Workers AI fallback behavior and DeepSeek-path verification tests. | Add route-level preflight/DO-failure tests later only if that route becomes more complex. |
| GAP-P1-007 | Completed. `BudgetCounterDO` loads provider limits from D1 `ai_budget_limits`, caches them in DO storage, and applies owner override semantics. | Add extra admin-path tests if config editing UI becomes more dynamic. |
| GAP-P1-008 | Completed for the active UddoktaPay path. Checkout creation, verification, refund, and reconciliation now use the canonical UddoktaPay adapter, while redirects still do not mark payments successful on their own. | SSLCommerz remains out of active repo flow unless reintroduced. |
| GAP-P1-009 | Completed. POS same-day void now restores stock through `VariantInventoryDO.reverseDirectSale()` while keeping invoice-ledger semantics intact. | Add more void/reversal replay tests if POS flows expand. |
| GAP-P1-010 | Completed. Core DO classes now expose contract-style methods and declare `implements` for the Section 36 contract interfaces while preserving fetch-based routing. | Expand contract assertions if new DO actions are added later. |
| GAP-P1-011 | Completed. Abandoned-cart queue processing now re-checks conversion state and sends a real provider email through `sendAbandonedCartEmail()`. | Improve cart-recovery UX copy/linking if a richer restore flow is added later. |
| GAP-P1-012 | Partially completed. Added migration fixture coverage for forward/rollback SQL across `0021`-`0028`. | Add DB-backed migration execution fixtures and invalid-insert cases when local D1 migration environment is fully available. |

## P2 - Complete Plan Coverage

| ID | Gap | Fix |
|---|---|---|
| GAP-P2-001 | Completed. Added `/about`, `/privacy`, `/terms`, `/return-policy`, and `/size-guide` as prerendered Astro pages. | Expand launch-copy/legal copy if business wording changes. |
| GAP-P2-002 | Completed. Added Section 36 contract files and adopted `implements` on the core DO classes where practical. | Extend contract assertions if new DO actions are added later. |
| GAP-P2-003 | Completed. Added `scripts/audit/audit-drift.ts` with all 35 checks, a completeness gate, output generation, and zero-finding validation against the current repo state. | Integrate into CI when workflow changes are in scope. |
| GAP-P2-004 | Guardrail operational docs and dashboard are not complete. | Add `docs/guardrail-owners.md`, `docs/audit/` templates, and `/staff/guardrails` read-only dashboard if in current milestone scope. |
| GAP-P2-005 | Partially completed. Added focused provider adapter tests covering AI, payment, fraud, Turnstile, cache purge, image compression, and abandoned-cart email paths. | Expand to a fuller matrix for courier and exhaustive retry/schema fixtures if required for compliance sign-off. |
| GAP-P2-006 | R2 bucket names in `wrangler.jsonc` use `zabir-media`, while Master Plan lists product images, email templates, logs, backups, reports buckets. | Align bucket bindings/names or document a launch waiver. |
| GAP-P2-007 | Some static route coverage from Section 3.4 is absent for collections/blog. | Add route files or document out-of-scope waiver for launch. |
| GAP-P2-008 | Full Cloudflare Access/Zero Trust coverage cannot be verified from repo alone. | Manually audit Cloudflare dashboard for `/staff/*` and `/api/staff/*` Access policies. |
| GAP-P2-009 | Full build/typecheck via Astro is blocked by Wrangler remote auth in this environment. | Configure local Cloudflare proxy behavior or run after `wrangler login` in CI/dev environment. |
| GAP-P2-010 | `npm audit` reports 12 vulnerabilities after dependency install. | Triage dependency vulnerabilities separately; avoid breaking upgrades without test/build confirmation. |
