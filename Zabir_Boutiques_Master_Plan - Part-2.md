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
CREATE UNIQUE INDEX idx_stock_reservations_order_active
  ON stock_reservations(order_id)
  WHERE status = 'active';
```

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

```txt
src/lib/contracts/
├── variant-inventory-do.ts      // VariantInventoryDO interface
├── budget-counter-do.ts         // BudgetCounterDO interface
├── email-provider.ts            // EmailProvider, SendEmailRequest, SendResponse
├── payment-provider.ts          // PaymentProvider (already exists in spec, formalized here)
├── ai-provider.ts               // AIProvider (already exists in spec, formalized here)
├── direct-checkout-session-do.ts // DirectCheckoutSessionDO interface
├── cart-do.ts                   // CartDO interface
├── idempotency-do.ts            // IdempotencyDO interface
├── provider-health-do.ts        // ProviderHealthDO interface
└── index.ts                     // re-exports all of the above
```

### 36.2 `variant-inventory-do.ts`

```ts
// src/lib/contracts/variant-inventory-do.ts

/**
 * VariantInventoryDO contract — Section 11.3 / 12.2 / 15.1.
 *
 * One Durable Object instance per variant (object ID: `variant:{variant_id}`).
 * Serializes all stock mutations for that variant so reservations, releases,
 * confirms, direct sales, and reversals are atomic.
 *
 * Implementation MUST `implements VariantInventoryDO` — this is the
 * compiler-enforced contract. Any deviation is a PR block.
 */
export interface VariantInventoryDO {
  /**
   * Reserve stock for an online checkout.
   * Returns a reservation_id that must be released on any downstream failure.
   */
  reserve(input: {
    variant_id: string;
    quantity: number;
    checkout_id: string;
  }): Promise<
    | { reservation_id: string }
    | { error: 'INSUFFICIENT_STOCK'; available: number }
  >;

  /**
   * Release a previously-held reservation.
   * Idempotent: releasing an already-released reservation returns { released: true, already_released: true }.
   * The `already_released` flag lets callers distinguish a fresh release from a no-op replay.
   */
  release(input: {
    reservation_id: string;
    reason: string; // 'd1_write_failed' | 'payment_timeout' | 'cleanup_cron_expired' | ...
  }): Promise<{ released: boolean; already_released?: boolean }>;

  /**
   * Confirm a reservation as sold (move reserved → sold).
   * Called after D1 order write succeeds.
   */
  confirm(input: {
    reservation_id: string;
    order_id: string;
  }): Promise<
    | { confirmed: true }
    | { error: 'RESERVATION_NOT_FOUND' | 'ALREADY_CONFIRMED' }
  >;

  /**
   * Atomic direct sale for POS. Bypasses the reservation lifecycle because
   * counter sales are immediately paid.
   *
   * Failure handling per Section 11.3:
   *   - If this returns `success: true` but the subsequent D1 invoice write
   *     fails, the POS flow MUST call `reverseDirectSale` immediately.
   */
  directSale(input: {
    variant_id: string;
    quantity: number;
    invoice_id: string;
    staff_id: string;
    channel: 'pos';
  }): Promise<
    | { success: true }
    | { error: 'INSUFFICIENT_STOCK'; available: number }
    | { error: 'CONFLICT'; message: string }
  >;

  /**
   * Compensating transaction for POS failures (Section 11.3 / 15.1).
   *
   * Restores `quantity` units to available stock for the given `invoice_id`,
   * records a `stock_adjustments` row with `reason = 'pos_reversal'`,
   * and emits a P1 audit event. This is the ONLY way to undo a `directSale`.
   *
   * Idempotent on `invoice_id + variant_id + quantity`: a second call with
   * the same triple returns the original `audit_event_id` without re-applying.
   */
  reverseDirectSale(input: {
    variant_id: string;
    quantity: number;
    invoice_id: string;
    reason: string; // 'd1_invoice_write_failed' | 'same_day_void' | ...
  }): Promise<
    | { reversed: true; audit_event_id: string }
    | { reversed: false; audit_event_id: string; message: 'already_reversed' }
  >;

  /**
   * Current availability for the variant. Used by the live stock API and
   * by staff dashboards.
   */
  getAvailability(input: {
    variant_id: string;
  }): Promise<{
    stock: number;
    reserved: number;
    sold: number;
    available: number; // = stock - reserved - sold
  }>;
}

/**
 * The Durable Object class also exposes the standard DurableObject method.
 * Implementations extend DurableObject and implement VariantInventoryDO.
 */
export type VariantInventoryDOClass = new (state: DurableObjectState, env: Env) =>
  DurableObject & VariantInventoryDO;
```

### 36.3 `budget-counter-do.ts`

```ts
// src/lib/contracts/budget-counter-do.ts

/**
 * BudgetCounterDO contract — Section 24.2.
 *
 * One Durable Object instance per (provider, period). Object ID format:
 *   `budget:{provider}:{YYYY-MM-DD}` for daily counters
 *   `budget:{provider}:{YYYY-MM}` for monthly counters
 *
 * Config is read from D1 `ai_budget_limits` on first call per period and
 * cached in-DO for the lifetime of that period.
 *
 * Canonical limits (launch):
 *   - DeepSeek: $5.00/day USD, $100/month USD, soft alert 80%, hard block 100%
 *   - Workers AI: $1.00/day USD, $20/month USD (Cloudflare account also enforces)
 *
 * Fallback behavior: if this DO times out, callers MUST fall back to
 * Workers AI (safe path) — see Section 24.2.
 */
export interface BudgetCounterDO {
  /**
   * Record actual usage after a successful AI/image-API call.
   *
   * Idempotent on (provider, request_id): a duplicate call with the same
   * request_id returns the prior `new_daily_total_usd` without re-counting.
   *
   * Updates the in-DO counter AND writes a row to `ai_generation_log`.
   * Throws only on D1 write failure (not on duplicate request_id).
   *
   * Provider universe is consistent across recordUsage/canUse/getUsage:
   * 'workers_ai' | 'deepseek' | 'imagify'. (Earlier draft had Imagify only
   * in getUsage — that inconsistency is now resolved.)
   */
  recordUsage(input: {
    provider: 'workers_ai' | 'deepseek' | 'imagify';
    tokens: number;
    cost_usd: number; // dollars, float (only place floats are allowed — see Guardrail #5)
    request_id: string; // idempotency key
    staff_id: string;
    operation: string; // 'product_description' | 'alt_text' | 'embedding' | 'image_optimize' | ...
  }): Promise<{
    recorded: boolean; // false if duplicate request_id (no-op)
    new_daily_total_usd: number;
    new_monthly_total_usd: number;
    soft_alert_triggered: boolean;
    hard_block_reached: boolean;
  }>;

