<<<<<<< HEAD:Zabir_Boutiques_Master_Plan - Part-2.md
# Zabir Boutiques Master Plan V7   Part-2



## 26. Environment Separation and CI/CD

### 26.1 Environments

| Property | Production | Staging | Development |
|---|---|---|---|
| Domain | `zabirboutiques.com` | `staging.zabirboutiques.com` | `dev.zabirboutiques.com` |
| D1 | `zabir-prod-db` | `zabir-staging-db` | `zabir-dev-db` |
| R2 | `zabir-product-images` | `zabir-product-images-staging` | `zabir-product-images-dev` |
| KV | prod namespaces | staging namespaces | dev namespaces |
| DO | prod namespaces | staging namespaces | dev namespaces |
| Queues | prod queues | staging queues | dev queues |
| Secrets | live keys | sandbox keys | mock keys |
| Data | real | anonymized copy | seed data |

### 26.2 CI Pipeline

1. Install dependencies.
2. Type check.
3. Lint.
4. Unit tests.
5. D1 migration dry-run.
6. D1 constraint tests with invalid inserts.
7. Astro build.
8. Bundle size check.
9. Lighthouse CI on product and checkout.
10. Security checks: no secrets, no PII logs, CSP present.
11. Preview deploy for non-main branches.
12. Manual approval for production.
13. Production deploy on main.
14. Post-deploy smoke tests.
15. Targeted cache purge.

### 26.3 Migration Rules

- Numbered SQL migrations.
- SQLite/D1 syntax only.
- Every migration has a rollback file where possible.
- Run staging first.
- 24-hour soak before production for risky schema changes.
- Never edit an already-applied migration.

---

## 27. Disaster Recovery

### 27.1 Recovery Objectives

| Metric | Target |
|---|---:|
| RPO | 6 hours |
| RTO | 2 hours |
| D1 backup | Every 6 hours |
| Backup retention | 30 daily, 12 monthly |
| Restore test | Weekly to staging |

### 27.2 Backup Flow

- Cron triggers backup worker every 6 hours.
- D1 export stored in R2 `zabir-backups`.
- Metadata includes timestamp, migration version, row counts, checksum.
- Weekly restore to staging validates backup.
- Alert on backup failure.

### 27.3 Restore Procedure

1. Identify latest valid backup.
2. Create new D1 database or clear target.
3. Restore SQL dump.
4. Verify row counts and checksum.
5. Run schema integrity tests.
6. Update bindings if database changed.
7. Purge caches.
8. Smoke test product page, checkout, staff login, POS.
9. Monitor for 30 minutes.

### 27.4 Incident Response

| Severity | Example | Response |
|---|---|---|
| P1 | checkout down, payment broken, data corruption | Immediate response, update every 30 min, post-mortem within 48h |
| P2 | slow checkout, partial email/payment delay | Response within 1h, post-mortem if revenue impact |
| P3 | UI bug, non-critical delay | Triage in normal workflow |

If data corruption is suspected, stop writes before trying fixes.

---

## 28. Compliance and Privacy

### 28.1 Data Minimization

Guest checkout collects only:

- Name.
- Phone.
- Delivery address.
- Optional email if customer chooses email updates.

Do not collect unnecessary date of birth, NID, gender, or payment card details.

### 28.2 Data Retention

| Data | Retention |
|---|---:|
| Customer PII | 3 years unless deletion requested |
| Orders | 7 years |
| Payment records | 7 years |
| Logs | 90 days hot, 1 year cold if redacted |
| Backups | 30 daily, 12 monthly |
| Audit logs | 7 years or business/legal requirement |

### 28.3 Customer Rights

- `/api/me/data` exports customer data after phone verification.
- `/api/me/data` deletion anonymizes PII while preserving order integrity.
- Deletion request processing window: 30 days.

### 28.4 PCI Scope

- Use hosted payment pages only.
- No custom card forms.
- No card data stored or logged.
- Payment webhook payloads redacted.
- Annual PCI SAQ A checklist.

---

## 29. Implementation Phases

### Phase 1: Core Commerce, Weeks 1-6

| Milestone | Features | Priority |
|---|---|---|
| M1 Product Catalog | Product CRUD, variants, categories, slug URLs, R2 image upload, static snapshots | P0 |
| M2 Cart + Checkout | CartDO, checkout API, idempotency, phone normalization, server pricing | P0 |
| M3 Payment | UddoktaPay, SSLCommerz fallback interface, HMAC webhook, reconciliation | P0 |
| M4 Inventory | VariantInventoryDO, reservation lifecycle, rollback, cleanup cron | P0 |
| M5 Staff v1 | Login, RBAC, order list/detail, confirm/cancel | P0 |

### Phase 2: Operations, Weeks 7-12

| Milestone | Features | Priority |
|---|---|---|
| M6 Security | WAF, Turnstile, Zero Trust, CSP, CSRF, rate limits | P0 |
| M7 Observability | Metrics, logs, alerts, PII scrubbing | P1 |
| M8 Search + SEO | D1 FTS5, autocomplete, JSON-LD, sitemap, robots | P1 |
| M9 Email | Provider adapter, order/status emails, abandoned cart flow, email_log | P1 |
| M10 Order Lifecycle | Returns, refunds, shipping labels, FraudBD, staff-assisted orders | P1 |
| M11 POS | Dedicated invoice ledger, thermal receipt, POS history, void flow | P1 |

### Phase 3: Growth and Hardening, Weeks 13-18

| Milestone | Features | Priority |
|---|---|---|
| M12 AI | Workers AI, DeepSeek fallback, BudgetCounterDO, moderation | P2 |
| M13 Performance | Cache API/SWR, image variants, Lighthouse CI, Bundlewatch | P2 |
| M14 Environment | dev/staging/prod separation, preview deploys, migration runner | P2 |
| M15 DR | D1 backups to R2, restore tests, incident playbooks | P2 |
| M16 Compliance | Data export/deletion, cookie consent, PCI SAQ A, accessibility audit | P2 |

---

## 30. Absolute Guardrails

These rules are mandatory. Existing valid rules are preserved; rules that were underspecified have been clarified; new rules are appended at the end to close identified gaps.

**Enforcement:** Listing rules is not enough. Section 34 defines the operating protocol that keeps these guardrails alive — roles (Guardrail Owner, ARB, Release Captain), review cadence (per-PR / weekly / per-release / monthly / quarterly / annual), the pre-release audit checklist (Section 34.4), the waiver process (Section 34.7), the amendment process (Section 34.8), and the incident response matrix for guardrail violations (Section 34.6). Section 38 defines the drift audit playbook that catches silent drift in the main branch and in-flight PRs.

1. Use `output: 'server'` with `@astrojs/cloudflare`; routes are dynamic by default. **`output: 'static'` is FORBIDDEN anywhere in the project.** Any file, README, or generated note that says `output: 'static'` or `output: 'hybrid'` must be corrected to `output: 'server'`.
2. Static pages opt in with `export const prerender = true`. Dynamic routes MUST NOT set `prerender = false` (redundant noise — they are dynamic by default).
3. Never move pricing authority to the browser.
4. Never trust browser-supplied totals, delivery fees, discounts, VAT, or stock.
5. Never use floating-point money. **Exception:** AI cost tracking in `BudgetCounterDO.recordUsage()` uses float USD (Section 24.2); all other money is integer paisa.
6. CartDO is the active cart source of truth during a session. CartDO MUST persist its state to D1 `cart_activity` via an alarm (5-minute inactivity backoff) so cart state survives Worker restart. The `cart-activity` queue is a batching optimization for fresher D1 rows, not the durability path.
7. KV must not store authoritative cart, stock, payment, or order state.
8. Buy Now must create a direct checkout session (`DirectCheckoutSessionDO`) and must not mutate the normal cart. DirectCheckoutSessionDO has ZERO interaction with CartDO — no shared ID, no shared state, no shared mutation path.
9. Buy Now submit must use the same secure checkout engine as normal checkout.
10. Never create an order before successful reservation.
11. If D1 order write fails after reservation, immediately release all reservations.
12. Cleanup cron is only a safety net, not primary rollback. The reservation cleanup cron runs **hourly** (`0 * * * *`), selects `stock_reservations WHERE created_at < NOW() - INTERVAL 15 minutes AND release_requested_at IS NULL`, and calls `VariantInventoryDO.release()` for each. Full spec in Section 12.3.
13. Short-lived Durable Objects must use alarm-based cleanup.
14. FraudBD direct checkout call timeout is 1.5 seconds with **zero retries** during checkout. The circuit breaker opens after 5 failures / 60s, stays open for 5 minutes, and uses fallback score `50` (forces `pending_review`). Retries happen ONLY in the `fraud-audit` queue (3s timeout, 1 retry, 2s backoff). Full spec in Section 11.2.
15. COD quantity rule uses `SUM(quantity)`.
16. POS does not use checkout reservation, but POS stock deduction must pass through `VariantInventoryDO.directSale()`. If `directSale()` succeeds but the D1 invoice write fails, POS MUST call `VariantInventoryDO.reverseDirectSale()`, log a P1 audit event, and return an error to the POS UI. Full contract in Section 11.3.
17. POS must never write inventory directly to D1.
18. Staff-assisted phone/Messenger/WhatsApp orders use checkout pipeline.
19. All payment webhooks verify HMAC before processing.
20. All staff routes require Zero Trust + RBAC.
21. No PII in logs.
22. All secrets live in Cloudflare Secrets.
23. All external APIs must use provider adapters; no direct third-party fetch from route handlers.
24. FraudBD, UddoktaPay, DeepSeek, Imagify, email, and courier integrations must have timeout, retry, circuit breaker, mock, and sandbox/prod config.
25. All payment provider events must be verified and reconciled server-side.
26. Browser must upload original images only; production variants must be generated by queue/API pipeline.
27. All image optimization failures must fall back to original/R2 variants without blocking product publish.
28. CartDO must not synchronously write D1 on every cart mutation; it MUST use (a) the alarm-based persistence path for durability (5-min inactivity backoff) and (b) the `cart-activity` queue for batched fresher writes. Both mechanisms are mandatory.
29. The email provider follows the **same adapter pattern as payments**: `src/lib/integrations/email/{provider}/`, with interface `sendEmail(request: SendEmailRequest): Promise<SendResponse>`, swapped via the `EMAIL_PROVIDER` environment variable. Full spec in Section 17.1.
30. Resend is the default transactional email provider; Cloudflare Email Sending is optional after account-level testing.
31. All migrations use D1-compatible SQL.
32. D1 constraints are enforced and tested, including the partial unique index `idx_stock_reservations_order_active` on `stock_reservations(order_id) WHERE status = 'active'` (Section 12.3) which prevents one order from holding two active reservations.
33. All staff PII access is audit logged.
34. Every public page must meet performance budget.
35. Accessibility is mandatory.
36. AI-generated public content requires staff review.
37. Expensive add-ons require Owner approval.
38. **(New) D1 schema completeness:** the `otp_secrets`, `api_audit_logs`, and `ai_budget_limits` tables MUST exist (Section 6.1). `otp_secrets` is required for Owner TOTP 2FA (Section 18.1). `api_audit_logs` is required for `ProviderHealthDO` circuit breaker state and external API audit (Sections 2.4, 2.5, 11.2). `ai_budget_limits` is required for `BudgetCounterDO` durable config (Section 24.2).
39. **(New) Abandoned cart definition:** a cart is abandoned when `last_cart_update_at` is older than 24 hours (SQL: `< datetime('now', '-24 hours')`), `abandoned_email_sent_at IS NULL`, `converted_order_id IS NULL`, `consent_status = 'allowed'`, and `customer_email IS NOT NULL`. Cron deduplicates on `customer_email` via `ROW_NUMBER()` window. Full SQL pseudocode in Section 17.3.
40. **(New) Buy Now session fixation mitigation:** `DirectCheckoutSessionDO.session_id = HMAC(secret, timestamp + random)`. Every request to `/buy-now/*` and `/api/buy-now/*` MUST verify Origin and User-Agent hash against the stored session values. Mismatch → 403 + delete the DO. The DO is deleted immediately after the order is successfully created. Full contract in Section 10.6.
41. **(New) VAT server-side computation:** checkout Step 8 (Section 11.1) MUST compute VAT server-side as `vat_paisa = round(subtotal_paisa * vat_rate / 100)` where `vat_rate` comes from `VAT_RATE_PERCENT` (default `0` for launch). The browser must never supply VAT.
42. **(New) BudgetCounterDO contract:** DeepSeek has a hard daily limit of $5.00 USD (UTC). Staff actions MUST call `canUseDeepSeek()` before the call and `recordUsage()` after success. If `canUseDeepSeek()` times out, fall back to Workers AI (safe path) — never block the staff action. Full spec in Section 24.2.
43. **(New) Reservation race prevention:** `stock_reservations` has a partial unique index `idx_stock_reservations_order_active` on `(order_id) WHERE status = 'active'` (migration 0027) so one order has at most one active reservation. The `release_requested_at` stamp prevents double-release between concurrent cron ticks. Full spec in Section 12.3.

---

## 31. AI Coding Agent Instructions

When an AI coding agent works on this repository, it must follow this order:

1. Read this Master Plan first.
2. Treat this document as higher priority than AGENTS.md, taste files, or generated implementation notes.
3. If another file says `output: 'hybrid'`, update that file to use `output: 'server'`.
4. If another file says cart lives in KV, update it to CartDO source of truth.
5. If implementing checkout, include reservation rollback tests.
6. If implementing abandoned cart, create D1 cart_activity index and cart-activity queue flow.
7. If implementing POS, keep it separate from online orders but route stock mutation through VariantInventoryDO.directSale().
8. If implementing staff-assisted order, use checkout pipeline.
9. Every feature must include tests for failure paths, not only happy paths.
10. Before PR completion, run conflict checklist below.

### Agent Conflict Checklist

- [ ] `output: 'server'` is used in astro.config.mjs.
- [ ] Static pages export `prerender = true`.
- [ ] Cart authoritative state is in CartDO.
- [ ] KV cart JSON is not used.
- [ ] Checkout ignores client price/totals.
- [ ] Money uses integer paisa (exception: AI cost tracking in BudgetCounterDO uses float USD).
- [ ] FraudBD blocking/async behavior is not mixed.
- [ ] FraudBD circuit breaker: 5 failures/60s → open 5 min → fallback score 50 → `pending_review`. Checkout = 0 retries, fraud-audit queue = 1 retry / 2s backoff.
- [ ] Reservation release exists on every failure branch.
- [ ] `stock_reservations` has the partial unique index `idx_stock_reservations_order_active` on `(order_id) WHERE status = 'active'` (migration 0027).
- [ ] Reservation cleanup cron runs hourly, selects `created_at < NOW() - 15 min AND release_requested_at IS NULL`.
- [ ] Abandoned cart has D1 queryable index (`cart_activity`).
- [ ] Abandoned cart definition: `last_cart_update_at` older than 24h (SQL `< datetime('now', '-24 hours')`), `abandoned_email_sent_at IS NULL`, `converted_order_id IS NULL`, `consent_status = 'allowed'`, deduplicated on `customer_email`.
- [ ] POS uses invoice ledger, not online orders.
- [ ] POS stock deduction uses `VariantInventoryDO.directSale()`.
- [ ] POS D1 invoice write failure calls `VariantInventoryDO.reverseDirectSale()` + logs P1 audit event.
- [ ] Browser uploads original image only; variants are queue/API generated.
- [ ] Short-lived Durable Objects use alarm cleanup.
- [ ] CartDO publishes `cart-activity` queue messages instead of synchronous D1 writes.
- [ ] CartDO has a 5-minute inactivity alarm that persists state to D1 `cart_activity` (durability path).
- [ ] Resend is default email provider; Cloudflare Email Sending is optional.
- [ ] Email adapter follows the same pattern as payments: `src/lib/integrations/email/{provider}/`, interface `sendEmail(request): Promise<SendResponse>`, swapped via `EMAIL_PROVIDER` env var.
- [ ] FraudBD checkout timeout is 1.5 seconds with zero retries and pending_review fallback.
- [ ] Buy Now does not mutate normal cart. DirectCheckoutSessionDO has ZERO interaction with CartDO.
- [ ] Buy Now `session_id = HMAC(secret, timestamp + random)`. Origin + User-Agent hash verified on every request.
- [ ] DirectCheckoutSessionDO is deleted immediately after the order is successfully created.
- [ ] Buy Now submit uses secure checkout engine.
- [ ] Checkout Step 8 computes VAT server-side from `VAT_RATE_PERCENT` (default 0).
- [ ] Staff routes have RBAC middleware.
- [ ] Webhooks verify HMAC.
- [ ] External APIs use provider adapters only.
- [ ] FraudBD/UddoktaPay/DeepSeek/Imagify/Email/Courier have timeout, retry, circuit breaker, and mock tests.
- [ ] D1 tables `otp_secrets`, `api_audit_logs`, `ai_budget_limits` exist with the schema in Section 6.1.
- [ ] `BudgetCounterDO` exposes `recordUsage(provider, tokens, cost_usd)` and `canUseDeepSeek(): Promise<boolean>`.
- [ ] DeepSeek daily limit = $5.00 USD (UTC). `canUseDeepSeek()` timeout → fall back to Workers AI, never block.
- [ ] `output: 'static'` does NOT appear anywhere in the project (including docs, README, AGENTS.md).
- [ ] Dynamic routes do NOT set `prerender = false` (redundant noise — they are dynamic by default under `output: 'server'`).
- [ ] No PII logs.
- [ ] Tests cover D1 constraint failures.