  /**
   * Check whether a DeepSeek call may proceed.
   *
   * Reads config from D1 `ai_budget_limits` on first call per period,
   * then caches in-DO. Returns false if the daily USD budget is exhausted
   * (or would be exhausted by a typical call — conservative check).
   *
   * IMPORTANT: callers MUST handle a thrown error (DO timeout) by falling
   * back to Workers AI — never by blocking the staff action. See Section 24.2.
   */
  canUseDeepSeek(): Promise<boolean>;

  /**
   * Equivalent for Workers AI. Less commonly used on the hot path because
   * Workers AI has platform-level enforcement, but exposed for completeness.
   */
  canUseWorkersAI(): Promise<boolean>;

  /**
   * Equivalent for Imagify (image optimization budget). Used by the
   * image-processing queue consumer before calling the Imagify adapter.
   */
  canUseImagify(): Promise<boolean>;

  /**
   * Read-only snapshot of the current counter state. Used by the staff
   * dashboard AI budget widget.
   */
  getUsage(input: {
    provider: 'workers_ai' | 'deepseek' | 'imagify';
    period: 'daily' | 'monthly';
  }): Promise<{
    spent_usd: number;
    limit_usd: number;
    percent_used: number; // 0-100, rounded to 1 decimal
    soft_alert_triggered: boolean;
    hard_block_reached: boolean;
    owner_override_active: boolean;
  }>;
}

export type BudgetCounterDOClass = new (state: DurableObjectState, env: Env) =>
  DurableObject & BudgetCounterDO;
```

### 36.4 `email-provider.ts`

```ts
// src/lib/contracts/email-provider.ts

/**
 * EmailProvider contract — Section 17.1.
 *
 * Mirrors the PaymentProvider pattern (Section 2.6). Every email adapter
 * (resend, cloudflare_email) MUST `implements EmailProvider`.
 *
 * Provider selection is via the `EMAIL_PROVIDER` environment variable,
 * resolved in `src/lib/integrations/email/index.ts`.
 */

export interface SendEmailRequest {
  /** RFC 5322 recipients. At least one required. */
  to: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string;

  /** Sender display name. From-address is provider-bound (configured per provider). */
  from_name: string;

  subject: string;

  /** Rendered HTML body. Templates are rendered before calling the adapter. */
  html: string;

  /** Optional plain-text fallback. If omitted, providers typically derive from HTML. */
  text?: string;

  /** Provider-side categorization tags (e.g. 'order', 'abandoned_cart', 'password_reset'). */
  tags?: string[];

  /** Provider-specific metadata. Used for provider-side routing/tracking. */
  custom_args?: Record<string, string>;

  /**
   * Internal idempotency key. Written to `email_log.message_id`.
   * Adapters SHOULD use this as the provider-side message id where supported,
   * or pass it via custom_args so duplicate sends can be detected.
   */
  message_id: string;
}

export interface SendResponse {
  accepted: boolean;
  provider_message_id?: string;
  provider: 'resend' | 'cloudflare_email';
  status: 'sent' | 'queued' | 'failed';
  error_code?: string;
  error_message?: string; // redacted, no PII
}

export interface EmailProvider {
  /**
   * Send an email. Implementations:
   *   - MUST go through ProviderHealthDO (circuit breaker) before the HTTP call.
   *   - MUST write a row to api_audit_logs with provider='email', operation='send_email'.
   *   - MUST redact PII from any logged request/response summary.
   *   - MUST respect the configured timeout (10s default per Section 2.4).
   *   - MUST be idempotent on request.message_id where the provider supports it.
   */
  sendEmail(request: SendEmailRequest): Promise<SendResponse>;
}

/**
 * Factory type. The actual factory is in `src/lib/integrations/email/index.ts`
 * and reads `env.EMAIL_PROVIDER` to pick the implementation.
 */
export type EmailProviderFactory = (env: Env) => EmailProvider;
```

### 36.5 `direct-checkout-session-do.ts`

```ts
// src/lib/contracts/direct-checkout-session-do.ts

/**
 * DirectCheckoutSessionDO contract — Section 10.6.
 *
 * One Durable Object instance per Buy Now session (object ID: `buy:{session_id}`).
 *
 * Cart isolation contract (mandatory):
 *   - DirectCheckoutSessionDO has ZERO interaction with CartDO.
 *   - The session_id values are NEVER reused in the cart: namespace.
 *   - On successful order creation, the DO is deleted immediately.
 */

export interface DirectCheckoutSessionState {
  session_id: string;
  product_id: string;
  variant_id: string;
  quantity: number;
  selected_options: Record<string, string>;
  created_at: string; // ISO 8601
  expires_at: string; // ISO 8601, created_at + 30 minutes
  landing_version: string;
  source_page: string;
  utm_params?: Record<string, string>;
  form_draft?: Record<string, string>;
  origin: string; // request Origin header at session creation
  user_agent_hash: string; // sha256(User-Agent)
  customer_session_link?: string; // optional, for analytics only
  order_id?: string; // set on successful order creation, triggers immediate delete
}

export interface DirectCheckoutSessionDO {
  /**
   * Create a new session. Generates session_id as HMAC(secret, timestamp + random).
   * Arms a 30-minute alarm. Captures Origin and User-Agent hash for fixation mitigation.
   */
  create(input: {
    product_id: string;
    variant_id: string;
    quantity: number;
    selected_options: Record<string, string>;
    source_page: string;
    utm_params?: Record<string, string>;
    origin: string;
    user_agent: string;
  }): Promise<{ session_id: string; expires_at: string }>;

  /**
   * Read the current session state. Verifies Origin and User-Agent hash.
   * Returns 'SESSION_NOT_FOUND' if the DO has been deleted (e.g. post-order or expired).
   */
  get(input: {
    session_id: string;
    origin: string;
    user_agent: string;
  }): Promise<
    | { state: DirectCheckoutSessionState }
    | { error: 'SESSION_NOT_FOUND' | 'SESSION_EXPIRED' | 'ORIGIN_MISMATCH' | 'USER_AGENT_MISMATCH' }
  >;

  /**
   * Update the form draft (customer is filling out the order form).
   * Verifies Origin and User-Agent hash.
   */
  updateFormDraft(input: {
    session_id: string;
    form_draft: Record<string, string>;
    origin: string;
    user_agent: string;
  }): Promise<{ updated: boolean } | { error: 'SESSION_NOT_FOUND' | 'ORIGIN_MISMATCH' | 'USER_AGENT_MISMATCH' }>;

  /**
   * Mark the session as converted (order created). Sets state.order_id and
   * IMMEDIATELY deletes all DO storage. The alarm is cancelled.
   * Verifies Origin and User-Agent hash.
   *
   * Return type is `Promise<{ deleted: true }>` (always true on success) — the
   * boolean is not optional because the prose contract says deletion is
   * immediate and unconditional on success. A failure to delete would throw
   * rather than return `deleted: false`.
   */
  markConvertedAndDelete(input: {
    session_id: string;
    order_id: string;
    origin: string;
    user_agent: string;
  }): Promise<
    | { deleted: true }
    | { error: 'SESSION_NOT_FOUND' | 'ORIGIN_MISMATCH' | 'USER_AGENT_MISMATCH' }
  >;

  /**
   * Alarm handler. Fires 30 minutes after create if not converted.
   * Calls deleteAll() and clears alarm metadata.
   */
  alarm(): Promise<void>;
}

export type DirectCheckoutSessionDOClass = new (state: DurableObjectState, env: Env) =>
  DurableObject & DirectCheckoutSessionDO;
```

### 36.6 `cart-do.ts`

```ts
// src/lib/contracts/cart-do.ts

/**
 * CartDO contract — Sections 9.1, 6.3.
 *
 * One Durable Object instance per cart session (object ID: `cart:{session_id}`).
 *
 * Alarm contract (mandatory, Section 6.3 / 9.1):
 *   - Every mutation arms setAlarm(now + 5 minutes) — debounced.
 *   - On alarm fire (no further mutations), upsert current state to D1 cart_activity.
 *   - 30-day inactivity alarm for full cleanup: final cart_activity write then deleteAll.
 */

export interface CartItem {
  variant_id: string;
  quantity: number;
  added_at: string;
  updated_at: string;
}

export interface CartState {
  session_id: string;
  items: CartItem[];
  last_updated_at: string;
  cart_version: number;
  coupon_code?: string;
  customer_contact?: { phone?: string; email?: string; name?: string };
}

export interface CartDO {
  addItem(input: {
    session_id: string;
    cart_version: number;
    variant_id: string;
    quantity: number;
    idempotency_key: string;
  }): Promise<{ state: CartState } | { error: 'CART_VERSION_CONFLICT'; state: CartState }>;

  removeItem(input: {
    session_id: string;
    cart_version: number;
    variant_id: string;
    idempotency_key: string;
  }): Promise<{ state: CartState } | { error: 'CART_VERSION_CONFLICT'; state: CartState }>;

  changeQuantity(input: {
    session_id: string;
    cart_version: number;
    variant_id: string;
    quantity: number;
    idempotency_key: string;
  }): Promise<{ state: CartState } | { error: 'CART_VERSION_CONFLICT'; state: CartState }>;

  clearCart(input: {
    session_id: string;
    cart_version: number;
    idempotency_key: string;
  }): Promise<{ state: CartState } | { error: 'CART_VERSION_CONFLICT'; state: CartState }>;

  getCart(input: { session_id: string }): Promise<{ state: CartState } | { error: 'CART_NOT_FOUND' }>;

  /**
   * Merge an anonymous cart into a logged-in customer's cart.
   * Used when a customer logs in mid-session.
   * Returns the merged state, or a conflict if the target cart version
   * has moved on since the merge was initiated (caller should retry).
   */
  mergeCart(input: {
    source_session_id: string;
    target_session_id: string;
    target_cart_version: number;
  }): Promise<
    | { state: CartState }
    | { error: 'CART_VERSION_CONFLICT'; state: CartState }
  >;

  /**
   * Alarm handler. Two stages:
   *   - 5-min inactivity: upsert D1 cart_activity, re-arm if more mutations arrive.
   *   - 30-day inactivity: final cart_activity write, deleteAll.
   */
  alarm(): Promise<void>;
}

export type CartDOClass = new (state: DurableObjectState, env: Env) =>
  DurableObject & CartDO;
```

### 36.7 `provider-health-do.ts`

```ts
// src/lib/contracts/provider-health-do.ts

/**
 * ProviderHealthDO contract — Sections 2.4, 11.2 (FraudBD circuit breaker spec).
 *
 * One Durable Object instance per external provider (object ID: `provider:{name}`).
 *
 * Persists circuit breaker state transitions to api_audit_logs.
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface ProviderHealthDO {
  /**
   * Called before every external API request.
   * Returns 'closed' → proceed. 'open' → use fallback. 'half_open' → proceed
   * but treat the next result as a probe (success closes, failure re-opens).
   */
  checkCircuit(input: { provider: string }): Promise<{
    state: CircuitState;
    open_until?: string; // ISO 8601, present when state='open'
  }>;

  /**
   * Called after every external API request.
   * Records success or failure, updates circuit state per the provider's rules.
   * For FraudBD: 5 failures / 60s → open for 5 minutes (Section 11.2).
   */
  recordResult(input: {
    provider: string;
    success: boolean;
    duration_ms: number;
    error_code?: string;
  }): Promise<{
    new_state: CircuitState;
    open_until?: string;
  }>;

  /**
   * Read-only snapshot for the staff dashboard provider health widget.
   */
  getState(input: { provider: string }): Promise<{
    state: CircuitState;
    failure_count_window: number; // failures in current window
    last_failure_at?: string;
    last_success_at?: string;
    open_until?: string;
  }>;

  /**
   * Alarm handler. Used to transition open → half_open after the open duration.
   */
  alarm(): Promise<void>;
}

export type ProviderHealthDOClass = new (state: DurableObjectState, env: Env) =>
  DurableObject & ProviderHealthDO;
```

### 36.8 `index.ts` (re-export barrel)

```ts
// src/lib/contracts/index.ts

export type {
  VariantInventoryDO,
  VariantInventoryDOClass,
} from './variant-inventory-do';

export type {
  BudgetCounterDO,
  BudgetCounterDOClass,
} from './budget-counter-do';

export type {
  EmailProvider,
  EmailProviderFactory,
  SendEmailRequest,
  SendResponse,
} from './email-provider';

export type {
  DirectCheckoutSessionDO,
  DirectCheckoutSessionDOClass,
  DirectCheckoutSessionState,
} from './direct-checkout-session-do';

export type {
  CartDO,
  CartDOClass,
  CartItem,
  CartState,
} from './cart-do';

export type {
  ProviderHealthDO,
  ProviderHealthDOClass,
  CircuitState,
} from './provider-health-do';
```

### 36.9 Implementation Compliance

Every concrete implementation MUST use `implements <InterfaceName>` so the TypeScript compiler enforces the contract. Example:

```ts
// src/durable-objects/variant-inventory-do.ts
import { DurableObject } from 'cloudflare:workers';
import type { VariantInventoryDO } from '@/lib/contracts';

export class VariantInventoryDOImpl extends DurableObject implements VariantInventoryDO {
  async reserve(input: { variant_id: string; quantity: number; checkout_id: string }) {
    // ...implementation...
  }

  async reverseDirectSale(input: {
    variant_id: string;
    quantity: number;
    invoice_id: string;
    reason: string;
  }) {
    // ...implementation per Section 11.3...
  }