### Agent Awareness of Operational Sections

AI coding agents working on this repo MUST also be aware of the operational sections that turn these rules into living practice:

- **Section 34** — Guardrail Review & Enforcement Protocol. If a PR cannot satisfy a guardrail, the agent MUST flag this in the PR description and request a waiver (Section 34.7) rather than silently violating the rule.
- **Section 35** — D1 Migration Sequencing. Any schema-touching PR MUST reference the migration number (e.g. "implements migration 0024") and include both forward and rollback SQL plus a test fixture.
- **Section 36** — TypeScript Contract Stubs. Any DO or adapter implementation MUST `implements` the corresponding interface from `src/lib/contracts/`. A PR that introduces a DO class without `implements` is incomplete.
- **Section 37** — FraudBD Circuit Breaker Tests. Any PR touching `src/lib/integrations/fraudbd/`, `src/durable-objects/provider-health-do.ts`, or `src/lib/checkout/fraud-check.ts` MUST keep all 25 CB tests passing.
- **Section 38** — Drift Audit Playbook. The agent SHOULD self-audit its own PR using the `audit-drift.ts` script (Section 38.4) before requesting review. Any P0 finding blocks merge.

Agents that encounter a guardrail they believe is wrong MUST NOT work around it. They MUST propose an amendment per Section 34.8 (open an ADR) and let the ARB decide.

---

## 32. Feature Coverage Matrix

This matrix confirms that the V7 plan includes the required business, technical, operational, and AI-assisted features.

| Feature | V7 Coverage |
|---|---|
| Astro 6 | Included, using `output: 'server'` (universal). `output: 'static'` is FORBIDDEN anywhere in the project. Static pages opt in with `prerender = true`; dynamic routes require NO flag. |
| Cloudflare Pages + Workers | Included |
| React 19 Islands | Included |
| Tailwind CSS design tokens | Included |
| D1 schema and constraints | Included and clarified. Adds `otp_secrets`, `api_audit_logs`, `ai_budget_limits` tables (Section 6.1) and the partial unique index `idx_stock_reservations_order_active` on `stock_reservations(order_id) WHERE status = 'active'` (Section 12.3, migration 0027). |
| R2 images | Included |
| KV sessions/flags/redirects | Included, cart removed from authoritative KV |
| Durable Objects | Included and clarified. `CartDO` now has 5-minute inactivity alarm for D1 persistence (Section 6.3 / 9.1). |
| VariantInventoryDO | Included with rollback contract. Adds `reverseDirectSale()` compensating transaction method (Section 11.3). |
| CartDO | Included as normal cart source of truth. Alarm-based D1 persistence resolves sync contradiction (Section 6.3 / 9.1). |
| DirectCheckoutSessionDO | Included for Buy Now temporary sessions. Explicit zero-interaction contract with CartDO (Section 10.6). `session_id = HMAC(secret, timestamp + random)`, Origin + User-Agent hash verification, immediate delete on order success. |
| BudgetCounterDO | Included with full interface (`recordUsage`, `canUseDeepSeek`), $5.00/day UTC limit, Workers AI fallback on DO timeout (Section 24.2). |
| IdempotencyDO | Included |
| Queues | Included with corrected fraud queue role |
| UddoktaPay | Included as primary payment provider adapter with verify/reconcile flow |
| SSLCommerz fallback | Included |
| FraudBD | Included with direct checkout call, 1.5s timeout, **zero retries in checkout**, full circuit breaker spec (5 failures / 60s → open 5 min → fallback score 50 → `pending_review`), and async audit retry surface (Section 11.2). |
| Buy Now direct guest order | Included with direct landing page, DirectCheckoutSessionDO, secure checkout engine, and strict cart isolation contract (Section 10.6). |
| COD-first model | Included with clear total quantity rule |
| Partial prepayment | Included |
| Server-authoritative pricing | Included |
| Stock reservation lifecycle | Included and hardened. Hourly cleanup cron with 15-min expiry window and race-prevention unique constraint (Section 12.3). |
| Payment webhook/reconciliation | Included |
| 8-state order lifecycle | Included and extended with pending_review |
| Returns/refunds | Included |
| Staff RBAC | Included |
| Staff-assisted orders | Included |
| POS thermal receipts | Included with VariantInventoryDO direct-sale stock path and compensating `reverseDirectSale()` on D1 invoice write failure (Section 11.3 / 15.1). |
| Dedicated invoice ledger | Included |
| Shipping labels | Included |
| WAF/rate limiting | Included |
| Turnstile | Included |
| Zero Trust | Included |
| CSP/CSRF | Included |
| Secrets management | Included |
| Cache API/SWR/cache tags | Included |
| SEO/JSON-LD/sitemap/robots | Included |
| Performance budgets | Included |
| D1 FTS search | Included |
| Workers AI semantic search | Included |
| Managed search scale path | Included |
| Image variants | Included with queue/API-generated variants; browser uploads original only |
| Imagify API | Included as optional image optimization adapter with queue retry and fallback |
| Resend email | Included as default transactional provider. Email adapter follows the SAME pattern as payments: `src/lib/integrations/email/{provider}/`, interface `sendEmail(request): Promise<SendResponse>`, swapped via `EMAIL_PROVIDER` env var (Section 17.1). |
| Cart activity queue | Included for batched D1 `cart_activity` updates. Coexists with mandatory 5-minute alarm-based persistence for durability (Section 6.3). |
| Abandoned cart emails | Included with real detection mechanism. 24h definition, `abandoned_email_sent_at` / `converted_order_id` guards, `customer_email` deduplication via `ROW_NUMBER()` window, full SQL pseudocode (Section 17.3). |
| Inventory reconciliation | Included |
| Flash sale strategy | Included |
| Observability and alerts | Included |
| Environment separation | Included |
| CI/CD and migrations | Included |
| D1 backups to R2 | Included |
| Disaster recovery | Included |
| Compliance/privacy | Included |
| AI product descriptions/recommendations | Included with Workers AI primary and DeepSeek fallback. BudgetCounterDO interface and Workers AI fallback on DO timeout (Section 24.2). |
| Prompt injection protection | Included |
| Owner TOTP 2FA | Included via `otp_secrets` D1 table (Section 6.1, 18.1) |
| External API audit trail | Included via `api_audit_logs` D1 table (Section 6.1, 2.5) |
| AI budget durable config | Included via `ai_budget_limits` D1 table (Section 6.1, 24.2) |
| Server-side VAT computation | Included in checkout Step 8 (Section 11.1), driven by `VAT_RATE_PERCENT` (default 0) |
| Email adapter contract | Included, mirrors payment adapter pattern (Section 2.3, 17.1) |
| Guardrail enforcement protocol | Included — roles, cadence, pre-release audit, waivers, amendments, incident response (Section 34) |
| D1 migration sequencing | Included — 4 numbered migrations (0024–0027) with forward SQL, rollback SQL, test fixtures, pre-flight checks, CI gate, apply procedure, failure recovery (Section 35) |
| TypeScript contract stubs | Included — `src/lib/contracts/` with interfaces for all 6 DOs + EmailProvider; implementations MUST use `implements` (Section 36) |
| FraudBD circuit breaker test suite | Included — 25-test matrix (CB-01 to CB-25) covering all Section 11.2 rules, with fixtures and CI integration (Section 37) |
| Drift audit playbook | Included — 35 finding codes (D-01 to D-35), `audit-drift.ts` script, CI integration, V7 landing one-time audit (Section 38) |

---

## 33. Final Implementation Contract

This V7 plan is the implementation contract. The project must remain Cloudflare-native, cost-aware, mobile-first, SEO-friendly, and safe for ecommerce operations.

The most important engineering rule is simple:

**Static pages may sell the product, and Buy Now pages may convert the customer, but only dynamic server routes may trust data, change money, reserve stock, create orders, verify payments, send transactional emails, or change inventory.**

This contract is enforced, not aspirational. Sections 34–38 turn the rules in Section 30 into living practice:

- **Section 34** defines who enforces them (Guardrail Owners, ARB, Release Captain) and on what cadence.
- **Section 35** defines how the D1 schema evolves without losing data or locking the database.
- **Section 36** defines the TypeScript interfaces that make the DO and adapter contracts compiler-enforced.
- **Section 37** defines the test suite that proves the FraudBD circuit breaker behaves as specified.
- **Section 38** defines the audit playbook that catches drift in the main branch and in-flight PRs.

A PR that satisfies Sections 30–38 is, by definition, conformant. A PR that violates any of them is, by definition, not ready to merge.

---

## 34. Guardrail Review and Enforcement Protocol

Section 30 lists 43 Absolute Guardrails. Listing rules is not enough — they must be enforced continuously, audited on a known cadence, and signed off by accountable owners before any release that touches their domain. This section defines the operating protocol that keeps the guardrails alive.

### 34.1 Roles and Accountability

| Role | Who | Guardrail Accountability |
|---|---|---|
| **Guardrail Owner (GO)** | One named engineer per guardrail cluster | Maintains the canonical interpretation of the rule, reviews proposed changes, signs off on violations during PR review |
| **Architecture Review Board (ARB)** | Owner + Lead Engineer + Staff Engineer (3 members, rotating quarterly) | Approves any guardrail amendment, escalation, or temporary waiver |
| **Release Captain (RC)** | One engineer per release (rotates weekly) | Runs the pre-release Guardrail Audit (Section 34.4) and produces the sign-off record |
| **On-Call Engineer (OCE)** | Per the on-call rotation | Triages P0/P1 incidents caused by guardrail violations (Section 34.6) |

The mapping of guardrail clusters to GOs is maintained in `docs/guardrail-owners.md` (a single source of truth kept in the repo). A GO leaving the team triggers an ownership transfer PR within 5 business days; an unowned guardrail is a P2 finding.

### 34.2 Review Cadence

| Cadence | Audience | Scope | Output |
|---|---|---|---|
| **Per-PR (automated)** | CI + GO (on request) | Lint-level checks: `output: 'static'` presence, `prerender = false` presence, missing D1 constraint, etc. — see Section 38 for the full checklist | Pass/fail gate; PR cannot merge if any rule fails |
| **Per-PR (manual)** | PR reviewer + GO if flagged | Architecture-level review for PRs touching Sections 11, 12, 15, 24 (checkout, inventory, POS, AI budget) | Reviewer approval + GO ack comment |
| **Weekly** | RC + GO rotation | Open guardrail violations from the past week, in-flight waivers, drift findings from Section 38 playbook | `guardrail-weekly.md` digest committed to `docs/audit/` |
| **Per-release** | RC + ARB | Full Section 30 audit before any production deploy (Section 34.4) | Signed release sign-off record (Section 34.5) |
| **Monthly** | ARB | Trend analysis: violation rate by cluster, recurring drift sources, waiver aging, proposed guardrail amendments | `guardrail-monthly.md` digest; amendments proposed as ARB tickets |
| **Quarterly** | ARB + entire engineering team | Full re-read of Section 30; confirm every rule still reflects production reality; retire or amend stale rules; **document length review** — if the master plan exceeds 5,000 lines or 250 KB, the ARB MUST propose splitting Part V (Sections 34–38) into a companion `OPERATIONS.md` that Section 30 references. This keeps the core architecture document readable for new engineers while preserving the operational enforcement detail. | Updated Section 30 (via PR) + retro notes; optional OPERATIONS.md split proposal |
| **Annual** | ARB + Owner + external auditor (optional) | Independent audit: red-team attempt against the guardrails, drift benchmark vs. the original V7 baseline | `guardrail-annual.md` report to the Owner |

### 34.3 Guardrail Cluster Map

The 43 guardrails are grouped into 17 clusters, each owned by exactly one GO. Every guardrail appears in exactly one cluster — no overlaps, no orphans. This prevents "two owners means no owner" ambiguity and makes audits parallelizable. (Previous draft had overlapping clusters for guardrails 33, 34, 35 and orphaned guardrails 30 and 37; this version corrects that.)

| Cluster | Guardrail #s | Primary GO domain |
|---|---|---|
| **A. Astro & Rendering** | 1, 2 | Frontend platform |
| **B. Pricing & Money** | 3, 4, 5, 41 | Checkout engineering |
| **C. Cart & Buy Now** | 6, 7, 8, 9, 40 | Cart/checkout engineering |
| **D. Reservation & Inventory** | 10, 11, 12, 43 | Inventory engineering |
| **E. DO & Cron Lifecycle** | 13 | Platform engineering |
| **F. FraudBD** | 14 | Risk engineering |
| **G. COD & POS** | 15, 16, 17 | POS engineering |
| **H. Staff & Security** | 18, 19, 20, 21, 22 | Security engineering |
| **I. External APIs & Adapters** | 23, 24, 29, 30 | Integrations engineering |
| **J. Payments** | 25 | Payments engineering |
| **K. Images & Media** | 26, 27 | Media engineering |
| **L. CartDO Persistence** | 28, 39 | Cart engineering |
| **M. Migrations & D1 Schema** | 31, 32, 38 | Database engineering |
| **N. Performance Budget** | 33 | Frontend platform |
| **O. Accessibility** | 34 | Frontend platform |
| **P. AI & Budget** | 35, 42 | AI engineering |
| **Q. Cost & Owner Authority** | 36, 37 | Owner / Lead Engineer |

Coverage check: 2 + 4 + 5 + 4 + 1 + 1 + 3 + 5 + 4 + 1 + 2 + 2 + 3 + 1 + 1 + 2 + 2 = 43 ✓ (every guardrail accounted for, exactly once).

### 34.4 Pre-Release Guardrail Audit Checklist

Before any production deploy, the Release Captain runs the audit below and records the result in `docs/audit/release-{YYYY-MM-DD}.md`. A failing item blocks the release unless an ARB waiver (Section 34.7) is on file.

The checklist is executed by a CI job (`guardrail-audit.yml`) AND verified manually by the RC. The CI job is the source of truth; the manual check is the human backstop.