  // ...all other methods from the interface...
}
```

A PR that introduces a DO class without `implements` (or that drifts from the interface signature) fails the TypeScript check and is blocked. The contracts directory is the single source of truth; prose in Sections 11.3, 17.1, 24.2, 10.6, 9.1 is the human-readable mirror.

---

## 37. FraudBD Circuit Breaker Test Fixtures

Section 11.2 specifies the FraudBD circuit breaker rules. This section defines the exact CI test matrix that proves the implementation conforms. Every test below is mandatory and must pass on every PR that touches the FraudBD adapter, `ProviderHealthDO`, or the checkout fraud-check path. Tests live in `tests/fraudbd-circuit-breaker/`.

### 37.1 Test Matrix

| Test ID | Scenario | Initial state | Action | Expected outcome | Guardrail |
|---|---|---|---|---|---|
| CB-01 | Single failure does not open circuit | closed | 1 failed call | state stays `closed` | 14 |
| CB-02 | 4 failures in 60s do not open circuit | closed | 4 failed calls within 60s | state stays `closed` | 14 |
| CB-03 | 5 failures in 60s open the circuit | closed | 5 failed calls within 60s | state transitions to `open` | 14 |
| CB-04 | 5 failures spread over >60s do not open | closed | 5 failed calls, each >60s apart | state stays `closed` | 14 |
| CB-05 | Open circuit returns fallback score 50 | open | checkout fraud check call | no HTTP call to FraudBD; checkout receives score=50; order created with `fraud_source='circuit_open_fallback'`, status `pending_review` | 14 |
| CB-06 | Open circuit enqueues fraud-audit message | open | checkout completes | `fraud-audit` queue receives a message with the order_id | 14 |
| CB-07 | Open circuit does not block checkout | open | checkout call timing | end-to-end checkout p99 < 800ms (no FraudBD HTTP wait) | 14, 33 |
| CB-08 | Open circuit auto-transitions to half_open after 5 minutes | open | advance simulated clock 5 min + 1 sec | next `checkCircuit` returns `half_open` | 14 |
| CB-09 | Half-open probe success closes circuit | half_open | 1 successful probe call | state transitions to `closed` | 14 |
| CB-10 | Half-open probe failure re-opens circuit | half_open | 1 failed probe call | state transitions to `open` for another 5 minutes | 14 |
| CB-11 | Checkout has zero retries on FraudBD failure | closed | FraudBD returns 500 | adapter returns immediately; no retry; circuit records 1 failure | 14 |
| CB-12 | Checkout has zero retries on FraudBD timeout | closed | FraudBD times out at 1.5s | adapter returns immediately; no retry; circuit records 1 failure | 14 |
| CB-13 | fraud-audit queue has 1 retry with 2s backoff | open | queue consumer calls FraudBD; first call fails | consumer waits 2s, retries once; if retry fails, message goes to DLQ | 14 |
| CB-14 | fraud-audit queue uses 3s timeout | open | FraudBD slow to respond | adapter aborts at 3s; not 1.5s (checkout timeout does NOT apply to queue) | 14 |
| CB-15 | 4xx response is NOT a circuit failure | closed | FraudBD returns 422 | adapter returns the 422 to caller; circuit does NOT record a failure | 14 |
| CB-16 | 5xx response IS a circuit failure | closed | FraudBD returns 503 | adapter returns error; circuit records 1 failure | 14 |
| CB-17 | Invalid response schema IS a circuit failure | closed | FraudBD returns 200 with malformed body | schema validation fails; circuit records 1 failure | 14 |
| CB-18 | Empty response IS a circuit failure | closed | FraudBD returns 200 with empty body | circuit records 1 failure | 14 |
| CB-19 | Circuit state transition writes to api_audit_logs | closed → open | 5 failures in 60s | `api_audit_logs` has rows for each failure AND a row with `circuit_state='open'` for the transition | 24, 38 |
| CB-20 | Concurrent checkout requests see consistent circuit state | open | 10 concurrent checkout calls | all 10 receive fallback score=50; circuit state does not flap | 14 |
| CB-21 | P2 alert fires when circuit opens during checkout | closed → open | 5 failures in 60s | alerting system receives a P2 alert (`fraudbd_circuit_open`) | 14 |
| CB-22 | Fraud-audit queue downgrades pending_review to confirmed | open → closed (eventually) | queue consumer re-checks FraudBD after circuit closes; score is in the auto-approve range (0-40 per Section 11.2 scoring table) | order status transitions `pending_review` → `confirmed` | 14 |
| CB-23 | Fraud-audit queue escalates pending_review to cancelled | open → closed (eventually) | queue consumer re-checks FraudBD; score is in the reject range (71-100 per Section 11.2 scoring table) | order status transitions `pending_review` → `cancelled`; staff notified | 14 |
| CB-24 | Circuit state survives DO eviction | open | evict and rehydrate ProviderHealthDO | state on rehydration is `open` with original `open_until` timestamp | 13, 14 |
| CB-25 | Half-open probe is single-flight | half_open | 2 concurrent `checkCircuit` calls | only the first proceeds as a probe; the second sees `half_open` and uses fallback | 14 |

### 37.2 Test File Structure

```txt
tests/fraudbd-circuit-breaker/
├── fixtures/
│   ├── fraudbd-mock.ts          # Mock FraudBD HTTP server (uses undici's MockAgent)
│   ├── clock-mock.ts            # Controllable clock for time-based tests (CB-04, CB-08)
│   ├── do-storage-mock.ts       # In-memory DurableObjectStorage mock with eviction support (CB-24)
│   └── queue-mock.ts            # In-memory Cloudflare Queue mock (CB-06, CB-13)
├── cb-01-single-failure.test.ts
├── cb-02-four-failures.test.ts
├── cb-03-five-failures-opens.test.ts
├── cb-04-spread-failures.test.ts
├── cb-05-open-returns-fallback.test.ts
├── cb-06-open-enqueues-audit.test.ts
├── cb-07-open-does-not-block.test.ts
├── cb-08-open-to-half-open.test.ts
├── cb-09-half-open-success.test.ts
├── cb-10-half-open-failure.test.ts
├── cb-11-zero-retries-on-failure.test.ts
├── cb-12-zero-retries-on-timeout.test.ts
├── cb-13-queue-one-retry.test.ts
├── cb-14-queue-3s-timeout.test.ts
├── cb-15-4xx-not-a-failure.test.ts
├── cb-16-5xx-is-failure.test.ts
├── cb-17-invalid-schema-is-failure.test.ts
├── cb-18-empty-response-is-failure.test.ts
├── cb-19-state-transition-audited.test.ts
├── cb-20-concurrent-consistency.test.ts
├── cb-21-p2-alert-on-open.test.ts
├── cb-22-queue-downgrades.test.ts
├── cb-23-queue-escalates.test.ts
├── cb-24-state-survives-eviction.test.ts
├── cb-25-half-open-single-flight.test.ts
└── README.md                    # Explains how to run the suite locally
```

### 37.3 Sample Test Implementations

Three representative tests are stubbed below to anchor the implementation pattern. All 25 tests follow this shape.

#### CB-03 — Five failures in 60s opens the circuit

```ts
// tests/fraudbd-circuit-breaker/cb-03-five-failures-opens.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { FraudBdMock } from './fixtures/fraudbd-mock';
import { ProviderHealthDOImpl } from '@/durable-objects/provider-health-do';
import { EnvMock } from './fixtures/env-mock';

describe('CB-03: 5 failures in 60s opens the circuit', () => {
  let fraudbd: FraudBdMock;
  let health: ProviderHealthDOImpl;
  let env: EnvMock;

  beforeEach(() => {
    fraudbd = new FraudBdMock();
    fraudbd.setResponseSequence([
      { status: 503 }, // failure 1
      { status: 503 }, // failure 2
      { status: 503 }, // failure 3
      { status: 503 }, // failure 4
      { status: 503 }, // failure 5 → opens
    ]);
    env = new EnvMock({ fraudbd });
    health = new ProviderHealthDOImpl(env.stub('provider:fraudbd'));
  });

  it('transitions to open after the 5th failure within 60s', async () => {
    // Drive 5 failed FraudBD calls within the failure window.
    for (let i = 0; i < 5; i++) {
      const result = await env.callFraudBd({ order_id: `order_${i}` });
      expect(result.ok).toBe(false);
    }

    const state = await health.getState({ provider: 'fraudbd' });
    expect(state.state).toBe('open');
    expect(state.failure_count_window).toBe(5);
    expect(state.open_until).toBeDefined();

    // open_until should be ~5 minutes from now.
    const openUntilMs = Date.parse(state.open_until!);
    const delta = openUntilMs - Date.now();
    expect(delta).toBeGreaterThan(4 * 60 * 1000); // > 4 min
    expect(delta).toBeLessThan(6 * 60 * 1000);    // < 6 min
  });

  it('writes a circuit_state=open row to api_audit_logs on transition', async () => {
    for (let i = 0; i < 5; i++) {
      await env.callFraudBd({ order_id: `order_${i}` });
    }

    const auditRows = await env.d1.query(
      `SELECT * FROM api_audit_logs WHERE provider = 'fraudbd' AND circuit_state = 'open'`
    );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].operation).toBe('circuit_transition');
  });
});
```

#### CB-05 — Open circuit returns fallback score 50

```ts
// tests/fraudbd-circuit-breaker/cb-05-open-returns-fallback.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { FraudBdMock } from './fixtures/fraudbd-mock';
import { EnvMock } from './fixtures/env-mock';

describe('CB-05: Open circuit returns fallback score 50', () => {
  let fraudbd: FraudBdMock;
  let env: EnvMock;

  beforeEach(async () => {
    fraudbd = new FraudBdMock();
    // Pre-open the circuit by driving 5 failures.
    fraudbd.setResponseSequence(Array(5).fill({ status: 503 }));
    env = new EnvMock({ fraudbd });
    for (let i = 0; i < 5; i++) {
      await env.callFraudBd({ order_id: `warmup_${i}` });
    }
    // Reset to a "would succeed" response so we can prove the fallback is used
    // instead of an actual HTTP call.
    fraudbd.setResponseSequence([{ status: 200, body: { score: 10 } }]);
  });

  it('returns score=50 without calling FraudBD when circuit is open', async () => {
    const result = await env.runCheckout({ order_id: 'order_test' });

    expect(result.order.status).toBe('pending_review');
    expect(result.order.fraud_score).toBe(50);
    expect(result.order.fraud_source).toBe('circuit_open_fallback');

    // No HTTP call should have been made.
    expect(fraudbd.callCount).toBe(0);
  });

  it('enqueues a fraud-audit message for later re-check', async () => {
    await env.runCheckout({ order_id: 'order_test' });

    const queueMessages = env.queueMock('fraud-audit').messages;
    expect(queueMessages.length).toBe(1);
    expect(queueMessages[0].body.order_id).toBe('order_test');
    expect(queueMessages[0].body.reason).toBe('circuit_open_fallback');
  });
});
```

#### CB-11 — Zero retries on FraudBD failure during checkout

```ts
// tests/fraudbd-circuit-breaker/cb-11-zero-retries-on-failure.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { FraudBdMock } from './fixtures/fraudbd-mock';
import { EnvMock } from './fixtures/env-mock';