| # | Check | Method | Pass criterion |
|---|---|---|---|
| 1 | No `output: 'static'` or `output: 'hybrid'` anywhere in repo | `rg "output:\s*'(static\|hybrid)'" --glob '!**/*.md'` (excludes the master plan and docs/ — the plan's own FORBIDDEN references are documentation, not drift) | Zero hits |
| 2 | No `prerender = false` in any route file | `rg "prerender\s*=\s*false" src/pages/` | Zero hits |
| 3 | Every static route has `export const prerender = true` | AST scan of `src/pages/**/*.{astro,ts}` | 100% coverage for routes in Section 3.4 static list |
| 4 | `cart_activity` table has `abandoned_email_sent_at` column, NOT legacy pair | D1 migration dry-run schema introspection | Column exists; legacy columns absent |
| 5 | `otp_secrets`, `api_audit_logs`, `ai_budget_limits` tables exist | D1 migration dry-run | All three tables present with the schema in Section 6.1 |
| 6 | `stock_reservations` has the partial unique index `idx_stock_reservations_order_active` on `(order_id) WHERE status = 'active'` | D1 `PRAGMA index_list('stock_reservations')` | Index present and unique |
| 7 | `VariantInventoryDO` interface includes `reverseDirectSale` | TypeScript type check | Method present with the signature in Section 11.3 |
| 8 | `BudgetCounterDO` interface includes `recordUsage` and `canUseDeepSeek` | TypeScript type check | Both methods present with the signatures in Section 24.2 |
| 9 | Email adapter implements `EmailProvider.sendEmail` | TypeScript type check | Both `resend` and `cloudflare_email` adapters conform |
| 10 | FraudBD checkout call has 1.5s timeout and zero retries | Code path audit | `AbortController` with 1500ms timeout; no retry loop in the checkout path |
| 11 | FraudBD circuit breaker config matches 5/60s → 5min → score 50 | Unit test assertions (Section 37) | All test cases pass |
| 12 | POS flow calls `reverseDirectSale` on D1 invoice write failure | Code path audit + integration test | Test `pos-compensating-transaction.test.ts` passes |
| 13 | Checkout Step 8 computes VAT server-side | Code path audit | `vat_paisa` computed from `VAT_RATE_PERCENT`; no client-supplied VAT accepted |
| 14 | `DirectCheckoutSessionDO` verifies Origin + User-Agent hash on every request | Code path audit + integration test | Test `buy-now-session-fixation.test.ts` passes |
| 15 | `DirectCheckoutSessionDO` is deleted on successful order creation | Code path audit | `deleteAll()` called after D1 order write succeeds |
| 16 | CartDO arms a 5-minute inactivity alarm on every mutation | Code path audit | `setAlarm(now + 5 * 60 * 1000)` called in every mutation method |
| 17 | Reservation cleanup cron schedule is hourly | `wrangler.toml` / Cron Trigger config | `crons = ["0 * * * *"]` |
| 18 | No PII in logs | Structured log scan over the last 7 days of staging logs | Zero findings |
| 19 | All staff routes behind Zero Trust | Cloudflare Access config audit | All `/staff/*` and `/api/staff/*` paths covered |
| 20 | All webhooks verify HMAC | Code path audit | No webhook handler without `verifyHmac()` call |

Any check that cannot be automated is marked `MANUAL` and requires the RC's initials next to it in the release record.

### 34.5 Release Sign-Off Record

Each production deploy produces a signed record at `docs/audit/release-{YYYY-MM-DD}-{short-sha}.md` with this template:

```markdown
# Release Sign-Off — {YYYY-MM-DD} — {git-sha}

- Release Captain: {name}
- ARB reviewer: {name}
- Deploy window: {UTC start} → {UTC end}
- Rollback plan: {link to runbook}

## Guardrail Audit Results

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Forbidden Astro output mode absent | PASS | CI job #12345 link |
| 2 | No explicit prerender-disable on dynamic routes | PASS | CI job #12345 link |
| ... | ... | ... | ... |
| 20 | HMAC on all webhooks | PASS | Manual review (RC initials: ___) |

## Waivers in effect for this release

- (none) OR
- Waiver W-{YYYY}-{NN}: {description}, ARB ticket #{number}, expires {date}

## Incidents during deploy

- (none) OR
- P{N} incident {link}: {summary}

## Sign-off

- Release Captain: ___ (date)
- ARB reviewer: ___ (date)
```

A release without this record is treated as an unapproved deploy and triggers a P2 post-incident review.

### 34.6 Incident Response for Guardrail Violations

When a guardrail is violated in production (whether or not it caused customer impact), the response follows the standard incident severity matrix with one addition: a **Guardrial Violation (GV)** tag is attached to the incident for trend analysis.

| Severity | Trigger | Response | Post-incident |
|---|---|---|---|
| P0 | Guardrail violation caused data corruption, oversell, money loss, or PII leak | Immediate page; stop writes per Section 27.4; ARB convened within 1h; hotfix or rollback | Post-mortem within 24h; root cause analysis (RCA) within 48h; GV-prevention task created |
| P1 | Guardrail violation detected but no customer impact yet (e.g. POS compensation path triggered but reversal succeeded) | Page OCE within 15min; assess blast radius; fix or rollback within 1h | Post-mortem within 48h; GV-prevention task created |
| P2 | Guardrail violation detected in CI/staging before reaching production | Block release; notify GO; fix before next release | Weekly digest; trend tracked |
| P3 | Guardrail drift detected (code style, missing comment, etc.) | Add to weekly digest; fix in normal workflow | Monthly trend analysis |

Every GV incident produces a `GV-{YYYY}-{NN}` identifier that is referenced in the next monthly ARB review. Three GVs of the same cluster in a quarter trigger a mandatory deep-dive and a proposed guardrail amendment (either to clarify the rule or to add a CI check that would have caught it).

### 34.7 Waiver Process

A waiver is a time-boxed, ARB-approved exception to a specific guardrail for a specific scope. Waivers exist because real-world migrations sometimes need a transitional state (e.g. shipping the new `otp_secrets` table before the 2FA UI is built).

| Step | Action | Owner |
|---|---|---|
| 1. Request | Open a waiver request ticket with: guardrail #, scope (PR/service/route), justification, expiry date (≤ 30 days), mitigation in place | Requesting engineer |
| 2. Review | ARB reviews within 1 business day; may request changes to scope or mitigation | ARB |
| 3. Decision | Approve, reject, or request revision. Approval requires unanimous ARB vote | ARB |
| 4. Record | Approved waivers are listed in `docs/audit/waivers.md` with the waiver ID `W-{YYYY}-{NN}`, expiry, and link to the ticket | ARB chair |
| 5. Track | RC checks active waivers at every release sign-off (Section 34.5) | RC |
| 6. Renew or expire | 7 days before expiry, the requesting engineer must renew (with progress update) or let it lapse. An expired waiver is a P2 finding. | Requesting engineer + ARB |

Waivers cannot be renewed more than twice. After two renewals (90 days total), the underlying work must either complete or the guardrail must be amended via the Section 34.8 process.

### 34.8 Guardrail Amendment Process

Section 30 is not immutable, but amendments are deliberately heavyweight to prevent drift. The bar is "the rule as written no longer reflects production reality or actively harms the system."

| Step | Action | Threshold |
|---|---|---|
| 1. Propose | Open an ADR (Architecture Decision Record) at `docs/adr/{NNNN}-amend-guardrail-{N}.md` citing the guardrail #, the proposed change, the evidence (incident data, cost data, etc.), and the alternatives considered | Any engineer |
| 2. Discuss | ARB schedules a discussion within 5 business days; the proposing engineer presents | ARB + proposer |
| 3. Decide | ARB votes; amendment requires 2/3 majority (2 of 3 members) | ARB |
| 4. Document | Approved amendment produces an updated Section 30 (via PR) with a changelog entry at the top: `> Amended {YYYY-MM-DD}: guardrail {N} {clarified/strengthened/relaxed} per ADR {NNNN}` | ARB chair |
| 5. Communicate | Engineering team notified in the next weekly sync; Section 38 audit playbook updated if the amendment changes drift detection | ARB chair |
| 6. Retire (optional) | If a guardrail is fully obsolete, it is moved to a "Retired Guardrails" appendix with the retirement date and rationale — it is NOT silently deleted | ARB |

### 34.9 Anti-Patterns to Avoid

These behaviors defeat the purpose of the protocol and are explicitly forbidden:

- **Rubber-stamp reviews.** A GO approving every PR in their cluster without reading the diff. Detected by sampling 10% of GO approvals quarterly; pattern triggers ARB review of the GO's role.
- **Silent waivers.** A team shipping code that violates a guardrail without filing a waiver. Treated as a P2 GV incident.
- **Evergreen waivers.** Renewing the same waiver indefinitely. The two-renewal cap (Section 34.7) is hard.
- **Audit theater.** Running the Section 34.4 checklist but not actually investigating failures. The RC is accountable for evidence quality, not just for filling the table.
- **Guardrail accumulation.** Adding new guardrails without retiring stale ones. The quarterly review (Section 34.2) must retire or merge at least one rule per quarter if the document grows past 50 rules.
- **Ownership gaps.** A guardrail with no named GO. Treated as a P2 finding until ownership is reassigned.

### 34.10 Tooling

The protocol is supported by three pieces of tooling, all of which must be in place before the end of M7 (Observability) in Section 29:

1. **`guardrail-audit.yml` CI job** — runs checks 1–20 from Section 34.4 on every PR and on every release branch. Open-source starting point: a custom action wrapping `rg`, `tsc`, and a D1 schema introspection script.
2. **`docs/audit/` directory** — holds release sign-off records, weekly digests, monthly ARB notes, waivers, and GV incident links. Commit-only; no live editing in production.
3. **Guardrail Owner dashboard** — a single page in the staff dashboard (`/staff/guardrails`) showing the cluster map, current GO assignments, open waivers, and the last 30 days of GV incidents. Read-only; RBAC `reports.view` required.

---

## 35. D1 Migration Sequencing Plan

This section defines the concrete migration plan for the three new tables added in Section 6.1 (`otp_secrets`, `api_audit_logs`, `ai_budget_limits`) plus the reservation race-prevention constraint from Section 12.3. Each migration is numbered, scoped, and sequenced against the milestone plan in Section 29. Rollback paths are explicit because a failed D1 migration with no rollback is a P0 incident.

### 35.1 Migration Numbering and Layout

| Property | Convention |
|---|---|
| File location | `migrations/{NNNN}_{short_slug}.sql` (e.g. `migrations/0024_create_otp_secrets.sql`) |
| Rollback file | `migrations/rollback/{NNNN}_{short_slug}.rollback.sql` (mandatory for every migration) |
| Numbering | Zero-padded 4-digit, monotonically increasing, never reused |
| Test fixture | `migrations/tests/{NNNN}_{short_slug}.test.ts` — runs against D1 local in CI before merge |
| Status field | Every migration row is recorded in `_migrations` table: `(id, applied_at, sha256, rollback_sha256)` |

Editing an applied migration is FORBIDDEN per Section 26.3. A change to an applied migration requires a new forward migration that supersedes it.

### 35.2 Migration Sequence

**Repository mapping (June 2026):** The concepts below are implemented in `db/migrations/` as `0021`–`0031`. Plan numbers `0024`–`0027` in this section map to repo files `0021`–`0024` (`otp_secrets`, `api_audit_logs`, `ai_budget_limits`, reservation constraint). Subsequent repo migrations `0025`–`0031` cover cart cleanup, VAT, reservation rebuild, customer phone OTP, staff step-up, and courier handoff columns. Authoritative file-to-concept mapping lives in `tests/red-team-gaps.test.ts` and `tests/migration-fixtures.test.ts`.

The four migrations below must land in this order. Dependencies are explicit; a later migration cannot be applied until all its dependencies are applied.

#### Migration 0024 — `create_otp_secrets`

| Property | Value |
|---|---|
| Depends on | (none — first new table) |
| Required by milestone | M6 (Security) — must ship before Owner TOTP 2FA UI |
| Estimated effort | 0.5 day |
| Risk | Low — additive table, no existing data touched |

**Forward SQL:**

```sql
-- migrations/0024_create_otp_secrets.sql
CREATE TABLE otp_secrets (
  staff_id TEXT PRIMARY KEY REFERENCES staff_users(staff_id) ON DELETE CASCADE,
  secret_cipher BLOB NOT NULL,
  backup_codes_hash TEXT NOT NULL,
  enabled_at TEXT NOT NULL,
  last_used_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_otp_secrets_enabled ON otp_secrets(enabled_at) WHERE last_used_at IS NOT NULL;
```

**Rollback SQL:**

```sql
-- migrations/rollback/0024_create_otp_secrets.rollback.sql
DROP INDEX IF EXISTS idx_otp_secrets_enabled;
DROP TABLE IF EXISTS otp_secrets;
```

**Test fixture assertions:**

- Inserting a row with a non-existent `staff_id` fails (FK violation).
- Inserting a row with `secret_cipher = NULL` fails (NOT NULL violation).
- Deleting a `staff_users` row cascades to delete the matching `otp_secrets` row.
- Rollback restores the schema to pre-migration state.

#### Migration 0025 — `create_api_audit_logs`

| Property | Value |
|---|---|
| Depends on | (none — independent table) |
| Required by milestone | M7 (Observability) and M10 (FraudBD) — must ship before FraudBD circuit breaker goes live |
| Estimated effort | 0.5 day |
| Risk | Low — additive table; high write volume once FraudBD integration ships, so indexes must be right |

**Forward SQL:**

```sql
-- migrations/0025_create_api_audit_logs.sql
CREATE TABLE api_audit_logs (
  audit_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_id TEXT NOT NULL,
  order_id TEXT,
  invoice_id TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  error_code TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  circuit_state TEXT,
  redacted_request_summary TEXT,
  redacted_response_summary TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_api_audit_provider_created ON api_audit_logs(provider, created_at);
CREATE INDEX idx_api_audit_circuit_state ON api_audit_logs(provider, circuit_state, created_at);
CREATE INDEX idx_api_audit_order ON api_audit_logs(order_id) WHERE order_id IS NOT NULL;
```

**Rollback SQL:**

```sql
-- migrations/rollback/0025_create_api_audit_logs.rollback.sql
DROP INDEX IF EXISTS idx_api_audit_order;
DROP INDEX IF EXISTS idx_api_audit_circuit_state;
DROP INDEX IF EXISTS idx_api_audit_provider_created;
DROP TABLE IF EXISTS api_audit_logs;
```

**Test fixture assertions:**

- Insert with `provider = NULL` fails (NOT NULL).
- Insert with `retry_count` omitted defaults to 0.
- Querying `WHERE provider = 'fraudbd' AND created_at > datetime('now', '-1 hour')` uses the `idx_api_audit_provider_created` index (EXPLAIN QUERY PLAN assertion).
- Rollback restores pre-migration state.

**Capacity note:** At expected launch volume (≤ 100 orders/day), this table grows ~5,000 rows/day. A monthly partition-by-deletion cron (`DELETE FROM api_audit_logs WHERE created_at < datetime('now', '-90 days')`) is added in M7 and runs nightly.

#### Migration 0026 — `create_ai_budget_limits`

| Property | Value |
|---|---|
| Depends on | (none — independent table) |
| Required by milestone | M12 (AI) — must ship before BudgetCounterDO goes live |
| Estimated effort | 0.5 day |
| Risk | Low — additive table; seeded with one row per provider |

**Forward SQL:**

```sql
-- migrations/0026_create_ai_budget_limits.sql
CREATE TABLE ai_budget_limits (
  provider TEXT PRIMARY KEY,
  daily_limit_usd_cents INTEGER NOT NULL,
  monthly_limit_usd_cents INTEGER NOT NULL,
  soft_alert_percent INTEGER NOT NULL DEFAULT 80,
  hard_block_percent INTEGER NOT NULL DEFAULT 100,
  owner_override BOOLEAN NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by_staff_id TEXT REFERENCES staff_users(staff_id)
);

-- Seed the two known providers with launch defaults.
INSERT INTO ai_budget_limits (provider, daily_limit_usd_cents, monthly_limit_usd_cents, soft_alert_percent, hard_block_percent, owner_override, updated_at, updated_by_staff_id)
VALUES
  ('workers_ai', 100, 2000, 80, 100, 0, datetime('now'), NULL),
  ('deepseek', 500, 10000, 80, 100, 0, datetime('now'), NULL);
```

**Rollback SQL:**

```sql
-- migrations/rollback/0026_create_ai_budget_limits.rollback.sql
DROP TABLE IF EXISTS ai_budget_limits;
```

**Test fixture assertions:**

- Insert with `daily_limit_usd_cents = NULL` fails (NOT NULL).
- Insert with `provider = 'deepseek'` (duplicate PK) fails on second insert.
- Seed data is present after migration: `SELECT COUNT(*) FROM ai_budget_limits` returns 2.
- `BudgetCounterDO` can read the `deepseek` row and `daily_limit_usd_cents = 500` (= $5.00).
- Rollback removes the table and all seeded data.

#### Migration 0027 — `stock_reservations_unique_constraint`

| Property | Value |
|---|---|
| Depends on | All prior `stock_reservations` migrations (already in production) |
| Required by milestone | M4 (Inventory) — must ship before cleanup cron goes live to prevent double-release races |
| Estimated effort | 1 day (includes data backfill to resolve any existing duplicates) |
| Risk | **Medium** — adding a UNIQUE constraint to an existing table with live data can fail if duplicates exist. Requires a pre-flight data scan. |

**Pre-flight check (run before the migration in staging AND production):**

```sql
-- migrations/preflight/0027_check_duplicates.sql
-- If this returns any rows, the migration CANNOT proceed until duplicates are resolved manually.
SELECT order_id, COUNT(*) AS active_reservations
FROM stock_reservations
WHERE status = 'active'
GROUP BY order_id
HAVING COUNT(*) > 1;
```

If the pre-flight returns rows, the GO for Cluster D (Reservation & Inventory) must manually review and resolve each duplicate (typically by releasing all but the most recent) before the migration can proceed. This is logged as a `GV-{YYYY}-{NN}` finding for trend tracking.

**Forward SQL:**

```sql
-- migrations/0027_stock_reservations_unique_constraint.sql
-- Add release_requested_at column if it does not already exist.
ALTER TABLE stock_reservations ADD COLUMN release_requested_at TEXT;

-- Add the partial unique index: one active reservation per order.
=======
# Zabir Boutiques Master Plan v7

**Fresh Cloudflare-Native, Red-Team-Hardened, AI-Developer-Friendly Build Contract**

**Project:** Zabir Boutiques eCommerce + F-commerce + POS Platform  
**Target market:** Bangladesh boutique retail, Facebook-commerce customers, mobile-first shoppers  
**Primary stack:** Astro 6, React Islands, Tailwind CSS, Cloudflare Workers/Pages, D1, Durable Objects, R2, KV, Queues, Cron, Turnstile, Zero Trust Access  
**Document version:** v7 Canonical Master Plan  
**Date:** 2026-06-23  
**Status:** Source of truth for human developers, AI coding agents, reviewers, and release sign-off  
**Replaces:** V7 Master Plan + V7.1 Re-Review/Audit findings  

---

## 0. How to Use This Document

This file is the **single canonical master plan** for implementation. It merges the old architecture plan and the red-team review into one developer-ready contract.

Recommended repository split after baseline implementation:

```txt
docs/
  MASTER_PLAN.md          # this canonical contract, kept concise
  ARCHITECTURE.md         # expanded Cloudflare architecture details
  SECURITY.md             # WAF, CSP, Access, Turnstile, secrets, privacy
  DATA_MODEL.md           # D1, Drizzle, migrations, retention
  OPERATIONS.md           # CI/CD, observability, incident response, DR
  AI_AGENT.md             # coding-agent rules, prompts, forbidden patterns
```

Until that split is created, this file is authoritative. If any README, AI prompt, ticket, implementation note, or generated code conflicts with this document, this document wins.

### Merge Decision

Use a **single master plan now** because the project needs one clear source of truth. Keep audit reports separate as evidence, not as build instructions. Once the P0 remediation baseline is complete, split this file into smaller operational documents while keeping `MASTER_PLAN.md` as the root contract.

---

## 1. Executive Summary

Zabir Boutiques is a Cloudflare-native commerce platform for Bangladesh boutique and F-commerce operations. It supports product catalogues, mobile-first product pages, cart, Buy Now direct orders, guest checkout, COD, partial prepayment, online payment, staff-assisted orders, POS counter sales, inventory control, fraud review, shipping labels, returns, email notifications, Bangla/English search, and AI-assisted product content.

The engineering priority is not only page speed. The real priority is **transaction integrity**:

1. No overselling.
2. No browser-trusted pricing.
3. No payment state without provider verification.
4. No cart state drift between Durable Objects, D1 projections, and client UI.
5. No staff route exposed without Zero Trust and RBAC.
6. No raw secrets, PII, or payment payloads in logs.
7. No AI-generated public content without staff review.
8. No production release while P0 guardrails fail.

The previous audit found multiple P0 risks. v7 converts those findings into mandatory implementation rules, migrations, tests, and AI-agent instructions.

---

## 2. Non-Negotiable Canonical Decisions

| Area | v7 Decision |
|---|---|
| Framework | Astro 6 with `output: 'server'` and `@astrojs/cloudflare`. Static pages opt in with `export const prerender = true`. Dynamic routes omit `prerender = false`. |
| Rendering | Server-first. Public marketing/catalog pages are selectively prerendered. Checkout, payment, staff, POS, APIs, auth, webhooks, and live inventory are dynamic. |
| Hosting | Cloudflare Pages + Workers/Pages Functions. Worker-first deployment is acceptable if it simplifies bindings and observability. |
| Database | Cloudflare D1 is canonical for relational business data: products, orders, payments, staff, invoices, audit logs, projections, and migrations. |
| Strong consistency | Durable Objects are mandatory for carts, inventory serialization, idempotency, direct checkout sessions, provider health, and AI budget counters. |
| Object storage | R2 stores product images, generated variants, logs, backups, reports, and exported evidence. |
| KV | KV is allowed only for stale-tolerant data such as flags, redirects, prefix cache, revocation hints, and non-authoritative metadata. |
| Cart source of truth | `CartDO` is the only active cart source of truth. D1 `cart_activity` is only a searchable projection. KV and localStorage must not be authoritative. |
| Buy Now | `DirectCheckoutSessionDO` is isolated from `CartDO`. Buy Now never mutates the normal cart. |
| Pricing | Server reloads price, delivery fee, discount, VAT, advance, balance, and stock. Browser totals are ignored. |
| Money | All commerce money is integer paisa. Floating point is forbidden except AI provider cost accounting in USD. |
| Payments | Hosted payment pages only. Redirects are not proof of payment. Webhook + server-side verification + reconciliation are required. |
| Inventory | All online reservations and POS direct sales pass through `VariantInventoryDO`. D1 is not directly mutated for stock authority outside DO-controlled gateways. |
| Security | Zero Trust Access, RBAC, CSRF, Turnstile, WAF, rate limits, CSP, HMAC webhooks, and Cloudflare Secrets are mandatory. |
| AI | Workers AI first. DeepSeek fallback only when budget permits. Staff review required before publishing AI text. |
| Audits | Guardrails, drift checks, migration tests, and P0 test suites block release. |

---

## 3. Target Cloudflare-Native Architecture

```mermaid
flowchart TD
  Customer[Mobile Customer Browser] --> Edge[Cloudflare Edge]
  Edge --> WAF[WAF + Rate Limiting + Bot Controls]
  WAF --> Turnstile[Turnstile Challenge Where Needed]
  Turnstile --> Pages[Astro Pages / Workers]

  Staff[Staff Browser] --> Access[Cloudflare Zero Trust Access]
  Access --> StaffApp[Staff Routes + RBAC]
  StaffApp --> Pages

  Pages --> D1[(Cloudflare D1)]
  Pages --> R2[(R2 Images Logs Backups)]
  Pages --> KV[(KV Flags Redirects Prefix Cache)]
  Pages --> CartDO[CartDO]
  Pages --> BuyDO[DirectCheckoutSessionDO]
  Pages --> InvDO[VariantInventoryDO]
  Pages --> IdemDO[IdempotencyDO]
  Pages --> ProviderDO[ProviderHealthDO]
  Pages --> BudgetDO[BudgetCounterDO]
  Pages --> Queues[Cloudflare Queues]

  Queues --> PaymentConsumer[Payment Event Consumer]
  Queues --> EmailConsumer[Email Consumer]
  Queues --> FraudConsumer[Fraud Audit Consumer]
  Queues --> ImageConsumer[Image Processing Consumer]
  Queues --> CartConsumer[Cart Activity Consumer]
  Queues --> BackupConsumer[D1 Backup Consumer]

  Cron[Cron Triggers] --> Reconcile[Payment Reconciliation]
  Cron --> ReservationCleanup[Reservation Cleanup]
  Cron --> Sitemap[Sitemap Generation]
  Cron --> Backups[D1 Backups]
  Cron --> LowStock[Low Stock Digest]

  Pages --> PaymentProviders[UddoktaPay / SSLCommerz]
  PaymentProviders --> Webhook[/api/payments/webhook]
  Webhook --> Queues
```

### 3.1 Service Ownership Matrix

| Concern | Cloudflare Service | Role |
|---|---|---|
| Static/public pages | Pages/CDN | Prerendered pages and hashed assets |
| Dynamic commerce routes | Workers / Pages Functions | Checkout, APIs, payment, staff, POS |
| Relational data | D1 | Products, orders, payments, staff, invoices, audit logs |
| Strong consistency | Durable Objects | Cart, inventory, idempotency, direct sessions, provider health |
| Blob storage | R2 | Images, variants, logs, backups, reports |
| Stale-tolerant cache | KV | Flags, redirects, prefix autocomplete cache, revocation hints |
| Async jobs | Queues | Webhooks, emails, image processing, cart projection, fraud audit |
| Scheduled jobs | Cron Triggers | Reconciliation, cleanup, backups, sitemap, reports |
| Bot protection | Turnstile + WAF | Checkout, login, coupon, forms |
| Staff perimeter | Zero Trust Access | `/staff/*`, `/api/staff/*` |
| Security edge | WAF, Rate Limiting, Rulesets | Abuse control and route protection |
| Observability | Workers Analytics Engine, logs, R2 archives | Metrics, traces, alerts, audit evidence |

---

## 4. Recommended Repository Structure

```txt
src/
  components/
    primitives/
    product/
    cart/
    checkout/
    staff/
    pos/
  db/
    client.ts
    schema/
      catalog.ts
      cart.ts
      checkout.ts
      orders.ts
      payments.ts
      pos.ts
      staff.ts
      operations.ts
      index.ts
    queries/
      products.ts
      orders.ts
      staff.ts
      search.ts
      cart-activity.ts
    services/
      checkout-service.ts
      order-service.ts
      inventory-read-service.ts
      payment-service.ts
      pos-service.ts
  durable-objects/
    cart-do.ts
    direct-checkout-session-do.ts
    variant-inventory-do.ts
    idempotency-do.ts
    provider-health-do.ts
    budget-counter-do.ts
  lib/
    contracts/
      cart-do.ts
      direct-checkout-session-do.ts
      variant-inventory-do.ts
      idempotency-do.ts
      provider-health-do.ts
      budget-counter-do.ts
      payment-provider.ts
      email-provider.ts
      index.ts
    integrations/
      payments/
        uddoktapay/
        sslcommerz/
      email/
        resend/
        cloudflare-email/
      fraudbd/
      workers-ai/
      deepseek/
      imagify/
      courier/
        pathao/
        steadfast/
        redx/
    security/
      csp.ts
      csrf.ts
      hmac.ts
      rate-limit.ts
      turnstile.ts
      access.ts
      pii-redaction.ts
    i18n/
      index.ts
      bangla-normalize.ts
      search-synonyms.ts
    money/
      paisa.ts
    logger/
      structured-log.ts
  middleware.ts
  pages/
    products/[slug].astro
    categories/[slug].astro
    buy-now/[slug].astro
    checkout.astro
    staff/
    api/
      cart/
      buy-now/
      checkout.ts
      payments/webhook.ts
      staff/
queues/
  consumers/
    payment-webhooks.ts
    order-emails.ts
    fraud-audit.ts
    image-processing.ts
    cart-activity.ts
    d1-backup.ts
migrations/
  0001_initial.sql
  ...
  rollback/
  tests/
scripts/
  audit/
    audit-drift.ts
  migrations/
    apply.ts
    verify.ts
infra/
  cloudflare/
    waf.tf
    rate-limits.tf
    access.tf
    cache.tf
    dns.tf
    tunnel.tf
```

Rules:

- Route handlers must be thin.
- Business logic belongs in services.
- D1 access belongs in `src/db/queries` and `src/db/services`.
- Durable Object methods must implement contracts from `src/lib/contracts`.
- External APIs must be called only through adapters.
- Tests must target contracts, services, DOs, migrations, and replay behavior.

---

## 5. Framework and Routing Contract

### 5.1 Astro Configuration

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
```

### 5.2 Static Routes

Static routes must explicitly opt in:

```ts
export const prerender = true;
```

| Route | Reason |
|---|---|
| `/` | Homepage and marketing content |
| `/products/[slug]` | SEO product snapshot; live stock fetched separately |
| `/categories/[slug]` | SEO category snapshot |
| `/collections/[slug]` | Collection page |
| `/blog/[slug]` | Editorial content |
| `/about` | Static info |
| `/privacy` | Legal page |
| `/terms` | Legal page |
| `/return-policy` | Legal page |
| `/size-guide` | Static guide |

### 5.3 Dynamic Routes

Dynamic routes omit `prerender = false`. They are dynamic by default under `output: 'server'`.

| Route | Purpose |
|---|---|
| `/cart` | Cart shell, CartDO data through API |
| `/checkout` | Server-safe checkout state |
| `/buy-now/[slug]` | Direct checkout landing session |
| `/api/cart/*` | CartDO operations |
| `/api/buy-now/session` | Create direct checkout session |
| `/api/buy-now/submit` | Submit direct order through checkout engine |
| `/api/checkout` | Order creation and payment initiation |
| `/api/payments/webhook` | Payment webhook receiver |
| `/api/payments/reconcile` | Cron/internal reconciliation |
| `/api/stock/[variant_id]` | Live stock availability |
| `/api/search` | D1 FTS search |
| `/staff/*` | Staff dashboard |
| `/api/staff/*` | Staff APIs |
| `/staff/sales/pos` | POS counter sales |

Forbidden:

```txt
output: 'static'
output: 'hybrid'
export const prerender = false
```

---

## 6. Data Ownership Contract

| Data | Authoritative Source | Projection / Cache | Notes |
|---|---|---|---|
| Product metadata | D1 | Static snapshots, Cache API | D1 wins |
| Product image objects | R2 | CDN cache | D1 stores R2 keys |
| Product price | D1 | Static display snapshot | Checkout reloads price |
| Inventory | VariantInventoryDO + D1 ledger | Live stock API | DO serializes mutations |
| Active cart | CartDO | React state, D1 `cart_activity` projection | D1 not used for active checkout cart |
| Buy Now session | DirectCheckoutSessionDO | D1 after order creation | Fully isolated from CartDO |
| Orders | D1 | None | D1 canonical |
| Payment events | D1 | Queue replay | Idempotent event table |
| Staff sessions | HttpOnly cookie + D1/KV revocation hints | None | RBAC checked server-side |
| POS invoices | D1 invoice ledger | None | Separate from online orders |
| Audit logs | D1 hot + R2 archive | Analytics Engine | Redacted and append-only |
| AI budget config | D1 `ai_budget_limits` | BudgetCounterDO live counter | DO enforces live counts |
| Provider health | ProviderHealthDO | D1 `api_audit_logs` | Circuit state and audit |

---

## 7. D1 Database Architecture

D1 is the relational source of truth. Every schema change must use numbered SQLite-compatible migrations, rollback files, and invalid-insert tests.

### 7.1 Required Table Groups

```txt
catalog:
  products
  product_variants
  categories
  product_categories
  product_images
  product_tags
  inventory_items
  variants compatibility view

cart_checkout:
  cart_activity
  direct_checkout_activity
  coupons
  coupon_redemptions
  idempotency_keys
  stock_reservations

orders_payments:
  orders
  order_items
  order_status_events
  payment_events
  returns
  return_items
  refunds

pos:
  invoices
  invoice_items
  invoice_payments
  invoice_audit
  daily_invoice_counters

staff_security:
  staff_users
  staff_roles
  staff_permissions
  staff_sessions
  password_reset_tokens
  password_reset_rate_limits
  csrf_nonces
  otp_secrets
  audit_log

operations:
  api_audit_logs
  email_log
  stock_adjustments
  inventory_reconciliation_runs
  ai_generation_log
  ai_budget_limits
  backup_log
```

### 7.2 Money Rules

All commerce money columns must use integer paisa:

```txt
price_paisa
subtotal_paisa
delivery_paisa
discount_paisa
vat_paisa
total_paisa
advance_paisa
balance_paisa
refund_paisa
```

Forbidden for commerce money:

```txt
REAL
FLOAT
DOUBLE
decimal string money values
browser-supplied totals
```

Only AI cost accounting may use float USD inside `BudgetCounterDO.recordUsage()` because provider pricing can use fractional USD units.

### 7.3 Cart Activity Projection Schema

`cart_activity` is not the active cart. It is a D1 projection for abandoned cart, analytics, and staff reporting.

Required columns:

```sql
CREATE TABLE cart_activity (
  session_id TEXT PRIMARY KEY,
  customer_phone TEXT,
  customer_email TEXT,
  customer_name TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  total_quantity INTEGER NOT NULL DEFAULT 0,
  subtotal_paisa INTEGER NOT NULL DEFAULT 0,
  last_cart_update_at TEXT NOT NULL,
  checkout_started_at TEXT,
  converted_order_id TEXT,
  abandoned_email_sent_at TEXT,
  consent_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (consent_status IN ('unknown','allowed','denied')),

  -- v7 monotonic write race contract
  last_d1_write_at TEXT,
  last_d1_write_source TEXT CHECK (
    last_d1_write_source IN ('alarm','queue','lifecycle_cleanup','manual_repair')
  ),
  last_d1_write_seq INTEGER NOT NULL DEFAULT 0,

  updated_at TEXT NOT NULL
);

CREATE INDEX idx_cart_activity_abandoned
  ON cart_activity(last_cart_update_at)
  WHERE converted_order_id IS NULL
    AND abandoned_email_sent_at IS NULL;

CREATE INDEX idx_cart_activity_email
  ON cart_activity(customer_email)
  WHERE customer_email IS NOT NULL;
```

Required guarded upsert pattern:

```sql
INSERT INTO cart_activity (
  session_id,
  customer_phone,
  customer_email,
  customer_name,
  item_count,
  total_quantity,
  subtotal_paisa,
  last_cart_update_at,
  consent_status,
  last_d1_write_at,
  last_d1_write_source,
  last_d1_write_seq,
  updated_at
)
VALUES (
  :session_id,
  :customer_phone,
  :customer_email,
  :customer_name,
  :item_count,
  :total_quantity,
  :subtotal_paisa,
  :last_cart_update_at,
  :consent_status,
  :write_ts,
  :write_source,
  1,
  :write_ts
)
ON CONFLICT(session_id) DO UPDATE SET
  customer_phone = excluded.customer_phone,
  customer_email = excluded.customer_email,
  customer_name = excluded.customer_name,
  item_count = excluded.item_count,
  total_quantity = excluded.total_quantity,
  subtotal_paisa = excluded.subtotal_paisa,
  last_cart_update_at = excluded.last_cart_update_at,
  consent_status = excluded.consent_status,
  last_d1_write_at = excluded.last_d1_write_at,
  last_d1_write_source = excluded.last_d1_write_source,
  last_d1_write_seq = cart_activity.last_d1_write_seq + 1,
  updated_at = excluded.updated_at
WHERE excluded.last_d1_write_at >= COALESCE(cart_activity.last_d1_write_at, '');
```

This prevents delayed queue writes from overwriting fresher alarm writes.

### 7.4 Direct Checkout Activity Schema (P0-11)

`direct_checkout_activity` is a D1 searchable index for direct checkout (Buy Now) abandoned session detection. `DirectCheckoutSessionDO` publishes activity messages; the queue consumer batches and upserts into this table. It is NOT the active session source of truth — `DirectCheckoutSessionDO` is.

Required columns:

```sql
CREATE TABLE IF NOT EXISTS direct_checkout_activity (
  session_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  customer_phone TEXT,
  customer_email TEXT,
  customer_name TEXT,
  source_page TEXT,
  landing_version INTEGER NOT NULL DEFAULT 0,
  last_activity_at TEXT NOT NULL,
  converted_order_id TEXT,
  abandoned_email_sent_at TEXT,
  consent_status TEXT CHECK(consent_status IN ('unknown', 'allowed', 'denied')) DEFAULT 'unknown',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_direct_checkout_activity_abandoned
  ON direct_checkout_activity(last_activity_at)
  WHERE converted_order_id IS NULL
    AND abandoned_email_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_direct_checkout_activity_email
  ON direct_checkout_activity(customer_email)
  WHERE customer_email IS NOT NULL;
```

### 7.5 Payment Events Conflict Schema

```sql
ALTER TABLE orders ADD COLUMN payment_confirmed_at TEXT;
ALTER TABLE orders ADD COLUMN payment_provider_reference TEXT;
ALTER TABLE orders ADD COLUMN last_status_change_at TEXT;

CREATE INDEX idx_payment_events_order_created
  ON payment_events(order_id, created_at);
```

Canonical guarded payment update:

```sql
UPDATE orders
SET payment_status = :new_payment_status,
    status = :new_order_status,
    payment_confirmed_at = COALESCE(payment_confirmed_at, :now_iso),
    payment_provider_reference = :provider_reference,
    last_status_change_at = :now_iso,
    updated_at = :now_iso
WHERE order_id = :order_id
  AND status NOT IN ('cancelled','returned','refunded')
  AND EXISTS (
    SELECT 1
    FROM payment_events
    WHERE payment_events.order_id = :order_id
      AND payment_events.event_id = :event_id
      AND payment_events.created_at <= :now_iso
  );
```

Reconciliation must never downgrade a paid order back to pending or cancelled. It may only move unknown/pending states forward after server-side provider verification.

### 7.6 Staff Password Reset Tables

```sql
CREATE TABLE password_reset_tokens (
  token_id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_users(staff_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  requested_by_staff_id TEXT REFERENCES staff_users(staff_id),
  created_ip_hash TEXT,
  user_agent_hash TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_password_reset_staff_active
  ON password_reset_tokens(staff_id, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE password_reset_rate_limits (
  key TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  window_start_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Rules:

- Store only HMAC or hashed tokens, never raw tokens.
- Tokens expire after 1 hour.
- Tokens are one-time use.
- All reset creation, use, failure, and revocation events go to `audit_log`.
- Reset route has per-IP and per-staff rate limiting.

### 7.7 Bangla Localization Tables

```sql
ALTER TABLE products ADD COLUMN name_bn TEXT;
ALTER TABLE products ADD COLUMN description_bn TEXT;
ALTER TABLE product_variants ADD COLUMN label_bn TEXT;
```

FTS5 must include Bangla fields:

```sql
CREATE VIRTUAL TABLE products_fts USING fts5(
  name,
  description,
  category,
  tags,
  name_bn,
  description_bn,
  content='products',
  content_rowid='rowid',
  tokenize="unicode61 tokenchars='_৳' remove_diacritics 1"
);
```

Public canonical URLs remain Latin slug URLs. Bangla view uses `?lang=bn` for launch unless a later ADR approves separate Bangla paths.

---

## 8. Drizzle ORM Contract

Drizzle is required for schema clarity and AI-agent safety, but it must not weaken transaction boundaries.

Rules:

1. Every D1 table must have a matching Drizzle schema.
2. Route handlers must not assemble Drizzle queries inline.
3. Route handlers call services; services call queries.
4. High-traffic routes must use explicit column selects.
5. Stock mutation is forbidden through Drizzle outside `VariantInventoryDO` gateways.
6. Checkout pricing, totals, VAT, delivery, and discounts are computed server-side in services.
7. Drizzle migrations are reviewed into raw SQLite SQL before production.

Recommended files:

```txt
src/db/schema/catalog.ts
src/db/schema/cart.ts
src/db/schema/checkout.ts
src/db/schema/orders.ts
src/db/schema/payments.ts
src/db/schema/pos.ts
src/db/schema/staff.ts
src/db/schema/operations.ts
src/db/schema/index.ts
src/db/client.ts
src/db/queries/*.ts
src/db/services/*.ts
```

Example client:

```ts
// src/db/client.ts
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function createDbClient(d1: D1Database) {
  return drizzle(d1, { schema });
}
```

Forbidden:

```ts
// Forbidden inside route handlers
await db.update(inventoryItems).set({ stock: stock - quantity });
```

Required:

```ts
// Required: route -> service -> Durable Object stock command
await inventoryDO.reserve({ variant_id, quantity, checkout_id });
```

---

## 9. Durable Object Contracts

Durable Objects enforce the highest-risk state transitions. Every implementation must `implements` its contract interface.

### 9.1 CartDO

Responsibilities:

- Add item.
- Remove item.
- Change quantity.
- Clear cart.
- Apply coupon.
- Remove coupon.
- Update customer contact.
- Merge cart.
- Get cart.
- Manage cart version.
- Publish cart activity queue messages.
- Persist to D1 via alarm-based projection.
- Re-arm alarms after eviction/read.

Required internal state:

```ts
interface CartDOState {
  session_id: string;
  items: Array<{
    variant_id: string;
    quantity: number;
    added_at: string;
    updated_at: string;
  }>;
  coupon_code?: string;
  customer_contact?: {
    name?: string;
    phone?: string;
    email?: string;
    consent_status: 'unknown' | 'allowed' | 'denied';
  };
  cart_version: number;
  last_mutation_at: string;
  last_persisted_at?: string;
  five_min_alarm_at?: number;
  thirty_day_alarm_at?: number;
  soft_alarm_active: boolean;
}
```

Cart version rules:

| Method | Version behavior |
|---|---|
| `addItem` | Increment by 1 on successful new mutation |
| `removeItem` | Increment by 1 only if item existed |
| `changeQuantity` | Increment by 1 only if quantity changed |
| `clearCart` | Increment by 1 only if cart had items/coupon/contact to clear |
| `applyCoupon` | Increment by 1 only if coupon changed |
| `removeCoupon` | Increment by 1 only if coupon existed |
| `updateCustomerContact` | Increment by 1 only if contact changed |
| `mergeCart` | Increment according to actual changes |
| `getCart` | No increment |
| `alarm()` | No increment |
| Idempotent replay | No increment |

Alarm lifecycle:

| Event | Required behavior |
|---|---|
| Any mutation succeeds | Set 5-minute alarm, set `soft_alarm_active = true`, publish queue message |
| First cart creation | Also set 30-day cleanup alarm metadata |
| `getCart()` after eviction | If cart has items and no alarm exists, re-arm 5-minute persistence alarm |
| 5-minute alarm fires | Upsert D1 with `write_source='alarm'`; do not increment version |
| 30-day cleanup fires | Final D1 write with `write_source='lifecycle_cleanup'`, then delete cart storage |
| Empty cart alarm fires | Skip activity write unless final cleanup is required |

### 9.2 DirectCheckoutSessionDO

Buy Now sessions are isolated from normal carts.

Allowed state:

```ts
interface DirectCheckoutSessionState {
  session_id: string;
  product_id: string;
  variant_id: string;
  quantity: number;
  selected_options: Record<string, string>;
  created_at: string;
  expires_at: string;
  origin: string;
  user_agent_hash: string;
  source_page?: string;
  utm_params?: Record<string, string>;
  form_draft?: Record<string, unknown>;
  customer_session_link?: string;
}
```

Forbidden state:

- CartDO ID.
- Final price authority.
- Payment secrets.
- Final delivery fee authority.
- Permanent order record.

Rules:

- `session_id = HMAC(secret, timestamp + random)`.
- Validate Origin and User-Agent hash on every Buy Now request.
- Mismatch returns `403` and deletes the session.
- Delete form/session data immediately after order success.
- Retaining a minimal `order_id` tombstone is allowed only to prevent replay and only until cleanup.
- 30-minute expiry alarm required.

### 9.3 VariantInventoryDO

Responsibilities:

- Serialize stock reserve, release, confirm, direct sale, and reverse direct sale.
- Prevent overselling.
- Maintain D1 reservation rows and audit adjustments.
- Support idempotent reversal.

Contract:

```ts
interface VariantInventoryDOContract {
  reserve(input: {
    variant_id: string;
    quantity: number;
    checkout_id: string;
  }): Promise<{ reservation_id: string } | { error: 'INSUFFICIENT_STOCK'; available: number }>;

  release(input: {
    reservation_id: string;
    reason: string;
  }): Promise<{ released: boolean; already_released?: boolean }>;

  confirm(input: {
    reservation_id: string;
    order_id: string;
  }): Promise<{ confirmed: true } | { error: 'RESERVATION_NOT_FOUND' | 'ALREADY_CONFIRMED' }>;

  directSale(input: {
    variant_id: string;
    quantity: number;
    invoice_id: string;
    staff_id: string;
    channel: 'pos';
  }): Promise<{ success: true } | { error: 'INSUFFICIENT_STOCK'; available: number } | { error: 'CONFLICT'; message: string }>;

  reverseDirectSale(input: {
    variant_id: string;
    quantity: number;
    invoice_id: string;
    reason: 'd1_invoice_write_failed' | 'same_day_void' | string;
  }): Promise<{ reversed: true; audit_event_id: string } | { reversed: false; audit_event_id: string; message: 'already_reversed' }>;
}
```

### 9.4 IdempotencyDO

Used for checkout, payment initiation, webhook processing, direct order submit, and POS invoice creation.

Rules:

- Claim operation atomically.
- Store serialized successful response for 24 hours.
- Replay with same key returns same response.
- Different payload with same key returns conflict.
- Alarm deletes old storage after TTL.

### 9.5 ProviderHealthDO

Used for circuit breakers across external providers.

Providers:

```txt
fraudbd
uddoktapay
sslcommerz
resend
cloudflare_email
workers_ai
deepseek
imagify
pathao
steadfast
redx
```

Circuit rules for FraudBD:

```txt
5 failures in 60 seconds -> open circuit
open duration -> 5 minutes
fallback score -> 50
checkout retries -> 0
fraud-audit queue retries -> 1 with 2s backoff
```

### 9.6 BudgetCounterDO

Used for AI and paid image/API cost control.

Rules:

- DeepSeek daily hard cap: `$5.00 USD` UTC day.
- Workers AI primary and lower-risk fallback.
- If `canUseDeepSeek()` times out, fallback to Workers AI, do not allow unlimited DeepSeek.
- `recordUsage()` idempotent on `(provider, request_id)`.

---

## 10. Cart Architecture

### 10.1 Cart Flow

```mermaid
sequenceDiagram
  participant UI as Browser UI
  participant API as /api/cart/*
  participant DO as CartDO
  participant Q as cart-activity Queue
  participant D1 as D1 cart_activity

  UI->>API: add/change/remove with cart_version + idempotency key
  API->>DO: command
  DO->>DO: validate + mutate + increment version
  DO->>DO: arm 5-min alarm
  DO->>Q: publish projection message
  DO-->>API: current cart + version
  API-->>UI: response
  Q->>D1: guarded upsert source='queue'
  DO->>D1: guarded upsert source='alarm' after inactivity
```

### 10.2 Conflict Handling

Every mutation request includes:

```json
{
  "session_id": "opaque-session-id",
  "cart_version": 7,
  "idempotency_key": "uuid-or-ulid",
  "command": "changeQuantity"
}
```

If the client version is stale:

```json
{
  "error": "CART_VERSION_CONFLICT",
  "current_cart": {},
  "current_version": 8
}
```

### 10.3 Abandoned Cart Definition

A cart is abandoned only when all conditions are true:

```sql
last_cart_update_at < datetime('now', '-24 hours')
abandoned_email_sent_at IS NULL
converted_order_id IS NULL
consent_status = 'allowed'
customer_email IS NOT NULL
```

Cron deduplicates by `customer_email` using `ROW_NUMBER()` and the email consumer re-checks `converted_order_id` immediately before sending.

---

## 11. Buy Now Direct Order Flow

Buy Now is a direct, conversion-focused guest order path for F-commerce behavior.

### 11.1 Rules

- Product page shows `Add to Cart` and `Buy Now` side by side.
- `Add to Cart` mutates CartDO.
- `Buy Now` creates DirectCheckoutSessionDO.
- Buy Now never clears or edits existing cart.
- Buy Now submit uses the same checkout engine as normal checkout.
- Price, stock, VAT, delivery, coupon, COD rule, fraud, and payment are recalculated server-side.

### 11.2 Flow

```txt
1. Customer selects product variant and quantity.
2. Customer clicks Buy Now.
3. Browser calls /api/buy-now/session.
4. Server validates product, variant, quantity, and availability hint.
5. DirectCheckoutSessionDO is created with 30-min expiry.
6. Browser redirects to /buy-now/{slug}?sid={session_id}.
7. Landing page loads live session state.
8. Customer submits guest order form.
9. /api/buy-now/submit validates session and form.
10. Checkout service handles pricing, fraud, reservation, D1 order, payment, and email.
11. DirectCheckoutSessionDO clears session data after order success.
```

### 11.3 Landing Page Sections

```txt
1. Product offer headline
2. Hero image/gallery
3. Price and variant choice
4. Truthful stock message
5. Benefits and sizing notes
6. Trust points
7. Delivery charge explanation
8. Guest order form
9. Payment method selector
10. Order summary
11. Confirm order button
12. WhatsApp/phone support CTA
```

No fake scarcity, fake timer, or misleading discount claim is allowed.

---

## 12. Checkout and Payment Architecture

### 12.1 Checkout Rules

Checkout is server-authoritative.

Required steps:

```txt
1. Validate Idempotency-Key through IdempotencyDO.
2. Validate CSRF and Turnstile when required.
3. Normalize Bangladeshi phone to +880 format.
4. Load active cart from CartDO or direct session from DirectCheckoutSessionDO.
5. Accept only variant_id and quantity from browser.
6. Reload product, variant, price, status, and stock authority server-side.
7. Compute subtotal, discount, delivery, VAT, total, advance, and balance server-side.
8. Validate coupon atomically in D1.
9. Compute COD rule using SUM(quantity), not line count.
10. Run FraudBD direct check with 1.5s timeout and zero checkout retries.
11. Reserve stock through VariantInventoryDO.
12. Write D1 order and order_items atomically.
13. If D1 write fails, immediately release all reservations.
14. Initiate hosted payment if required.
15. Enqueue order email and fraud audit.
16. Complete idempotency response.
```

### 12.2 VAT Rule

```ts
const vatRate = Number(env.VAT_RATE_PERCENT ?? '0');
const vatPaisa = Math.round(subtotalPaisa * vatRate / 100);
```

Browser-supplied VAT is ignored. Launch default is `0` unless the Owner explicitly confirms Bangladesh VAT handling.

If `VAT_RATE_PERCENT > 0`, an `audit_log` row is required:

```txt
event_type = OWNER_ACK_BD_VAT_MVP
severity = P1
actor = Owner
```

### 12.3 Payment Methods

| Method | Use case | Advance | Balance |
|---|---|---:|---:|
| `cod` | Low-risk, quantity <= 2 | 0 | Full total |
| `partial_prepay` | Risky COD or higher quantity | Configured percent | Remaining COD |
| `uddoktapay` | Full online payment | Full total | 0 |
| `sslcommerz` | Fallback online payment | Full total | 0 |
| `in_store` | POS sale | Full paid at counter | 0 |

### 12.4 Payment Provider Contract

```ts
export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;
  parseWebhook(request: Request): Promise<VerifiedPaymentEvent>;
  refund?(input: RefundInput): Promise<RefundResult>;
}
```

Rules:

- `createPayment` idempotent by internal `order_id`.
- Webhook signature verified before enqueue.
- Provider redirect success does not mark paid.
- Queue consumer performs server-to-server verification.
- Reconciliation is final repair surface.
- Raw webhook payloads are never logged without redaction.

### 12.5 Webhook Flow

```txt
1. Receive webhook.
2. Verify provider signature/HMAC (algorithm per provider below).
3. Insert event into payment_events idempotently.
4. Return 200 quickly.
5. Queue consumer verifies payment with provider.
6. Apply guarded payment update SQL.
7. Confirm stock reservation only if order state allows it.
8. Emit payment confirmation email.
9. Audit all transitions.
```

#### Provider-Specific Signature Verification

| Provider | Algorithm | Header | Details |
|---|---|---|---|
| UddoktaPay | HMAC-SHA256 | `API-Key` header + request body HMAC | Verify HMAC-SHA256 of raw JSON body using shared secret from `UDDOKTAPAY_API_KEY`. Compare against `X-UddoktaPay-Signature` header. |
| SSLCommerz | SHA256 on sorted params | `verify_sign` and `verify_key` in POST body | Sort params by `verify_key` list, concatenate `key=value` pairs without delimiter, compute SHA256, compare against `verify_sign`. Use `store_passwd` from `SSLCOMMERZ_STORE_PASSWORD` secret. |

Both adapters live in `src/lib/integrations/payments/uddoktapay/` and `src/lib/integrations/payments/sslcommerz/` respectively. The adapter's `parseWebhook()` method performs provider-specific verification and returns a typed `VerifiedPaymentEvent`.

### 12.6 Coupon System

#### Discount Types

| Type | Example | Calculation |
|---|---|---|
| `fixed_paisa` | ৳500 off | `discount = min(coupon.value_paisa, subtotal)` |
| `percent` | 10% off | `discount = floor(subtotal * coupon.value_percent / 100)` |
| `free_delivery` | Free shipping | `discount = delivery_paisa` |

#### Rules

- Single coupon per order. Stacking is not supported in v1.
- Coupon references `coupon_code` (user-facing) and `coupon_id` (internal UUID) in `coupons` table.
- One-time coupons (`max_uses = 1`) are marked `used_at` on first successful claim.
- Rate-limited: max 5 apply attempts per session per minute.
- Server-side validation: check `is_active`, `not expired`, `max_uses not reached`, `min_order_paisa` satisfied.
- Fraud patterns: repeated rapid attempts trigger Turnstile challenge. Same IP hitting 10 different coupon codes in 1 minute is blocked for 1 hour.
- Claim lifecycle: coupon usage is claimed atomically via `recordCouponClaim()` and released via `releaseCouponUsageAtomic()` on checkout failure.

#### Coupon Redemption Table

```sql
CREATE TABLE coupon_redemptions (
  id TEXT PRIMARY KEY,
  coupon_id TEXT NOT NULL REFERENCES coupons(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  coupon_code TEXT NOT NULL,
  discount_paisa INTEGER NOT NULL,
  used_by_staff_id TEXT REFERENCES staff_users(id),
  created_at TEXT NOT NULL
);
```

### 12.7 Reconciliation Flow

Cron every 15 minutes:

```txt
1. Query pending payment orders older than 30 minutes.
2. Verify with provider API.
3. If provider confirms paid, apply same guarded update path.
4. If provider confirms failed/expired and order is still pending, cancel and release reservation.
5. Never downgrade a confirmed paid order.
6. Alert if provider says paid but local webhook missing.
```

---

## 13. FraudBD Risk Architecture

FraudBD is a synchronous checkout risk decision with strict timeout. Adapter at `src/lib/integrations/fraudbd/`.

### 13.1 API Contract

#### Request (sent to FraudBD API)

```json
{
  "phone": "+8801712345678",
  "ip": "203.0.113.42",
  "user_agent": "Mozilla/5.0 ...",
  "amount_paisa": 50000,
  "payment_method": "cod",
  "items_count": 3,
  "total_quantity": 5,
  "delivery_address": "Dhaka, Bangladesh",
  "is_guest": true,
  "session_age_minutes": 15
}
```

Field details:
- `phone`: Bangladeshi phone in +880 format (normalized by `normalizeBangladeshPhone`)
- `ip`: Client IP from `x-forwarded-for` or `cf-connecting-ip`
- `amount_paisa`: Total order amount in integer paisa
- `items_count`: Number of distinct line items
- `total_quantity`: Sum of quantities across items
- `is_guest`: `true` if not logged in

#### Response (from FraudBD API)

```json
{
  "score": 25,
  "decision": "approve" | "review" | "block",
  "risk_factors": ["high_quantity", "new_phone"],
  "provider_tx_id": "fbd_abc123",
  "processed_at": "2026-06-23T12:00:00Z"
}
```

Score mapping:
| Score | decision | System action |
|---|---:|---|---|
| 0-40 | `approve` | Auto-approve, continue checkout |
| 41-70 | `review` | Create order as `pending_review` |
| 71-100 | `block` | Reject before reservation, return `FRAUD_BLOCKED` |
| Timeout/circuit open | N/A | Fallback score 50, `pending_review` order |

### 13.2 Score Policy

| Score | Action |
|---:|---|
| 0-40 | Auto-approve |
| 41-70 | Create order with `pending_review` |
| 71-100 | Reject before reservation |
| Timeout / circuit open | Create with score 50 and `pending_review` unless Owner enables hard-block |

### 13.3 Circuit Breaker

```txt
ProviderHealthDO key: provider:fraudbd
Failure threshold: 5 failures in 60 seconds
Open duration: 5 minutes
Half-open: first request after expiry probes provider
Fallback score: 50
Checkout timeout: 1.5 seconds
Checkout retries: 0
Async audit timeout: 3 seconds
Async audit retries: 1
```

---

## 14. Inventory and Stock Control

### 14.1 Model

```txt
available = stock - reserved - sold
```

Definitions:

- `stock`: total received inventory.
- `reserved`: active checkout holds.
- `sold`: confirmed sold units.
- `available`: computed availability.

### 14.2 Reservation Lifecycle

| Event | Action |
|---|---|
| Checkout starts | Reserve through VariantInventoryDO |
| D1 order write fails | Immediate release |
| Payment timeout | Cancel and release |
| Staff cancels before confirmation | Release |
| Payment confirmed / staff confirms | Move reserved to sold |
| Reservation expires | Cleanup cron releases as safety net |
| Return approved | Restock based on condition |

### 14.3 Required Stock Reservation Constraint

```sql
>>>>>>> 237defddb36a55ff05e88f0e276de368dfccd316:Zabir_Boutiques_Master_Plan.md
CREATE UNIQUE INDEX idx_stock_reservations_order_active
  ON stock_reservations(order_id)
  WHERE status = 'active';
```

<<<<<<< HEAD:Zabir_Boutiques_Master_Plan - Part-2.md
**Rollback SQL:**

```sql
-- migrations/rollback/0027_stock_reservations_unique_constraint.rollback.sql
DROP INDEX IF EXISTS idx_stock_reservations_order_active;
-- ROLLBACK_EXCEPTION: column release_requested_at left in place; harmless and idempotent.
-- SQLite does not support DROP COLUMN before 3.35. Even on supported versions,
-- leaving an unused column in place is safer than rebuilding the table.
-- The schema-diff script in Section 35.4 check #2 honors this ROLLBACK_EXCEPTION marker.
```

**Test fixture assertions:**

- Insert two rows with the same `order_id` and `status = 'active'` → second insert fails with UNIQUE violation.
- Insert two rows with the same `order_id` but different status (`'active'` and `'released'`) → both succeed (partial index).
- Update an active row's `release_requested_at` to a non-NULL value → succeeds.
- The cleanup cron's `UPDATE ... SET release_requested_at = ... WHERE release_requested_at IS NULL` is atomic and prevents double-release in concurrent tests.

#### Migration 0028 — `drop_legacy_abandoned_cart_columns`

| Property | Value |
|---|---|
| Depends on | All prior `cart_activity` migrations |
| Required by milestone | M9 (Email) — must ship before the abandoned-cart cron goes live, so the cron query does not reference non-existent columns |
| Estimated effort | 0.5 day |
| Risk | Low — drops columns that are no longer referenced by any V7 code path. Pre-flight check ensures the columns exist before dropping. |

**Why this migration exists:** pre-V7 production may have `abandoned_1h_sent_at` and `abandoned_24h_sent_at` columns on `cart_activity` from earlier drafts. V7 replaced these with a single `abandoned_email_sent_at` column (Section 6.3). Without this migration, the Section 34.4 check #4 ("legacy columns absent") would fail forever in any environment that carried the old columns forward.

**Pre-flight check (run before the migration):**

```sql
-- migrations/preflight/0028_check_legacy_columns.sql
-- Returns the legacy columns that currently exist on cart_activity.
-- The migration's forward SQL only drops columns that appear here.
PRAGMA table_info(cart_activity);
-- Inspect the result for rows where name IN ('abandoned_1h_sent_at', 'abandoned_24h_sent_at').
```

**Forward SQL (conditional, run per-column based on pre-flight):**

```sql
-- migrations/0028_drop_legacy_abandoned_cart_columns.sql
-- SQLite 3.35+ supports DROP COLUMN. D1 uses a recent SQLite, so this is safe.
-- If a column does not exist, the statement will error; the migration runner
-- must tolerate that error for this migration only (similar to IF EXISTS semantics).
-- Alternative: wrap each statement in a try/catch in the migration runner script.

ALTER TABLE cart_activity DROP COLUMN abandoned_1h_sent_at;
ALTER TABLE cart_activity DROP COLUMN abandoned_24h_sent_at;
```

**Rollback SQL:**

```sql
-- migrations/rollback/0028_drop_legacy_abandoned_cart_columns.rollback.sql
-- ROLLBACK_EXCEPTION: re-adding the legacy columns does NOT restore their data.
-- The columns were unused in V7 code paths; re-adding them as nullable TEXT columns
-- is sufficient for schema parity if a rollback is needed.
ALTER TABLE cart_activity ADD COLUMN abandoned_1h_sent_at TEXT;
ALTER TABLE cart_activity ADD COLUMN abandoned_24h_sent_at TEXT;
```

**Test fixture assertions:**

- After forward SQL: `PRAGMA table_info(cart_activity)` does NOT contain `abandoned_1h_sent_at` or `abandoned_24h_sent_at`.
- After forward SQL: `PRAGMA table_info(cart_activity)` DOES contain `abandoned_email_sent_at` (from migration 0023 or earlier — this migration does not add it, only drops legacy).
- After rollback SQL: both legacy columns are present (nullable, empty).
- The abandoned-cart cron query (Section 17.3) runs successfully after forward SQL.

### 35.3 Sequencing and Milestone Mapping

| Migration | Ships in milestone | Phase (Section 29) | Blocking | Notes |
|---|---|---|---|---|
| 0024 `otp_secrets` | M6 Security | Phase 2 | Owner TOTP 2FA UI | Ship early in Phase 2 so 2FA is opt-in before public launch |
| 0025 `api_audit_logs` | M7 Observability | Phase 2 | FraudBD circuit breaker (M10) | Must be in place before FraudBD ships so breaker transitions are persisted from day 1 |
| 0026 `ai_budget_limits` | M12 AI | Phase 3 | BudgetCounterDO | Seed data is part of the migration — do not seed via a separate script |
| 0027 `stock_reservations_unique_constraint` | M4 Inventory | Phase 1 | Cleanup cron (same milestone) | Pre-flight duplicate check is mandatory before applying |
| 0028 `drop_legacy_abandoned_cart_columns` | M9 Email | Phase 2 | Abandoned-cart cron (same milestone) | Pre-flight check for legacy column existence; only drops columns that are present |

### 35.4 Migration CI Gate

Every migration PR must pass the following CI checks before merge, in addition to the standard pipeline in Section 26.2:

1. **Forward SQL runs cleanly** against a fresh D1 local instance.
2. **Rollback SQL runs cleanly** against a D1 local instance that has just had the forward SQL applied. After rollback, the schema must match the pre-migration schema (asserted by a schema-diff script).
   - **Exception (additive-column rollback):** SQLite does not support `DROP COLUMN` before version 3.35, and even on supported versions leaving an additive column in place after rollback is harmless. A migration MAY document this exception by adding a comment in the rollback file: `-- ROLLBACK_EXCEPTION: column {name} left in place; harmless and idempotent.` The schema-diff script MUST honor this comment and not flag the residual column as a rollback failure. Migration 0027 uses this exception for the `release_requested_at` column.
3. **Test fixture passes** — all assertions in `migrations/tests/{NNNN}_*.test.ts` pass.
4. **Invalid-insert tests** — for every NOT NULL, FK, CHECK, and UNIQUE constraint, an insert that violates it must fail. This is the "constraint test" referenced in Guardrail #32.
5. **Pre-flight checks pass** (where defined) — for migrations like 0027 that have a pre-flight script, the script must return zero rows against staging data.
6. **Migration is numbered correctly** — `NNNN` is exactly one greater than the highest existing migration number. No gaps, no reuse.
7. **Rollback file exists** and is non-empty.
8. **`_migrations` table insertion** — the migration runner inserts a row into `_migrations` with the migration id, applied timestamp, SHA-256 of the forward SQL, and SHA-256 of the rollback SQL.

A migration PR that fails any check is blocked from merge. The RC cannot override this gate.

### 35.5 Migration Apply Procedure (Staging → Production)

| Step | Action | Owner | Soak time |
|---|---|---|---|
| 1. Apply to dev | `wrangler d1 migrations apply zabir-dev-db --local` then `--remote` | Engineer who opened the PR | N/A |
| 2. Run dev smoke tests | Product page, cart, checkout, staff login, POS — all must pass | Same engineer | 30 min |
| 3. Apply to staging | `wrangler d1 migrations apply zabir-staging-db --remote` | Same engineer | N/A |
| 4. Run staging constraint tests | The invalid-insert test suite from CI, run against staging | Release Captain | 1h |
| 5. Run pre-flight checks (if defined) | e.g. `0027_check_duplicates.sql` against staging | GO for the cluster | 1h |
| 6. **24-hour soak** (mandatory for risky migrations) | Staging runs with the new schema under realistic load for 24 hours | Release Captain | 24h |
| 7. ARB sign-off | ARB reviews staging results, signs off on production apply | ARB | N/A |
| 8. Backup production D1 | `d1-backup` queue message enqueued; wait for completion confirmation | Release Captain | Until backup verified |
| 9. Apply to production | `wrangler d1 migrations apply zabir-prod-db --remote` during the agreed deploy window | Release Captain + ARB reviewer on call | N/A |
| 10. Post-deploy verification | Smoke tests + the migration's test fixture run against production | Release Captain | 30 min |
| 11. Update release sign-off record | Section 34.5 record updated with migration list | Release Captain | N/A |

The 24-hour soak (step 6) is skipped only for migrations explicitly marked "low risk, additive only" by the ARB — migrations 0024, 0025, 0026 qualify; 0027 does NOT.

### 35.6 Migration Failure Recovery

If a migration apply fails in production:

1. **Do not panic-rollback.** First, capture the exact error message, the migration runner state, and the current schema (via `PRAGMA table_info` on affected tables).
2. **Assess blast radius.** Did the forward SQL partially apply? (SQLite D1 migrations are NOT transactional by default — a multi-statement migration can leave the DB in a half-applied state.)
3. **If forward SQL is fully applied but post-migration verification failed:** apply the rollback SQL. If rollback succeeds, proceed to root-cause the failure. If rollback fails, this is a P0 incident — convene ARB immediately.
4. **If forward SQL is partially applied:** do NOT apply rollback. Manually inspect the schema, identify which statements succeeded, and write a targeted repair migration (numbered `NNNNa`, `NNNNb`, etc.). This is the only situation where a "repair" migration is allowed.
5. **Restore from backup only as last resort** — if both forward and rollback are unrecoverable. This loses all writes since the pre-migration backup; treat as a P0 incident per Section 27.4.

Every migration failure, regardless of severity, produces a post-mortem and a `GV-{YYYY}-{NN}` tag for trend tracking.

---

## 36. TypeScript Contract Stubs

The contracts in Sections 11.3 (VariantInventoryDO), 24.2 (BudgetCounterDO), and 17.1 (EmailProvider) are written in prose-and-signature form. This section provides the canonical TypeScript stub files that ship in the repo so the contracts become compiler-enforced. Any deviation from these stubs is a TypeScript error and blocks the PR.

The stubs live under `src/lib/contracts/` (a new directory) and are imported by the actual DO and adapter implementations. The implementations must satisfy `implements <InterfaceName>` — this is the enforcement mechanism.

### 36.1 Directory Layout
=======
Cleanup cron:

```txt
Schedule: 0 * * * *
Window: created_at < datetime('now', '-15 minutes')
Filter: status='active' AND release_requested_at IS NULL
Action: stamp release_requested_at, call VariantInventoryDO.release()
```

---

## 15. POS and In-Store Sales

POS is separate from online checkout.

### 15.1 POS Rules

- POS does not use guest checkout.
- POS does not use COD.
- POS does not initiate UddoktaPay/SSLCommerz.
- POS does not use checkout reservations.
- POS stock deduction must pass through `VariantInventoryDO.directSale()`.
- D1 invoice ledger is written only after directSale succeeds.
- If invoice write fails after directSale, call `reverseDirectSale()` immediately.

### 15.2 POS Compensating Transaction

```txt
1. Create invoice_id before sale.
2. Call VariantInventoryDO.directSale().
3. If insufficient stock, stop.
4. If directSale succeeds, write D1 invoice transaction.
5. If D1 write fails, call reverseDirectSale(reason='d1_invoice_write_failed').
6. If reversal succeeds, log P1 audit event and ask cashier to retry.
7. If reversal fails, log P0 audit event and alert on-call.
```

### 15.3 Mandatory Test Matrix

#### POS Tests

```txt
POS-01 directSale success + invoice write success
POS-02 directSale insufficient stock
POS-03 directSale conflict
POS-04 invoice write fails + reverseDirectSale succeeds
POS-05 reverseDirectSale idempotency
POS-06 reverseDirectSale fails -> P0 audit
POS-07 daily reconciliation POS carve-out
POS-08 same-day void uses reverseDirectSale
POS-09 multi-line sale partial failure
POS-10 cleanup cron does not touch directSale state
POS-11 CI gate checks output/static and prerender=false drift
```

#### CartDO Tests

```txt
CART-01 addItem creates cart with version
CART-02 addItem increments version
CART-03 removeItem removes item, increments version
CART-04 changeQuantity updates item, increments version
CART-05 clearCart clears items, increments version
CART-06 applyCoupon / removeCoupon version increment
CART-07 getCart returns current state, no version increment
CART-08 5-minute alarm fires and persists to D1
CART-09 30-day cleanup alarm fires and deletes cart
CART-10 alarm re-arm after eviction on getCart
CART-11 guarded upsert rejects stale writes
CART-12 mergeCart combines items correctly
```

#### Checkout Service Tests

```txt
CHK-01 normal checkout with COD
CHK-02 checkout with coupon
CHK-03 checkout triggers prepayment above threshold
CHK-04 checkout blocked by fraud score >70
CHK-05 checkout with pending_review for score 41-70
CHK-06 checkout stock reservation failure
CHK-07 D1 write failure -> reservation release
CHK-08 duplicate idempotency key returns cached response
CHK-09 Buy Now checkout through checkout service
CHK-10 Guest checkout reads session from CartDO
```

#### Payment Service Tests

```txt
PAY-01 UddoktaPay createPayment success
PAY-02 UddoktaPay createPayment timeout (1.5s) -> circuit open
PAY-03 SSLCommerz createPayment success
PAY-04 Webhook signature verification (UddoktaPay HMAC-SHA256)
PAY-05 Webhook signature verification (SSLCommerz SHA256 sorted params)
PAY-06 Malformed webhook rejected
PAY-07 Payment reconciliation: pending order <30min -> verify with provider
PAY-08 Never downgrade confirmed paid order
PAY-09 Idempotent payment event insert
```

#### RBAC Tests

```txt
RBAC-01 super_admin has all permissions (platform + business)
RBAC-02 owner has business perms, denied platform perms
RBAC-03 manager has daily ops perms, denied owner/super_admin perms
RBAC-04 staff has combined sales+packing+support perms
RBAC-05 viewer is read-only
RBAC-06 fraud-blocked order requires fraud.override to confirm
RBAC-07 Route-permission mapping in staff-route-rbac.ts
```

#### Coverage Targets

```txt
100% line coverage for directSale and reverseDirectSale
100% branch coverage for POS compensation paths
>=95% line coverage for VariantInventoryDO contract
>=90% line coverage for CartDO contract (all 8 mutations + alarm lifecycle)
>=90% line coverage for checkout service (all payment methods + failure paths)
>=90% line coverage for payment adapter contracts (create + verify + parseWebhook)
100% branch coverage for RBAC permission checks and helper assertions
```

---

## 16. Order Lifecycle

| State | Allowed next states | Notes |
|---|---|---|
| `created` | `pending_review`, `confirmed`, `cancelled` | Reservation exists |
| `pending_review` | `confirmed`, `cancelled` | No fulfillment until reviewed |
| `confirmed` | `processing`, `cancelled` | Move reserved to sold |
| `processing` | `shipped`, `cancelled` | Fulfillment in progress |
| `shipped` | `delivered`, `returned` | Tracking visible |
| `delivered` | `returned` | COD balance recorded if needed |
| `cancelled` | terminal | Must not return to confirmed |
| `returned` | `refunded`, `restocked` | Based on return decision |
| `refunded` | terminal | Finance closed |

Invalid transitions are rejected and logged as security or bug events.

### 16.1 Return & Refund Flow

#### API Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/staff/returns/[id]/approve` | POST | Approve return, decide restock |
| `/api/staff/returns/[id]/reject` | POST | Reject return request |
| `/api/staff/returns` | GET | List return requests |

#### Return-to-Inventory Decision Logic

When a return is approved:

1. Staff inspects returned items and sets condition: `restockable` or `discard`.
2. If `restockable`: call `VariantInventoryDO.adjustStock(variant_id, +quantity, reason='return_approved')`.
3. If `discard`: log the disposal reason in `return_items.disposal_note`; do not adjust stock.
4. Order status moves to `returned` if all items are returned, or stays in current state for partial returns.

#### Refund Initiation Rules

| Original payment method | Refund action |
|---|---|
| `cod` (no advance taken) | No financial refund needed. Order marked returned. |
| `partial_prepay` (advance paid) | Initiate refund to original payment method if possible, else store credit. |
| `uddoktapay` | Initiate refund through UddoktaPay API (`refund()` on adapter). |
| `sslcommerz` | Initiate refund through SSLCommerz API (`refund()` on adapter). |
| `in_store` | Cash refund processed at counter; logged in `refunds` table. |

Refund adapter method follows the `PaymentProvider.refund()` contract. All refunds are logged in the `refunds` table and an `audit_log` event is created.

#### Return/Restock Tables

```sql
CREATE TABLE returns (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  return_reason TEXT NOT NULL,
  staff_notes TEXT,
  condition TEXT CHECK(condition IN ('restockable', 'discard', 'pending_inspection')),
  approved_by TEXT REFERENCES staff_users(id),
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES returns(id),
  variant_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  condition TEXT CHECK(condition IN ('restockable', 'discard', 'pending_inspection')),
  disposal_note TEXT,
  restocked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  return_id TEXT REFERENCES returns(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  amount_paisa INTEGER NOT NULL,
  refund_method TEXT NOT NULL,
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'initiated', 'completed', 'failed')),
  initiated_by TEXT REFERENCES staff_users(id),
  initiated_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);
```

---

## 17. Staff, RBAC, and Zero Trust

### 17.1 Staff Protection

- `/staff/*` and `/api/staff/*` must be protected by Cloudflare Zero Trust Access.
- App-level RBAC is still required after Access.
- Access is perimeter identity; RBAC is business authorization.
- Owner requires TOTP 2FA.
- Staff sessions use Secure, HttpOnly, SameSite=Strict cookies.
- Idle timeout: 30 minutes.
- Absolute timeout: 8 hours.
- Max concurrent sessions: 2 per staff user.

### 17.2 Roles (5-Role Model)

The system uses exactly 5 roles. The role is stored in `staff_users.role` with a CHECK constraint enforcing valid values. The roles table (migration 0039) seeds these 5 roles with corresponding `role_permissions`.

| Role | Code value | Description |
|---|---|---|
| Super Admin | `super_admin` | Full platform + business access. System config, API keys, integrations, backups, all operations. |
| Owner | `owner` | Full business-level access. Staff, products, orders, payments, fraud, reports. No platform-level controls. |
| Manager | `manager` | Daily operations: products, categories, inventory, orders, fraud review, media, support, reports. |
| Staff | `staff` | Combined sales + packing + support. Create orders, pack, ship, support notes. Cannot manage products. |
| Viewer | `viewer` | Read-only: audit logs, reports, API code view. No mutations. |

#### Permission Matrix

| Permission | Super Admin | Owner | Manager | Staff | Viewer |
|---|---|---|---|---|---|
| `staff.manage` | Yes | Yes | No | No | No |
| `roles.manage` | Yes | No | No | No | No |
| `settings.manage` | Yes | Yes | No | No | No |
| `system.audit.view` | Yes | Yes | No | No | Yes |
| `system.backup.manage` | Yes | Yes | No | No | No |
| `products.manage` | Yes | Yes | Yes | No | No |
| `categories.manage` | Yes | Yes | Yes | No | No |
| `inventory.manage` | Yes | Yes | Yes | No | No |
| `inventory.adjust` | Yes | Yes | Yes | No | No |
| `orders.view` | Yes | Yes | Yes | Yes | No |
| `orders.create` | Yes | Yes | Yes | Yes | No |
| `orders.update` | Yes | Yes | Yes | Yes | No |
| `orders.confirm` | Yes | Yes | Yes | No | No |
| `orders.cancel` | Yes | Yes | Yes | No | No |
| `orders.pack` | Yes | Yes | Yes | Yes | No |
| `orders.ship` | Yes | Yes | Yes | Yes | No |
| `payments.view` | Yes | Yes | Yes | No | No |
| `payments.verify` | Yes | Yes | No | No | No |
| `payments.refund` | Yes | Yes | No | No | No |
| `fraud.view` | Yes | Yes | Yes | No | No |
| `fraud.override` | Yes | Yes | No | No | No |
| `media.upload` | Yes | Yes | Yes | No | No |
| `support.view` | Yes | Yes | Yes | Yes | No |
| `support.note` | Yes | Yes | Yes | Yes | No |
| `reports.view` | Yes | Yes | Yes | No | Yes |
| `api_code.read` | Yes | Yes | No | No | Yes |
| `api_code.update` | Yes | No | No | No | No |
| `platform.full_access` | Yes | No | No | No | No |
| `integrations.read` | Yes | Yes | No | No | No |
| `integrations.test` | Yes | No | No | No | No |
| `integrations.logs.read` | Yes | No | No | No | No |
| `api_keys.read` | Yes | No | No | No | No |
| `api_keys.create` | Yes | No | No | No | No |
| `api_keys.delete` | Yes | No | No | No | No |
| `backups.read` | Yes | No | No | No | No |
| `backups.download` | Yes | Yes | No | No | No |
| `backups.restore` | Yes | No | No | No | No |
| `webhooks.read` | Yes | No | No | No | No |
| `webhooks.update` | Yes | No | No | No | No |
| `settings.platform.read` | Yes | No | No | No | No |
| `settings.platform.update` | Yes | No | No | No | No |

#### Staff Route -> Permission Map

Every `/staff/*` and `/api/staff/*` route is protected by a permission lookup in `src/lib/staff-route-rbac.ts`. The mapping is:

| Route pattern | Required permission | Mutation check? |
|---|---|---|
| `/logout`, `/step-up`, `/totp/` | `null` (authentication only) | No |
| `/refund` | `payments.refund` | Yes |
| `/orders/create` | `orders.create` | Yes |
| `/orders/*/confirm` | `orders.confirm` | Yes |
| `/orders/*/label`, `/orders/*/pack` | `orders.pack` | Yes |
| `/orders/*/ship`, `/orders/*/courier` | `orders.ship` | Yes |
| `/returns/*/approve`, `/returns/*/reject` | `orders.update` | Yes |
| `/returns` | `orders.update` (mut) / `orders.view` (read) | Yes |
| `/fraud/override` | `fraud.override` | Yes |
| `/invoices/*/void` | `orders.cancel` | Yes |
| `/invoices` | `orders.create` (mut) / `orders.view` (read) | Yes |
| `/coupons` | `staff.manage` | Yes |
| `/cache/` | `settings.platform.update` | Yes |
| `/api-keys` | `api_keys.create` (mut) / `api_keys.read` (read) | Yes |
| `/api-code` | `api_code.update` (mut) / `api_code.read` (read) | Yes |
| `/uploads` | `media.upload` | Yes |
| `/ai/` | `products.manage` | Yes |
| `/roles` | `roles.manage` | Yes |
| `/users` | `staff.manage` | Yes |
| `/settings` | `settings.manage` | Yes |
| `/backups` | `null` (handler calls `assertSuperAdminOnly`) | Yes |
| `/audit` | `system.audit.view` | No |
| `/products/categories` | `products.manage` | Yes |
| `/products` | `products.manage` | Yes |
| `/inventory/adjust` | `inventory.adjust` | Yes |
| `/inventory/movements`, `/inventory/variants` | `inventory.manage` | Yes |
| `/orders` (default) | `orders.update` (mut) / `orders.view` (read) | Yes |

Logic: `getRequiredStaffPermission()` in `src/lib/staff-route-rbac.ts`. For mutation methods (POST, PUT, PATCH, DELETE), the permission must match; for read methods (GET, HEAD, OPTIONS), a read-level permission suffices.

### 17.3 Staff-Assisted Orders

Phone, Messenger, WhatsApp, and in-store delivery orders use the same secure checkout service as guest checkout, with staff identity attached.

Staff-assisted orders still require:

```txt
server-side price
COD quantity rule
FraudBD policy
stock reservation
payment/prepayment rule
idempotency
audit log
```

---

## 18. Security Architecture

### 18.1 Baseline Headers

```txt
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Enable HSTS only after HTTPS, DNS, redirects, and payment flows are verified.

### 18.2 Public CSP

```txt
default-src 'self';
script-src 'self' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' https://cdn.zabirboutiques.com https://*.r2.dev data: blob:;
connect-src 'self'
  https://api.uddoktapay.com
  https://uddoktapay.com
  https://securepay.sslcommerz.com
  https://api.fraudbd.com
  https://api.resend.com
  https://api.deepseek.com
  https://*.imagify.com
  https://api.pathao.com
  https://portal.packzy.com
  https://api.redx.com.bd
  https://*.r2.cloudflarestorage.com;
frame-src 'self'
  https://challenges.cloudflare.com
  https://securepay.sslcommerz.com
  https://uddoktapay.com;
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self' https://uddoktapay.com https://securepay.sslcommerz.com;
media-src 'self' https://cdn.zabirboutiques.com;
worker-src 'self';
manifest-src 'self';
frame-ancestors 'none';
```

### 18.3 Staff CSP

Staff routes should use a tighter CSP. Staff pages should not connect to AI, courier, or payment domains unless a specific staff workflow requires it.

```txt
default-src 'self';
script-src 'self' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' https://cdn.zabirboutiques.com https://*.r2.dev data: blob:;
connect-src 'self';
frame-src 'self' https://challenges.cloudflare.com;
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
```

### 18.4 CSRF

Unsafe methods require:

```txt
HttpOnly session cookie
non-HttpOnly CSRF cookie or server nonce
HMAC-signed CSRF header
Origin/Referer validation for staff and checkout
monthly CSRF signing key rotation
```

### 18.5 Turnstile

Turnstile is required for:

```txt
staff login
checkout when risk threshold triggers
coupon after repeated failures
contact forms
password reset
```

Server-side validation is mandatory. Client widget success alone is not accepted.

### 18.6 Rate Limits

| Route | Limit |
|---|---:|
| `/api/checkout` | 20/min/IP |
| `/staff/login` | 5/min/IP and 10/min/email |
| `/api/coupon/apply` | 5/min/session |
| `/api/payments/webhook` | Provider allowlist + signature; rate anomaly alert |
| `/api/search` | 60/min/IP |
| `/api/staff/password-reset/*` | 3 attempts / 15 min / IP |
| Public product pages | 100/min/IP before challenge |

### 18.7 Secrets

All secrets live in Cloudflare Secrets or Secrets Store.

Forbidden:

```txt
.env committed to Git
API key in source code
raw webhook payload in logs
payment provider secret in client bundle
TOTP encryption key in D1
```

---

## 19. WAF, Bot, and Origin Protection

### 19.1 WAF Rules

Required route groups:

```txt
checkout sensitive: /api/checkout, /checkout, /buy-now/*
staff sensitive: /staff/*, /api/staff/*
payment sensitive: /api/payments/webhook
coupon sensitive: /api/coupon/*
password reset: /api/staff/password-reset/*
search: /api/search
```

Actions:

- Managed challenge suspicious checkout/coupon traffic.
- Block obvious malicious payloads.
- Rate-limit login and password reset.
- Do not challenge verified payment webhooks before signature parsing unless provider traffic can still pass.

### 19.2 Origin Protection

If any non-Cloudflare origin exists:

```txt
Cloudflare Tunnel preferred
or Authenticated Origin Pulls
origin firewall deny public inbound access
no direct origin IP in DNS history if avoidable
```

---

## 20. Caching and CDN

| Content | Strategy | TTL | Purge |
|---|---|---:|---|
| Homepage | Static/SWR | 10 min | `homepage` tag |
| Product page | Prerender + live stock API | 1 hour | `product-{id}` tag |
| Category page | Prerender/SWR | 30 min | `category-{id}` tag |
| Product listing API | Cache API | 5 min | Catalog change |
| R2 images | CDN long cache | 7 days+ | Image update |
| JS/CSS | Immutable | 1 year | Content hash |
| Checkout/auth/staff | No-store | 0 | Never cached |
| Sitemap | R2 static | 24 hours | Daily cron |

Rules:

- Never cache user-specific checkout/cart/staff responses.
- Use Cache Tags for targeted purge.
- Avoid purge-everything during business hours.
- Stock changes purge product cache only when visible availability changes.

---

## 21. Performance Budgets

### 21.1 Desktop / Fast Connection

| Metric | Target | CI Fail |
|---|---|---:|---:|
| LCP | <2.5s | >3.0s |
| INP | <200ms | >300ms |
| CLS | <0.1 | >0.15 |
| Public TTFB | <300ms | >800ms |
| Checkout TTFB | <800ms | >1200ms |
| Total page weight | <500KB | >700KB |
| Public JS island | <30KB gzip | >50KB gzip |
| Public hydrated islands/page | <=5 | >7 |
| Checkout Worker CPU | <30ms | >50ms |
| Search p95 | <200ms | >500ms |

### 21.2 Mobile / Slow 3G (Bangladesh Primary)

Bangladesh is overwhelmingly mobile-first with significant 3G/4G usage. These budgets apply to Lighthouse mobile emulation with throttled 3G:

| Metric | Target | CI Fail |
|---|---|---:|---:|
| LCP (3G) | <4.0s | >6.0s |
| FCP (3G) | <2.0s | >3.5s |
| TTFB (3G) | <1.5s | >3.0s |
| First Input Delay | <100ms | >200ms |
| Total page weight (3G) | <300KB | >500KB |
| Image budget per page | <200KB | >350KB |
| Time to Interactive (3G) | <5.0s | >8.0s |

Rules:

- Use responsive images and `srcset`.
- Lazy-load below-fold images.
- Avoid `client:load` except checkout and staff routes.
- Do not ship staff JS to public pages.
- Keep checkout bundle small and form-first.

---

## 22. SEO and Bangla Localization

### 22.1 URL Rules

```txt
/products/{latin-slug}
/categories/{latin-slug}
/blog/{latin-slug}
```

Rules:

- Latin lowercase hyphen slugs only for launch.
- Bangla content rendered with `?lang=bn`.
- Product canonical always points to `/products/{slug}`.
- Buy Now pages canonical to product page unless created as intentional campaign pages.
- Campaign Buy Now pages use `noindex` unless approved for SEO.

### 22.2 Structured Data

| Page | Schema |
|---|---|
| Product | Product + Offer |
| Category | ItemList |
| Homepage | Organization + WebSite |
| Breadcrumb | BreadcrumbList |
| Order tracking | Limited safe Order data |

### 22.3 Bangla Localization V1

Required:

- `Locale = 'en' | 'bn'` only.
- `?lang=bn` parser.
- `<html lang="bn">` only when Bangla strings are rendered.
- Bangla product fields in staff editor.
- Bangla FTS columns.
- Unicode normalization for search.
- No non-ASCII public slug unless later ADR approves it.

Example:

```ts
export type Locale = 'en' | 'bn';

export function parseLocale(url: URL): Locale {
  return url.searchParams.get('lang') === 'bn' ? 'bn' : 'en';
}
```

---

## 23. Search Architecture

### 23.1 Launch Search: D1 FTS5

Fields:
>>>>>>> 237defddb36a55ff05e88f0e276de368dfccd316:Zabir_Boutiques_Master_Plan.md

```txt
name
description
category
tags
sku
name_bn
description_bn
```

Requirements:

- FTS table maintained by triggers or service-layer writes.
- Product write must sync FTS.
- Tokenizer must be the same for insert and query paths.
- Bangla Taka token and key Bangla characters must survive tokenization.

### 23.2 Future Search

| Trigger | Upgrade |
|---|---|
| Catalog >10,000 products | Consider Typesense/Meilisearch/Algolia |
| Search p95 >200ms | Add managed search |
| Typo tolerance needed | Managed search or semantic search |
| Semantic intent needed | Workers AI embeddings with budget control |

---

## 24. Image Pipeline

### 24.1 Launch Mode

```txt
1. Staff uploads original image to R2 via signed URL.
2. Browser may create preview only, not production variants.
3. image-processing queue generates variants.
4. Imagify adapter optional; failure does not block product publish.
5. D1 stores image metadata and variant URLs.
6. Public pages use responsive srcset from available variants.
```

Required variants:

| Variant | Size | Use |
|---|---:|---|
| thumbnail | 150px | Admin/cart |
| card | 400px | Product grid |
| detail | 800px | Product page |
| zoom | 1600px | Zoom/gallery |
| og-image | 1200x630 | Social sharing |

### 24.2 Alt Text

Alt text is required before publish. AI may suggest it, staff must review it.

---

## 25. Email and Notifications

### 25.1 Email Adapter Contract

```ts
export interface SendEmailRequest {
  to: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
  from_name: string;
  subject: string;
  html: string;
  text?: string;
  tags?: string[];
  custom_args?: Record<string, string>;
  message_id: string;
}

export interface SendResponse {
  accepted: boolean;
  provider_message_id?: string;
  provider: 'resend' | 'cloudflare_email';
  status: 'sent' | 'queued' | 'failed';
  error_code?: string;
  error_message?: string;
}

export interface EmailProvider {
  sendEmail(request: SendEmailRequest): Promise<SendResponse>;
}
```

Provider selection:

```txt
EMAIL_PROVIDER=resend            # default
EMAIL_PROVIDER=cloudflare_email  # optional after account testing
```

### 25.2 Email Types

| Email | Trigger | Limit |
|---|---|---:|
| Order confirmation | Order creation | 1/order |
| Payment confirmation | Payment verified | 1/payment event |
| Shipping notification | Status shipped | 1/status |
| Delivery confirmation | Status delivered | 1/status |
| Password reset | Staff request | 3/hour/email |
| Abandoned cart | Eligible cart after 24h | 1/customer wave |
| Return confirmation | Return approved | 1/return |
| Low stock digest | Daily cron | 1/day/owner |

---

## 26. External API Governance

All third-party APIs must use adapters.

Required adapter layout:

```txt
src/lib/integrations/{provider}/client.ts
src/lib/integrations/{provider}/types.ts
src/lib/integrations/{provider}/errors.ts
src/lib/integrations/{provider}/mock.ts
src/lib/integrations/{provider}/index.ts
```

Every adapter must implement:

```txt
environment-aware base URL
Cloudflare Secret credentials
timeout
retry policy
idempotency where supported
circuit breaker through ProviderHealthDO
runtime schema validation
PII redaction before logging
sandbox/mock mode
audit logging to api_audit_logs
```

Forbidden:

```txt
raw fetch to third-party APIs from route handlers
API keys in client code
trusting provider response without schema validation
sending customer PII to AI providers unless explicitly approved
```

---

## 27. AI Integration

### 27.1 AI Features

| Feature | Primary | Fallback | Human Review |
|---|---|---|---|
| Product description | Workers AI | DeepSeek | Required |
| Alt text | Workers AI | Staff manual | Required |
| Semantic recommendations | Workers AI/logic | Category fallback | Optional |
| Search embeddings | Workers AI | D1 FTS | Not required |
| Content moderation | Rules + AI | Staff | Required |

### 27.2 Budget Rules

| Provider | Daily calls | Monthly calls | Daily USD | Monthly USD |
|---|---:|---:|---:|---:|
| Workers AI | 200 | 5000 | $1 | $20 |
| DeepSeek | 50 | 1000 | $5 | $100 |
| Imagify | as configured | as configured | $1 | $20 |

Rules:

- Block on whichever limit is hit first: count or USD.
- Soft alert at 80%.
- Hard block at 100%.
- Owner override allowed only with P2 alert per call.
- AI public content stays draft until staff approves.
- Prompt injection attempts are logged.

---

## 28. Observability and Monitoring

### 28.1 Structured Log Fields

```txt
timestamp
request_id
route
status_code
duration_ms
worker_cpu_ms
error_type
user_type
channel
payment_method
order_id_hash
provider
circuit_state
queue_name
retry_count
```

Never log:

```txt
full phone numbers
full addresses
API keys
payment secrets
raw webhook payloads
TOTP secrets
password reset tokens
```

### 28.2 Metrics and Alerts

| Metric | Alert |
|---|---|
| checkout_failure_rate | >20% for 15 min |
| payment_webhook_failure | any sustained failure |
| payment_reconciliation_mismatch | immediate P1/P0 depending scope |
| d1_query_duration_ms | p99 >2000ms |
| fraudbd_timeout_rate | >10% |
| provider_circuit_open | P2, P1 if checkout affected |
| cart_activity_stale_write_rejected | monitor, P2 if spike |
| stock_reservation_failures | >10/min/variant |
| pos_compensation_failure | P0 |
| email_send_failures | >5% for 15 min |
| cache_hit_rate_product | <70% |
| worker_cpu_time_ms | p99 >50ms |
| ai_budget_percent_used | alert at 80%, block at 100% |

### 28.3 Audit Events

Audit logs are append-only for:

```txt
staff login/logout/failure
staff PII access
order status change
payment status change
refund
stock adjustment
POS void
POS compensation
FraudBD decision
provider circuit transition
password reset create/use/failure
Owner VAT acknowledgement
AI budget override
waiver approval
release sign-off
```

---

## 29. CI/CD and Release Gates

### 29.1 Environments

| Environment | Domain | Data |
|---|---|---|
| Production | `zabirboutiques.com` | Real data |
| Staging | `staging.zabirboutiques.com` | Anonymized copy |
| Development | `dev.zabirboutiques.com` | Seed data |

Each environment has separate:

```txt
D1 database
R2 buckets
KV namespaces
Durable Object namespace
Queues
Secrets
Access policy
```

### 29.2 CI Pipeline

```txt
1. Install dependencies
2. Type check
3. Lint
4. Unit tests
5. Contract tests
6. D1 migration dry-run
7. D1 invalid-insert tests
8. Drizzle schema parity test
9. Astro build
10. Bundle size check
11. Lighthouse CI
12. CSP tests
13. Security scan: secrets, PII logs, direct external fetch
14. Drift audit
15. Preview deploy
16. Manual production approval
17. Production deploy
18. Smoke tests
19. Targeted cache purge
```

Production deploy is blocked if any P0 test fails.

### 29.3 Migration Rules

- Numbered migrations only.
- Rollback file required.
- SQLite/D1-compatible syntax only.
- Staging first.
- Risky migrations soak for 24 hours.
- Never edit an already-applied migration.
- Add test fixture for constraints, invalid inserts, and rollback.

---

## 30. Disaster Recovery

| Target | Requirement |
|---|---:|
| RPO | 6 hours |
| RTO | 2 hours |
| D1 backup | Every 6 hours |
| Backup retention | 30 daily, 12 monthly |
| Restore test | Weekly to staging |

Backup flow:

```txt
Cron -> backup worker -> D1 export -> R2 zabir-backups -> checksum -> backup_log -> alert on failure
```

Restore checklist:

```txt
1. Select latest verified backup.
2. Restore to new D1 database or staging first.
3. Verify row counts and checksum.
4. Run schema integrity tests.
5. Update bindings if needed.
6. Purge affected cache tags.
7. Smoke test product, checkout, payment, staff, POS.
8. Monitor for 30 minutes.
```

If data corruption is suspected, stop writes before repair.

---

## 31. Privacy, Compliance, and PCI Scope

### 31.1 Data Minimization

Guest checkout collects only:

```txt
name
phone
delivery address
optional email
optional note
```

Do not collect NID, date of birth, gender, or card details unless a legal/commercial requirement is documented.

### 31.2 Retention

| Data | Retention |
|---|---:|
| Customer PII | 3 years unless deletion requested |
| Orders | 7 years |
| Payment records | 7 years |
| Audit logs | 7 years or legal requirement |
| Hot logs | 90 days |
| Cold redacted logs | 1 year |
| Backups | 30 daily, 12 monthly |

### 31.3 PCI Scope

- Hosted payment pages only.
- No custom card forms.
- No card data stored, logged, or proxied.
- Webhook payloads redacted.
- Annual PCI SAQ A checklist.

---

## 32. P0 Remediation Backlog

The project must not launch until these are fixed or formally waived by the Architecture Review Board.

### 32.1 Immediate P0 Fixes

| ID | Fix | Expected output |
|---|---|---|
| P0-01 | Launch CSP public/staff split | `src/lib/security/csp.ts`, `tests/csp.test.ts` |
| P0-02 | Payment event index | migration + rollback + test |
| P0-03 | Canonical payment conflict SQL | payment service + tests |
| P0-04 | UddoktaPay timeout/idempotency | adapter tests |
| P0-05 | Checkout payment initiation | checkout integration test |
| P0-06 | Cart activity race columns | migration + guarded upsert tests |
| P0-07 | CartDO two-stage alarm lifecycle | DO tests |
| P0-08 | Cart version contract | `tests/cart_version.test.ts` |
| P0-09 | POS directSale stock checks | inventory DO tests |
| P0-10 | POS reverseDirectSale audit | POS compensation tests |
| P0-11 | `direct_checkout_activity` table | migration + Buy Now tests |
| P0-12 | Staff password reset tables | migration + security tests |

### 32.2 Short-Term P0/P1 Hardening

| ID | Fix |
|---|---|
| H-01 | Drizzle schema for all D1 tables |
| H-02 | Full TypeScript contract stubs |
| H-03 | Drift audit D-01 to D-56 |
| H-04 | Bangla localization + FTS rebuild |
| H-05 | Real D1 invalid-insert tests |
| H-06 | WAF/rate limits Terraform |
| H-07 | Zero Trust Access config audit |
| H-08 | Turnstile server validation tests |
| H-09 | Origin protection with Tunnel/AOP if origin exists |
| H-10 | Observability dashboards and alerts |

---

## 33. Guardrails

These are absolute unless an ADR-approved waiver exists.

1. No `output: 'static'` or `output: 'hybrid'`.
2. No `prerender = false` on dynamic routes.
3. No browser-trusted price, stock, discount, VAT, delivery fee, total, advance, or balance.
4. No floating-point commerce money.
5. No authoritative cart in KV or localStorage.
6. CartDO must implement two-stage alarm lifecycle.
7. CartDO D1 projection writes must use monotonic guarded upsert.
8. Cart version rules must pass contract tests.
9. Buy Now must not mutate CartDO.
10. Buy Now submit must use the checkout service.
11. DirectCheckoutSessionDO must validate Origin and User-Agent hash.
12. No order before stock reservation.
13. D1 order write failure must release all reservations immediately.
14. Reservation cleanup cron is safety net only.
15. Stock reservation must have partial unique active-order index.
16. POS must use directSale/reverseDirectSale.
17. POS compensation failure is P0.
18. Payment redirect does not mark payment paid.
19. Webhooks require signature verification.
20. Reconciliation must verify provider before state change.
21. Payment updates must use guarded forward-only SQL.
22. Staff routes require Access and RBAC.
23. Owner role requires TOTP.
24. Password reset uses HMAC one-time tokens.
25. No PII or secrets in logs.
26. External APIs use adapters only.
27. Provider adapters require timeout, retry policy, circuit breaker, schema validation, and mock tests.
28. Turnstile requires server-side verification.
29. CSP must not block payment, Turnstile, images, or staff flows.
30. Checkout/auth/staff responses are never cached.
31. Public pages must meet performance budgets.
32. Accessibility WCAG 2.1 AA is mandatory.
33. Browser uploads original images only; variants are queue-generated.
34. AI public content requires staff review.
35. DeepSeek budget check required before call.
36. Drizzle must not directly mutate stock.
37. Every D1 table must have Drizzle schema.
38. Bangla search fields must be included in FTS.
39. Public slugs remain Latin unless ADR approves change.
40. All migrations require rollback and tests.
41. Drift audit must parse full guardrail catalogue and fail closed.
42. P0 tests block release.
43. Waivers expire within 30 days and cannot be silent.
44. Release sign-off required for production deploy.
45. Expensive add-ons need Owner approval.

---

## 34. Drift Audit Requirements

The drift audit script must check at least these categories:

```txt
Astro rendering drift
prerender false drift
cart localStorage/KV authority drift
cart alarm lifecycle drift
cart race-contract columns drift
payment SQL drift
payment event index drift
FraudBD retry/circuit drift
POS compensation drift
CSP allowlist drift
Turnstile validation drift
password reset token drift
Bangla localization drift
FTS tokenizer drift
Drizzle schema coverage drift
direct stock mutation drift
PII log drift
external API direct fetch drift
AI budget bypass drift
migration rollback drift
```

The script must fail if the catalogue count and implemented checks count differ.

---

## 35. AI Coding Agent Instructions

Any AI coding agent must follow this exact order:

```txt
1. Read this Master Plan first.
2. Identify the feature or bug being implemented.
3. Identify affected guardrails.
4. Locate existing contracts in src/lib/contracts.
5. Implement only through the approved architecture path.
6. Add tests for happy path and failure path.
7. Run typecheck, lint, tests, migration dry-run, and drift audit.
8. Report any guardrail conflict instead of silently bypassing it.
```

### 35.1 AI Agent Forbidden Patterns

```txt
Do not store cart in localStorage as source of truth.
Do not store cart in KV as source of truth.
Do not trust browser totals.
Do not update inventory directly from route handlers.
Do not mark payment paid from redirect.
Do not call third-party APIs directly from routes.
Do not commit secrets.
Do not log PII.
Do not generate fake scarcity text.
Do not use output: static or hybrid.
Do not add prerender=false.
Do not bypass Turnstile server validation.
Do not ship without tests for failure branches.
```

### 35.2 AI Agent Implementation Prompt

```txt
You are working on Zabir Boutiques, a Cloudflare-native eCommerce and POS platform.

Before coding:
- Read docs/MASTER_PLAN.md.
- Treat it as the source of truth.
- Identify all affected guardrails.
- Do not bypass Durable Objects, payment verification, RBAC, CSP, or D1 migration rules.

Implementation rules:
- Astro uses output: 'server'. Static pages opt in with prerender=true.
- Cart authority is CartDO only.
- Inventory mutations go through VariantInventoryDO only.
- Payment status changes require verified provider event + guarded SQL.
- External APIs go through adapters.
- D1 schema changes require migration, rollback, and tests.
- Staff routes require Access + RBAC.
- All public money is integer paisa.
- No PII in logs.

For every change, deliver:
1. Code changes.
2. Tests for happy path and failure path.
3. Migration and rollback if schema changes.
4. Updated contract types if interface changes.
5. Short explanation of which guardrails are satisfied.

If a guardrail seems wrong, do not work around it. Propose an ADR or waiver.
```

---

## 36. Implementation Roadmap

### Phase 0: Release Blocker Stabilization

| Work | Outcome |
|---|---|
| CSP rewrite | Payment and Turnstile no longer blocked |
| Payment event index | Conflict queries scale |
| Payment guarded update | Webhook/reconciliation race fixed |
| UddoktaPay timeout | Checkout does not hang |
| Checkout payment initiation | Online/partial payment actually starts |
| WAF/rate limits | Abuse protection live |
| Turnstile backend validation | Bot challenge meaningful |

### Phase 1: State Integrity

| Work | Outcome |
|---|---|
| Cart race columns | D1 projection monotonic |
| CartDO alarm rewrite | Persistence and cleanup reliable |
| Cart version tests | Client/server conflict safe |
| Stock reservation constraints | Double active reservation blocked |
| POS compensation tests | Counter sales safe |

### Phase 2: Security and Staff Operations

| Work | Outcome |
|---|---|
| Zero Trust Access audit | Staff perimeter verified |
| Password reset tables/routes | Secure recovery |
| Owner TOTP | Privileged access hardened |
| RBAC audit logging | Staff PII access traceable |

### Phase 3: Data Layer and AI-Developer Safety

| Work | Outcome |
|---|---|
| Drizzle schema | Schema visibility and safer codegen |
| Contract stubs | Compile-time DO/API guarantees |
| Drift audit D-01 to D-56 | Release confidence |
| Migration test suite | Schema changes safe |

### Phase 4: Growth Features

| Work | Outcome |
|---|---|
| Bangla localization | Bangladesh customer UX improved |
| Bangla FTS | Search in Bangla works |
| Image pipeline | Faster product pages |
| AI content workflow | Staff-assisted product operations |
| Observability dashboards | Production operations ready |

---

## 37. Release Sign-Off Checklist

A production release requires all of the following:

```txt
[ ] No P0 guardrail violations
[ ] Astro output is server
[ ] No prerender=false
[ ] CSP tests pass
[ ] Turnstile server validation tests pass
[ ] Staff Access policy verified
[ ] RBAC tests pass
[ ] Payment webhook signature tests pass
[ ] Payment reconciliation tests pass
[ ] Payment event index exists
[ ] CartDO alarm tests pass
[ ] Cart race write tests pass
[ ] Cart version tests pass
[ ] Inventory reservation rollback tests pass
[ ] POS compensation tests pass
[ ] D1 migration dry-run passes
[ ] D1 invalid insert tests pass
[ ] Drizzle schema parity passes
[ ] No direct third-party fetch from route handlers
[ ] No PII logs found
[ ] Bundle and Lighthouse budgets pass
[ ] Backup and restore smoke test passes
[ ] Release Captain signed off
[ ] Owner/ARB approval recorded
```

---

## 38. Final Implementation Contract

Zabir Boutiques must remain Cloudflare-native, mobile-first, low-cost at launch, and safe for Bangladesh eCommerce operations.

The core rule is:

**Public pages may sell the product, but only trusted dynamic server paths may price, reserve, collect, verify, fulfill, refund, or mutate business state.**

Everything else follows from that rule.

This v7 plan is implementation-ready. Human developers and AI agents must use it as the build contract, not as a suggestion.