describe('CB-11: Checkout has zero retries on FraudBD failure', () => {
  let fraudbd: FraudBdMock;
  let env: EnvMock;

  beforeEach(() => {
    fraudbd = new FraudBdMock();
    fraudbd.setResponseSequence([{ status: 503 }]); // single failure
    env = new EnvMock({ fraudbd });
  });

  it('does not retry the FraudBD call during checkout', async () => {
    await env.runCheckout({ order_id: 'order_test' });

    // Exactly one HTTP call — no retry.
    expect(fraudbd.callCount).toBe(1);
  });

  it('records exactly one failure in the circuit breaker', async () => {
    await env.runCheckout({ order_id: 'order_test' });

    const state = await env.providerHealth.getState({ provider: 'fraudbd' });
    expect(state.failure_count_window).toBe(1);
    expect(state.state).toBe('closed'); // 1 failure < 5 threshold
  });

  it('checkout proceeds with pending_review when fraud check fails (circuit still closed)', async () => {
    const result = await env.runCheckout({ order_id: 'order_test' });
    // Circuit is closed (1 failure < 5 threshold) but the FraudBD call failed.
    // Per Section 11.1 step 12: "If unavailable, allow only with pending_review flag".
    // The fraud_source distinguishes this from the circuit-open fallback path.
    expect(result.order.status).toBe('pending_review');
    expect(result.order.fraud_score).toBe(50); // neutral default when no score is available
    expect(result.order.fraud_source).toBe('fraud_check_failed');
    // NOT 'circuit_open_fallback' — that source is reserved for when the circuit is OPEN.
  });
});
```

### 37.4 CI Integration

The 25-test suite runs in CI on every PR and on every release branch. The CI job is `fraudbd-circuit-breaker-tests.yml`:

```yaml
# .github/workflows/fraudbd-circuit-breaker-tests.yml
name: FraudBD Circuit Breaker Tests
on:
  pull_request:
    paths:
      - 'src/lib/integrations/fraudbd/**'
      - 'src/durable-objects/provider-health-do.ts'
      - 'src/lib/checkout/fraud-check.ts'
      - 'src/lib/contracts/**'              # contract changes can break the test expectations
      - 'tests/fraudbd-circuit-breaker/**'
  push:
    branches: [main, release/*]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx vitest run tests/fraudbd-circuit-breaker/
        env:
          NODE_ENV: test
      - name: Upload coverage
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: fraudbd-cb-coverage
          path: coverage/fraudbd-circuit-breaker/
```

A failing test blocks the PR. The Release Captain cannot override this gate; a waiver from the ARB (Section 34.7) is the only path to ship with a failing FraudBD test.

### 37.5 Coverage Target

The 25 tests must collectively achieve:

- **100% line coverage** of `src/lib/integrations/fraudbd/` (the adapter).
- **100% line coverage** of the `checkCircuit`, `recordResult`, and `alarm` methods of `ProviderHealthDO`.
- **100% branch coverage** of the `state === 'open'` fallback path in `src/lib/checkout/fraud-check.ts`.
- **≥ 95% line coverage** of `src/lib/contracts/provider-health-do.ts` (the contract stub).

Coverage is enforced by the CI job; a drop below these targets fails the build.

### 37.6 Test Data Hygiene

- Tests MUST NOT make real HTTP calls. All external calls go through `FraudBdMock`.
- Tests MUST NOT touch real D1. All D1 access goes through `EnvMock.d1` (in-memory).
- Tests MUST NOT depend on wall-clock time. All time-based logic uses `ClockMock` (CB-04, CB-08).
- Tests MUST clean up between cases — `beforeEach` resets all mocks.
- Tests MUST run in any timezone. All timestamps are UTC ISO 8601 strings.

A test that violates these hygiene rules is a P2 finding and is disabled until fixed.

---

## 38. In-Flight PR Audit Playbook

When the V7 plan lands, the team almost certainly has in-flight PRs that pre-date the new rules. This section is the playbook for auditing those PRs before merge so they don't reintroduce contradictions. It is also the playbook for periodic drift audits (weekly per Section 34.2) to catch silent drift in the main branch.

### 38.1 Audit Triggers

Run the audit when any of the following is true:

1. The V7 Master Plan was just merged — audit every open PR.
2. A new guardrail was added or amended (Section 34.8) — audit every open PR in the affected cluster.
3. Weekly drift audit (Section 34.2) — audit the main branch.
4. Pre-release audit (Section 34.4) — audit the release branch.
5. Ad-hoc: a GO requests an audit of a specific PR or service.

### 38.2 Drift Findings Catalog

The findings below are the known drift patterns. Each has a stable finding code (`D-NN`) for tracking in `docs/audit/`. New drift patterns discovered in the wild are added here with a new code.

| Code | Finding | Detection method | Fix |
|---|---|---|---|
| D-01 | `output: 'static'` in `astro.config.mjs`, docs, or generated notes | `rg "output:\s*'(static\|hybrid)'" --glob '!**/*.md' -t ts -t tsx -t js -t mjs` (excludes the master plan and docs/ — the plan's own FORBIDDEN references are documentation, not drift) | Replace with `output: 'server'`. Delete any prose justifying `static` (it's wrong post-V7). |
| D-02 | `export const prerender = false` in any route file | `rg "prerender\s*=\s*false" src/pages/` | Delete the line. Dynamic routes are dynamic by default under `output: 'server'`. |
| D-03 | Static route missing `export const prerender = true` | AST scan of `src/pages/**/*.{astro,ts}` cross-referenced with Section 3.4 | Add the export at the top of the file. |
| D-04 | Reference to `abandoned_1h_sent_at` or `abandoned_24h_sent_at` in code or migration | `rg "abandoned_1h_sent_at\|abandoned_24h_sent_at"` | Replace with `abandoned_email_sent_at` (single 24h touch). Add a forward migration to drop the old columns if they exist in production. |
| D-05 | CartDO mutation that does NOT arm the 5-minute alarm | Code review of `src/durable-objects/cart-do.ts` — every mutation method must call `setAlarm(now + 5*60*1000)` | Add the alarm call. Add a unit test asserting the alarm is armed. |
| D-06 | CartDO synchronous D1 write inside a mutation method | `rg "env.DB.prepare.*cart_activity" src/durable-objects/cart-do.ts` (mutation methods only) | Replace with a `cart-activity` queue message. The D1 write belongs in the alarm handler or queue consumer. |
| D-07 | `VariantInventoryDO` class missing `reverseDirectSale` method | `rg "class VariantInventoryDO" -A 50 src/durable-objects/` and check for method | Add the method per Section 11.3 / 36.2. Add the `implements VariantInventoryDO` keyword. |
| D-08 | POS flow that does NOT call `reverseDirectSale` on D1 invoice write failure | Code review of `src/api/staff/invoices/create.ts` (or equivalent) | Add the compensating transaction call + P1 audit log per Section 11.3 / 15.1. Add the integration test `pos-compensating-transaction.test.ts`. |
| D-09 | Direct `fetch()` to FraudBD outside the adapter | `rg "fetch\(.*fraudbd" --type ts -g '!src/lib/integrations/fraudbd/**'` | Move the call into `src/lib/integrations/fraudbd/client.ts`. Route handlers go through the adapter. |
| D-10 | FraudBD checkout call with retry logic | `rg "retry" src/lib/checkout/fraud-check.ts` | Delete the retry loop. Checkout = 0 retries per Section 11.2 / Guardrail #14. |
| D-11 | FraudBD checkout timeout ≠ 1.5s | `rg "AbortController\|setTimeout.*1500\|setTimeout.*1.5" src/lib/integrations/fraudbd/client.ts` | Set timeout to exactly 1500ms. |
| D-12 | FraudBD queue timeout ≠ 3s | Same as D-11 but for the fraud-audit queue consumer | Set timeout to 3000ms. |
| D-13 | `EMAIL_PROVIDER` env var not used to select adapter | `rg "process.env.EMAIL_PROVIDER\\|env.EMAIL_PROVIDER" src/lib/integrations/email/index.ts` AND manual review confirming the factory branches on this env var | Implement the factory per Section 17.1 / 36.4. The factory MUST read `env.EMAIL_PROVIDER` and return the matching adapter — a file that exists and mentions `EmailProvider` but does not branch on the env var is non-conformant. |
| D-14 | Email adapter that doesn't `implements EmailProvider` | `rg "class.*Adapter" src/lib/integrations/email/` | Add `implements EmailProvider` and ensure method signature matches. |
| D-15 | `BudgetCounterDO` class missing `canUseDeepSeek` or `recordUsage` | `rg "class BudgetCounterDO" -A 30 src/durable-objects/` | Add both methods per Section 24.2 / 36.3. |
| D-16 | DeepSeek call that doesn't pre-flight `canUseDeepSeek()` | `rg "deepseek.*generate" src/lib/ai/` and trace callers | Add the pre-flight check. If `false`, return 429 with "Budget limit reached". |
| D-17 | `DirectCheckoutSessionDO` missing Origin or User-Agent verification | Code review of `get`, `updateFormDraft`, `markConvertedAndDelete` | Add the verification per Section 10.6 / 36.5. Return 403 on mismatch. |
| D-18 | `DirectCheckoutSessionDO` not deleted after order creation | Code review of the checkout flow | Call `markConvertedAndDelete` immediately after D1 order write succeeds. |
| D-19 | Checkout Step 8 missing VAT computation | Code review of `src/lib/checkout/compute-totals.ts` (or equivalent) | Add `vat_paisa = round(subtotal_paisa * vat_rate / 100)` with `vat_rate` from `VAT_RATE_PERCENT`. |
| D-20 | Browser-supplied VAT accepted | `rg "vat" src/pages/checkout*` and check request parsing | Strip VAT from any client-supplied data; always recompute server-side. |
| D-21 | Reservation cleanup cron schedule ≠ hourly | `wrangler.toml` cron config | Set `crons = ["0 * * * *"]` for the reservation-cleanup worker. |
| D-22 | Reservation cleanup query ≠ 15-min window | Code review of the cron handler | Use `created_at < datetime('now', '-15 minutes') AND release_requested_at IS NULL`. |
| D-23 | `stock_reservations` missing the `idx_stock_reservations_order_active` partial unique index | D1 `PRAGMA index_list('stock_reservations')` | Apply migration 0027 per Section 35.2. |
| D-24 | `stock_reservations` missing `release_requested_at` column | D1 schema introspection | Apply migration 0027 per Section 35.2. |
| D-25 | Missing `otp_secrets`, `api_audit_logs`, or `ai_budget_limits` table | D1 schema introspection | Apply migration 0024 / 0025 / 0026 per Section 35.2. |
| D-26 | `cart-activity` queue not wired up | `wrangler.toml` queues config | Add the queue binding. Confirm `CartDO` publishes to it on every mutation. |
| D-27 | Abandoned cart cron query missing `customer_email` dedup | Code review of `src/cron/abandoned-cart.ts` | Add the `ROW_NUMBER() OVER (PARTITION BY customer_email)` window per Section 17.3. |
| D-28 | Abandoned cart cron missing `consent_status = 'allowed'` filter | Same as D-27 | Add the consent filter. Never send marketing email without consent. |
| D-29 | Money stored as REAL/FLOAT outside AI cost | SQL-side: `rg "(price\|cost\|subtotal\|total\|delivery\|discount\|advance\|balance\|refund\|vat).*\\b(REAL\|FLOAT\|DOUBLE)\\b" migrations/`. TS-side: `rg ":(number\|float).*(_paisa\|_amount\|price\|cost\|subtotal\|total\|delivery\|discount\|advance\|balance\|refund\|vat)" src/` excluding `cost_usd` in BudgetCounterDO (the documented float exception) | Convert to integer paisa. The only float money is `cost_usd` in `BudgetCounterDO.recordUsage()`. The broadened regex catches columns/types without the `_paisa` suffix that earlier drafts missed. |
| D-30 | PII in structured logs | Log scan over staging for the last 7 days | Add PII redaction at the log sink. Treat as P2 finding. |
| D-31 | Webhook handler missing HMAC verification | `rg "webhook" src/api/payments/` and check each handler | Add `verifyHmac()` call before any processing. |
| D-32 | Staff route missing Zero Trust or RBAC middleware | Cloudflare Access config audit + `rg "export (async )?function (GET\|POST\|...)" src/pages/staff/` | Add Zero Trust on the Cloudflare side; add RBAC middleware in the route handler. |
| D-33 | External API call without going through a provider adapter | `rg "fetch\('https://" src/` excluding `src/lib/integrations/**` | Move the call into a provider adapter per Section 2.3. |
| D-34 | AI call sending PII to the provider | Code review of AI prompts — search for customer name, phone, address in prompt templates | Strip PII from prompts. Log the violation as a P1 finding. |
| D-35 | Migration without a rollback file | `ls migrations/` and `ls migrations/rollback/` — every `NNNN_*.sql` needs a matching `rollback/NNNN_*.rollback.sql` | Write the rollback file. Block the PR until it exists. |

### 38.3 Audit Execution Procedure

| Step | Action | Tool |
|---|---|---|
| 1. Scope | Identify the PRs or branches to audit. For weekly drift, audit `main`. For pre-release, audit the release branch. For V7 landing, audit all open PRs. | Git |
| 2. Automated scan | Run the `audit-drift.ts` script (in `scripts/audit/`) that executes every detection method in the table above. Output is JSON. | Node script |
| 3. Manual review | The GO for each affected cluster reviews the automated findings and adds any manual findings (e.g. D-08, D-17 which require code review). | GO |
| 4. Triage | Each finding is assigned a severity: P0 (blocks merge), P1 (fix before next release), P2 (fix in normal workflow), P3 (informational). | GO + RC |
| 5. Report | Generate `docs/audit/drift-{YYYY-MM-DD}-{scope}.md` with the findings table, severities, and assignees. | RC |
| 6. Fix loop | Each finding becomes a ticket. The ticket references the finding code (e.g. `D-04`) so trend analysis is possible. Findings of the same code in subsequent audits indicate the fix didn't stick and trigger an ARB review. | Engineering team |
| 7. Trend | The monthly ARB review (Section 34.2) looks at finding-code frequency. A finding code appearing > 3 times in a quarter triggers a CI check to automate its detection (turning it from manual into automated). | ARB |

### 38.4 The `audit-drift.ts` Script

The script is the workhorse of the audit. It lives at `scripts/audit/audit-drift.ts` and is invoked as `npx tsx scripts/audit/audit-drift.ts --scope {pr\|weekly\|release} --output docs/audit/drift-{date}.md`.

**Implementation completeness note:** the skeleton below shows the script structure with only 3 of the 35 checks filled in (D-01, D-02, D-04). The production script MUST implement all 35 checks from Section 38.2. A script that ships with only 3 checks silently skips 32 drift patterns — this is worse than not running the audit at all, because it gives false confidence. The CI gate in Section 38.5 MUST verify that the script's `checks` array has exactly 35 entries before allowing the job to pass; a script with fewer entries fails CI with the error `audit-drift.ts: expected 35 checks, found N`.

The script MUST also exclude the master plan document itself (and any markdown under `docs/`) from D-01 and D-02 detection, otherwise the plan's own "FORBIDDEN" references will trip the audit. The exclusion is `--glob '!**/*.md'` for D-01 and D-02 specifically (other checks scan only `src/` so are unaffected).

Skeleton:

```ts
// scripts/audit/audit-drift.ts
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

interface Finding {
  code: string;        // D-NN
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  file: string;
  line?: number;
  snippet: string;
  fix: string;         // link to Section 38.2 entry
}

const checks: Array<{
  code: string;
  severity: Finding['severity'];
  rgPattern: string;
  rgGlobs: string[];
  fix: string;
}> = [
  {
    code: 'D-01',
    severity: 'P0',
    rgPattern: "output:\\s*'(static|hybrid)'",
    // Exclude markdown (docs, master plan) so the plan's own FORBIDDEN references don't trip the audit.
    rgGlobs: ['--glob', '!**/*.md', '-t', 'ts', '-t', 'tsx', '-t', 'js', '-t', 'mjs'],
    fix: 'Replace with `output: \'server\'`. See Section 38.2 D-01.',
  },
  {
    code: 'D-02',
    severity: 'P1',
    rgPattern: 'prerender\\s*=\\s*false',
    // src/pages/ only — never matches docs. Markdown exclusion is belt-and-suspenders.
    rgGlobs: ['src/pages/', '--glob', '!**/*.md'],
    fix: 'Delete the line. See Section 38.2 D-02.',
  },
  {
    code: 'D-04',
    severity: 'P0',
    rgPattern: 'abandoned_1h_sent_at|abandoned_24h_sent_at',
    rgGlobs: ['-t', 'ts', '-t', 'sql', '-t', 'md'],
    fix: 'Replace with abandoned_email_sent_at. See Section 38.2 D-04.',
  },
  // ... all 35 checks ...
];

function runCheck(check: typeof checks[number]): Finding[] {
  const rgArgs = [
    check.rgPattern,
    ...check.rgGlobs,
    '--json',
    '--no-heading',
  ].join(' ');
  let raw: string;
  try {
    raw = execSync(`rg ${rgArgs}`, { encoding: 'utf-8' });
  } catch {
    return []; // rg exits non-zero on no matches
  }
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parsed = JSON.parse(line);
      return {
        code: check.code,
        severity: check.severity,
        file: parsed.data.path.text,
        line: parsed.data.line_number,
        snippet: parsed.data.lines.text.trim().slice(0, 200),
        fix: check.fix,
      };
    });
}

function main() {
  const scope = process.argv[2] ?? 'weekly';
  const date = new Date().toISOString().slice(0, 10);
  const outDir = resolve('docs/audit');
  mkdirSync(outDir, { recursive: true });

  // COMPLETENESS GATE: refuse to run if the checks array is not fully populated.
  // The skeleton above shows only 3 checks; the production script must have all 35.
  if (checks.length !== 35) {
    console.error(`audit-drift.ts: expected 35 checks, found ${checks.length}.`);
    console.error('Implement all checks from Section 38.2 before running this script.');
    process.exit(2);
  }

  const findings = checks.flatMap(runCheck);
  const bySeverity = {
    P0: findings.filter((f) => f.severity === 'P0'),
    P1: findings.filter((f) => f.severity === 'P1'),
    P2: findings.filter((f) => f.severity === 'P2'),
    P3: findings.filter((f) => f.severity === 'P3'),
  };

  const report = `# Drift Audit — ${date} — scope: ${scope}

- Total findings: ${findings.length}
- P0 (blocks merge): ${bySeverity.P0.length}
- P1 (fix before next release): ${bySeverity.P1.length}
- P2 (fix in normal workflow): ${bySeverity.P2.length}
- P3 (informational): ${bySeverity.P3.length}

## P0 findings

${bySeverity.P0.map((f) => `- [${f.code}] ${f.file}:${f.line ?? ''} — ${f.snippet}\n  - Fix: ${f.fix}`).join('\n') || '(none)'}

## P1 findings

${bySeverity.P1.map((f) => `- [${f.code}] ${f.file}:${f.line ?? ''} — ${f.snippet}\n  - Fix: ${f.fix}`).join('\n') || '(none)'}

## P2 findings

${bySeverity.P2.map((f) => `- [${f.code}] ${f.file}:${f.line ?? ''} — ${f.snippet}\n  - Fix: ${f.fix}`).join('\n') || '(none)'}

## P3 findings

${bySeverity.P3.map((f) => `- [${f.code}] ${f.file}:${f.line ?? ''} — ${f.snippet}\n  - Fix: ${f.fix}`).join('\n') || '(none)'}
`;

  const outPath = resolve(outDir, `drift-${date}-${scope}.md`);
  writeFileSync(outPath, report);
  console.log(`Drift audit written to ${outPath}`);
  console.log(`P0: ${bySeverity.P0.length}, P1: ${bySeverity.P1.length}, P2: ${bySeverity.P2.length}, P3: ${bySeverity.P3.length}`);

  // Exit non-zero if any P0 findings — blocks CI.
  if (bySeverity.P0.length > 0) process.exit(1);
}

main();
```

### 38.5 CI Integration

The drift script runs in CI on every PR (scope: `pr`) and nightly on `main` (scope: `weekly`). The PR-scope run is a merge gate; the nightly run produces a digest for the weekly ARB review.

```yaml
# .github/workflows/drift-audit.yml
name: Drift Audit
on:
  pull_request:
    paths:
      - '**'
  schedule:
    - cron: '0 2 * * *'  # nightly at 02:00 UTC
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - name: Run drift audit (PR scope)
        if: github.event_name == 'pull_request'
        run: npx tsx scripts/audit/audit-drift.ts pr docs/audit/drift-pr-${{ github.event.pull_request.number }}.md
      - name: Run drift audit (weekly scope)
        if: github.event_name == 'schedule'
        run: npx tsx scripts/audit/audit-drift.ts weekly docs/audit/drift-$(date -u +%Y-%m-%d)-weekly.md
      - name: Upload drift report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: drift-report
          path: docs/audit/drift-*.md
```

A P0 finding blocks the PR. A P1 finding produces a warning comment but does not block; the RC tracks it in the weekly digest. P2 and P3 findings are informational.

### 38.6 V7 Landing Audit (One-Time)

When the V7 plan is merged, a one-time comprehensive audit runs against the entire codebase. This audit is more thorough than the weekly drift audit and includes the manual-review findings (D-08, D-17, D-19, D-20, D-30, D-34) that the automated script cannot detect.

The V7 landing audit:

1. Runs the `audit-drift.ts` script with scope `v7-landing`.
2. Each GO manually reviews their cluster (Section 34.3) and adds manual findings.
3. The combined report is `docs/audit/drift-v7-landing-{date}.md`.
4. Every P0 finding must be fixed before any new feature work continues.
5. P1 findings are tracked as tickets with a 2-week fix SLA.
6. The ARB reviews the V7 landing audit at the next monthly review and proposes any guardrail amendments needed to catch the most common drift patterns going forward.

The V7 landing audit is the single most important execution step after the plan is merged. Skipping it means the plan is aspirational rather than binding.

---

