# Zabir Boutiques Master Plan V8 — Part-2

**Sections 26–38.** Companion to `Zabir_Boutiques_Master_Plan_V8_Part-1.md` (Sections 0–25).
Section 35 in this file is a summary; the authoritative migration specification is the standalone `V8_MIGRATION_PLAN.md`.



## 26. Environment Separation and CI/CD

### 26.1 Environments

| Property | Production | Staging | Development |
|---|---|---|---|
| Domain | `zabirboutiques.com` | `staging.zabirboutiques.com` | `dev.zabirboutiques.com` |
| D1 | `zabir-prod-db` | `zabir-staging-db` | `zabir-dev-db` |
| R2 | `zabir-product-images` | `zabir-product-images-staging` | `zabir-product-images-dev` |
| Image host (R2 custom domain) | `images.zabirboutiques.com` | `images-staging.zabirboutiques.com` | `images-dev.zabirboutiques.com` |
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

#### CI Credentials and Access (required by Section 34.4)

Checks #18 (log scan) and #19 (Zero Trust config audit) in Section 34.4 need access that V7 never provisioned, which made them unrunnable checks that nevertheless appeared in a CI table. The pipeline MUST provide:

| Capability | How | Scope |
|---|---|---|
| Staging log read | Cloudflare API token stored as a GitHub Actions secret `CF_LOGS_READ_TOKEN` | Read-only, staging account, Logs scope only |
| Zero Trust policy read | `CF_ACCESS_READ_TOKEN` | Read-only, Access: Apps and Policies: Read |
| D1 schema introspection | `CF_D1_READ_TOKEN` | Read-only, staging D1 only |

No CI token may hold write scope on production. A check whose token is missing FAILS — it MUST NOT silently pass.

### 26.3 Migration Rules

- Numbered SQL migrations, numbered against the **real repository state**. The repository head is `0039`; the next free number is `0040`.
- **One statement per migration file.** D1 migrations are not transactional, so a multi-statement file can half-apply and leave a state that the schema-diff script accepts but the code does not expect (M-04).
- SQLite/D1 syntax only.
- Every migration has a rollback file. No exceptions.
- Every migration has a pre-flight query that **returns zero rows when it is safe to apply**. `PRAGMA` output and human inspection are not pre-flight checks (M-03).
- Run staging first.
- 24-hour soak before production for any migration classified Medium or higher against a **non-empty** production database.
- Never edit an already-applied migration.

---

## 27. Disaster Recovery

### 27.1 Recovery Objectives

| Metric | Target |
|---|---:|
| RPO (D1) | **Near-zero, via D1 Time Travel** (point-in-time restore within a 30-day window, included at no extra cost) |
| RPO (Durable Object counters) | **1 hour** — the DO snapshot cron interval |
| RTO | 2 hours |
| D1 export to R2 | Every 6 hours (portable escape hatch and off-platform copy; Time Travel is the primary mechanism) |
| DO snapshot to R2 | **Hourly**, timestamp-aligned with the D1 export when they coincide |
| Backup retention | 30 daily, 12 monthly |
| Restore test | Weekly to staging, including DO/D1 parity assertion |

V7's 6-hour RPO was unnecessarily poor for a Cloudflare-native system (M-08). D1 Time Travel provides point-in-time recovery and is the primary D1 recovery mechanism; the R2 export remains as an off-platform copy.

### 27.2 Backup Flow

- **D1 Time Travel** is always on. The restore procedure targets a timestamp, not a dump file, whenever the incident is within the 30-day window.
- Cron triggers the D1 export worker every 6 hours; the export lands in R2 `zabir-backups`.
- **Durable Object snapshot cron (hourly, mandatory — RT-004).** A cron walks every active variant, calls `VariantInventoryDO.getAvailability()`, and writes a JSONL snapshot to R2 at `backups/do/{env}/{yyyy}/{mm}/{dd}/{timestamp}-variant-inventory.jsonl`, one line per variant: `{ variant_id, stock, reserved, sold, snapshot_id, captured_at }`. Restoring D1 without this leaves every DO holding counters from a later point in time — items show sold out that are in stock, and orphaned reservations have no D1 row so the cleanup cron can never find them. They would be locked forever.
- `BudgetCounterDO` and `ProviderHealthDO` state is **not** snapshotted: both are reconstructible (`ai_budget_limits` config plus a conservative zeroed counter; a closed circuit). `CartDO` and `IdempotencyDO` are **not** snapshotted: carts are recoverable by the customer and idempotency keys expire within 2 hours. This exclusion is deliberate and stated so nobody assumes a gap.
- Metadata includes timestamp, migration version (highest applied `_migrations` id), row counts, checksum, and the matching DO snapshot id.
- Weekly restore to staging validates the backup **and** the DO/D1 parity assertion.
- Alert on backup failure, on DO snapshot failure, and on any snapshot whose variant count differs from the D1 active-variant count by more than 1%.

### 27.3 Restore Procedure

**Restore in place. Do not create a new database.** V7 step 6 ("update bindings if database changed") requires a redeploy, which does not fit the 2-hour RTO.

1. Stop writes (Section 27.4) before anything else.
2. Identify the recovery point: a Time Travel timestamp if within 30 days, otherwise the latest valid R2 export.
3. Restore D1 **in place** — `wrangler d1 time-travel restore {db} --timestamp {ts}` for the Time Travel path, or import the dump into the existing database for the export path. Bindings do not change, so no redeploy is required.
4. Verify row counts and checksum against the backup metadata.
5. Run schema integrity tests and confirm the `_migrations` head matches the deployed code's expected migration.
6. **Restore Durable Object counters.** Select the DO snapshot whose `captured_at` is closest to, and not after, the D1 recovery point. For each line, call `VariantInventoryDO.restoreFromSnapshot({ stock, reserved, sold, snapshot_id })` with `DR_RESTORE_ENABLED=1`. Unset the flag immediately afterwards.
7. **Assert DO/D1 parity.** For every variant: `reserved` at the DO MUST equal `SUM(quantity)` of `stock_reservations` rows with `status = 'active'` in D1. Any variant that fails is listed in a repair report and fixed with `adjustStock({ reason: 'correction' })` under the two-person rule. Row counts alone are not a restore verification.
8. Purge caches (catalog pages are cache entries, not build artifacts — a purge is enough).
9. Smoke test product page, checkout, staff login, POS.
10. Monitor for 30 minutes; re-enable writes.

`dr-do-d1-parity.test.ts` runs this parity assertion against a restored staging environment every week. A restore drill that only checks row counts does not count as a drill.

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

- `/api/me/data` exports customer data after phone-OTP verification.
- `/api/me/data` deletion anonymizes PII while preserving order integrity.
- Deletion request processing window: 30 days.
- **Anonymization is sufficient because the audit log holds no raw PII (S-07).** `audit_log` entries store `customer_ref = HMAC(AUDIT_CUSTOMER_REF_SALT, normalized_phone)` plus the `order_id`, never a name, phone, or address. The log is append-only and retained 7 years (Section 28.2); if it held raw PII, the deletion right and the retention rule would be in direct conflict and the deletion promise would be undeliverable. Anonymizing the customer-facing rows therefore satisfies the request completely.
- The exact fields anonymized on deletion: `orders.customer_name`, `orders.customer_phone`, `orders.customer_email`, `orders.delivery_address`, `cart_activity.customer_*`, `direct_checkout_activity.customer_*`, `invoices.customer_name`, `invoices.customer_phone`. Money columns, quantities, and timestamps are preserved so the books still balance.
- Scope note: `/api/me/*` presumes an identity for the requester. Under **DECISION REQUIRED (D-01)** (Section 10.6) the platform is guest-only for now, so identity is proven by phone OTP against `orders.customer_phone` — not by a customer account.

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
| M4 Inventory | VariantInventoryDO (including `adjustStock()` — without it there is no way to load opening stock), reservation lifecycle, rollback, cleanup cron, goods receipt | P0 |
| M5 Staff v1 | Login, RBAC, order list/detail, confirm/cancel | P0 |

### Phase 2: Operations, Weeks 7-12

| Milestone | Features | Priority |
|---|---|---|
| M6 Security | WAF, Turnstile, Zero Trust, CSP, CSRF, rate limits | P0 |
| M7 Observability | Metrics, logs, alerts, PII scrubbing | P1 |
| M8 Search + SEO | D1 FTS5, autocomplete, JSON-LD, sitemap, robots | P1 |
| M9 Email | Provider adapter, order/status emails, abandoned cart flow, email_log | P1 |
| M10 Order Lifecycle | Returns, refunds, shipping labels, FraudBD, staff-assisted orders | P1 |
| M11 POS | Dedicated invoice ledger, `InvoiceCounterDO`, thermal receipt, POS history, void flow, cash-drawer close and Z-report | P1 |

### Phase 3: Growth and Hardening, Weeks 13-18

| Milestone | Features | Priority |
|---|---|---|
| M12 AI | Workers AI, DeepSeek fallback, BudgetCounterDO, moderation | P2 |
| M13 Performance | Cache API/SWR, image variants, Lighthouse CI, Bundlewatch | P2 |
| M14 Environment | dev/staging/prod separation, preview deploys, migration runner | P2 |
| M15 DR | D1 backups to R2, restore tests, incident playbooks | P2 |
| M16 Compliance | Data export/deletion, cookie consent, PCI SAQ A, accessibility audit | P2 |

### 29.4 ERP Readiness Classification

Reproduced verbatim from Section 8 of the accepted review. This is the authoritative scope statement behind the Section 1 claim correction. "Critical before launch" items are launch blockers and are already scheduled into M4, M10, and M11 above.

| Gap | Classification |
|---|---|
| **Stock receiving / opening stock** — no way to get inventory into the system (RT-003) | **Critical before launch** |
| **Stock adjustment with approval flow** — table exists, no method, no permission, no approver | **Critical before launch** |
| **Return restock path** (RT-003) | **Critical before launch** |
| **POS cash-drawer close / Z-report** (F-09) | **Critical before launch** |
| **Courier COD remittance tracking** — labels are generated (Section 16) but nothing records cash the courier collected and owes | **Critical before launch** |
| **Invoice immutability + sequential numbering guarantee** (RT-008) | **Critical before launch** |
| **VAT return / Mushak-compliant reporting** — BIN/TIN print on the receipt (15.3) but there is no VAT summary report, no output-VAT register, and no Mushak 6.3 field mapping | **Critical before launch** (legal exposure once VAT is switched on) |
| **Daily sales report** — 6.5 defines a `zabir-reports` bucket; no report is ever specified | **Critical before scaling** |
| **Cost of goods sold / inventory valuation** — no `cost_paisa` on variants, no FIFO/weighted-average method, so gross margin is uncomputable | **Critical before scaling** |
| **Purchase orders and supplier management** | **Critical before scaling** |
| **Supplier payables / aging** | **Critical before scaling** |
| **Payment/refund/COD finance reconciliation** (F-03) | **Critical before scaling** |
| **Staff performance reporting** — POS records `staff_id` but nothing aggregates it | **Critical before scaling** |
| **General ledger / double-entry accounting** | **Not required for boutique launch, but missing for the ERP claim** |
| **Audit-safe immutable financial ledger** (append-only journal with balancing entries) | **Not required for boutique launch, but missing for the ERP claim** |
| **Accounting export** (Tally / QuickBooks / CSV journal) | **Not required for boutique launch, but missing for the ERP claim** |
| **Multi-location / multi-warehouse** — `VariantInventoryDO` is keyed `variant:{variant_id}` with no location dimension; adding it later is a breaking DO key change | **Not required for boutique launch, but missing for the ERP claim** |
| **Batch / lot / serial tracking** | **Not required for boutique launch** (not typically needed for boutique apparel) |
| **Fixed assets, payroll, procurement approval chains** | **Not required for boutique launch, but missing for the ERP claim** |

**Landing in V8:** every "Critical before launch" row is closed by this revision — `adjustStock()` with the two-person rule (Section 11.3, 14.1), the return restock path (Section 13.2), the cash-drawer close and Z-report (Section 15.6), `courier_shipments` / `courier_cod_remittance` (Section 6.1), `InvoiceCounterDO` (Section 15.5), and the output-VAT register in the daily Z-report (Section 15.6). The Mushak 6.3 field mapping is documentation work owned by the Owner and the VAT consultant, not engineering, and it is tracked as a launch blocker in M11.

> **DECISION REQUIRED (D-05):** Add a Phase 4 finance module, or leave the "Critical before scaling" ERP items out of scope? — Options: **A)** Narrow the claim only. Section 1 now says "ecommerce, POS, and light-operations platform"; the "Critical before scaling" items stay unscheduled until the shop actually scales. **B)** Add Phase 4 (Weeks 19–26): COGS and inventory valuation (`product_variants.cost_paisa` plus a weighted-average method), purchase orders and supplier payables, daily sales and VAT reporting, and finance reconciliation.
> Blocking: nothing at launch. It blocks any statement that the platform is ERP-grade, and it blocks gross-margin reporting. V8 applies option A's wording change unconditionally because the claim was inaccurate either way; whether Phase 4 exists is the Owner's budget decision.

> **DECISION REQUIRED (D-06):** Should `VariantInventoryDO` be keyed `variant:{variant_id}:{location_id}` from day one? — Options: **A)** Keep `variant:{variant_id}`. Single location today; accept that adding locations later is a data migration across every Durable Object. **B)** Key it `variant:{variant_id}:{location_id}` now with `location_id = 'main'`, paying a small complexity cost today to avoid a breaking key-space migration later.
> Blocking: the DO object ID format in Section 6.6, and every call site. This is the one ERP gap that is expensive to defer, because changing a DO key later is a migration across the entire object space. V8 keeps option A and records the cost explicitly rather than discovering it later.

---

## 30. Absolute Guardrails

These rules are mandatory. Existing valid rules are preserved; rules that were underspecified have been clarified; new rules are appended at the end to close identified gaps.

**Enforcement:** Listing rules is not enough. Section 34 defines the operating protocol that keeps these guardrails alive at the stated team size of 2–4 engineers: four ownership clusters, the CI audit checklist (Section 34.4), the waiver process (Section 34.7), and the amendment process (Section 34.8). Every finding from `audit-drift.ts` is a PR blocker; the Owner reviews the CI dashboard monthly. Section 38 defines the drift audit playbook.

**V8 count:** 50 guardrails. Seven were added (44–50), each closing a P0 from the accepted review; no guardrail was retired, and every amended rule keeps its original number with an inline `> Amended V8:` marker.

1. Use `output: 'server'` with `@astrojs/cloudflare`; routes are dynamic by default. **`output: 'static'` is FORBIDDEN anywhere in the project.** Any file, README, or generated note that says `output: 'static'` or `output: 'hybrid'` must be corrected to `output: 'server'`.
2. Only the five static legal/info routes (`/about`, `/privacy`, `/terms`, `/return-policy`, `/size-guide`) opt in with `export const prerender = true`. Catalog routes (`/`, `/products/[slug]`, `/categories/[slug]`, `/collections/[slug]`, `/blog/[slug]`) MUST be on-demand rendered with Cache API + SWR and tag purging. Dynamic routes MUST NOT set `prerender = false` (redundant noise — they are dynamic by default).
   > Amended V8: corrected per RT-009. Prerendering a dynamic catalog route requires `getStaticPaths()`, which appears nowhere in the plan, and would make publishing a product require a production deploy.
3. Never move pricing authority to the browser.
4. Never trust browser-supplied totals, delivery fees, discounts, VAT, or stock.
5. Never use floating-point money. **Exception:** AI cost tracking in `BudgetCounterDO.recordUsage()` uses float USD (Section 24.2); all other money is integer paisa.
6. CartDO is the active cart source of truth during a session. CartDO storage is already durable across Worker restart and DO eviction. CartDO MUST refresh the D1 `cart_activity` projection via its single alarm armed with purpose `'persist'` (5-minute inactivity backoff), which on firing hands off to purpose `'cleanup'` and MUST NOT re-arm itself. The `cart-activity` queue is a batching optimization for fresher D1 rows.
   > Amended V8: corrected per RT-006 and C-02. The V7 durability rationale was factually wrong — DO transactional storage does not need an alarm to survive restart or eviction — and a re-arming 5-minute alarm would wake every abandoned cart ~8,640 times a month.
7. KV must not store authoritative cart, stock, payment, or order state.
8. Buy Now must create a direct checkout session (`DirectCheckoutSessionDO`) and must not mutate the normal cart. DirectCheckoutSessionDO has ZERO interaction with CartDO — no shared ID, no shared state, no shared mutation path.
9. Buy Now submit must use the same secure checkout engine as normal checkout.
10. Never create an order before successful reservation.
11. If D1 order write fails after reservation, immediately release all reservations.
12. Cleanup cron is only a safety net, not primary rollback. It runs **hourly** (`0 * * * *`) and releases a reservation **only** when the reservation is orphaned (`order_id IS NULL AND created_at < datetime('now','-15 minutes')`) or its order is `cancelled`. A reservation belonging to a live order — including `pending_review` and awaiting-payment orders — MUST NOT be released. Reconciliation owns the attached-order expiry path because it cancels and releases atomically. The `release_requested_at` compare-and-set stamp is load-bearing; cron single-instancing MUST NOT be assumed. Full spec in Section 12.3.
   > Amended V8: corrected per RT-001, F-02, CF-06. The V7 rule released stock from live orders after 15 minutes and was a direct oversell path.
   > Amended V8: corrected per RV8-005 — the cron releases only orphaned reservations and reservations of cancelled orders; attached-order expiry is owned by reconciliation, which cancels and releases atomically.
13. Short-lived Durable Objects must use alarm-based cleanup, with **exactly one alarm per object** and an `alarm_purpose` value stored in DO storage when more than one deadline is needed. See Guardrail #45.
   > Amended V8: clarified per RT-006 and CF-01.
14. FraudBD direct checkout call timeout is 1.5 seconds with **zero retries** during checkout. The circuit breaker opens after 5 failures / 60s, stays open for 5 minutes, and uses fallback score `50` (forces `pending_review`). A 4xx response is not a breaker failure but still yields fallback score `50`. While the circuit is open, **COD is hard-blocked** and prepayment is required. A `pending_review` order MUST NOT reach `processing` without an explicit staff action recorded in `audit_log`. Retries happen ONLY in the `fraud-audit` queue (3s timeout, 1 retry, 2s backoff). Full spec in Section 11.2.
   > Amended V8: strengthened per S-05 and C-10.
15. COD quantity rule uses `SUM(quantity)` and is not sufficient on its own. COD additionally requires `total_paisa <= MAX_COD_VALUE_PAISA` and passing the per-phone and per-address 24-hour COD velocity limits, all enforced server-side at Section 11.1 step 11.
   > Amended V8: strengthened per S-04. A quantity-only cap let one BDT 60,000 piece qualify for COD while three pairs of socks did not, and nothing stopped five two-item COD orders in five minutes from the same phone.
16. POS does not use checkout reservation, but POS stock deduction must pass through `VariantInventoryDO.directSale()`. `directSale()` is idempotent on `(invoice_id, variant_id)`, and POS invoice creation is idempotent on `invoices.idempotency_key`. If `directSale()` succeeds but the D1 invoice write fails, POS MUST call `VariantInventoryDO.reverseDirectSale()`, log a P1 audit event, and return an error to the POS UI. Full contract in Section 11.3.
   > Amended V8: strengthened per RV8-002 — directSale() is idempotent on (invoice_id, variant_id) and POS invoice creation is idempotent on invoices.idempotency_key.
17. POS must never write inventory directly to D1. No channel may: the only writers of `stock` are `VariantInventoryDO.adjustStock()` and `restoreFromSnapshot()`, and the only writers of `sold` are `confirm()`, `directSale()`, `reverseDirectSale()`, and `reverseConfirm()`.
   > Amended V8: clarified per RT-003. V7 forbade direct writes without providing any legal alternative, which made returns and opening stock impossible.
   > Amended V8.1: added `reverseConfirm()` as the only legal reversal of an online confirmed sale.
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
28. CartDO must not synchronously write D1 on every cart mutation; it MUST use (a) the single alarm armed with purpose `'persist'` (5-min inactivity backoff) and (b) the `cart-activity` queue for batched fresher writes. Both mechanisms are mandatory, and **both MUST carry `cart_version` and use a version-conditional upsert** so an out-of-order queue retry cannot move `cart_activity` backwards.
   > Amended V8: corrected per RT-006 and CF-04.
29. The email provider follows the **same adapter pattern as payments**: `src/lib/integrations/email/{provider}/`, with interface `sendEmail(request: SendEmailRequest): Promise<SendResponse>`, swapped via the `EMAIL_PROVIDER` environment variable. Full spec in Section 17.1.
30. Resend is the default transactional email provider. Cloudflare Email Sending MUST NOT be enabled as an outbound provider in staging or production until its general availability for arbitrary transactional recipients is confirmed in writing (DECISION REQUIRED D-02, Section 17.1). Until then the fallback for a failed transactional email is manual staff notification.
   > Amended V8: corrected per CF-09. Cloudflare Email Routing is an inbound product; treating an unverified capability as a fallback left Resend as an undeclared single point of failure.
31. All migrations use D1-compatible SQL, contain **exactly one statement per file**, are numbered as exactly one greater than the highest number in `db/migrations/`, and ship with a rollback file and a pre-flight query that returns zero rows when it is safe to apply. See Guardrail #48.
   > Amended V8: strengthened per RT-010, M-03, M-04.
32. D1 constraints are enforced and tested. The complete required set is the constraint table in Section 6.1: `UNIQUE(provider, provider_event_id)` on `payment_events`, `UNIQUE(coupon_id, order_id)` on `coupon_redemptions`, the two partial unique indexes on `stock_reservations` (`(order_id, variant_id) WHERE status='active' AND order_id IS NOT NULL` and `(checkout_id, variant_id) WHERE status='active'`), `UNIQUE` on `invoices.receipt_no`, the money `CHECK` constraints, the `orders.status` and `orders.payment_status` `CHECK` constraints, and the `trg_refund_cap` trigger. Every one has an invalid-insert test.
   > Amended V8: corrected per RT-002 and Section 4 of the review. The V7 index shape was simultaneously a no-op at reserve time and a hard failure for multi-item orders.
33. All staff PII access is audit logged, with `customer_ref` stored as a salted hash and never as raw PII, so the Section 28.3 deletion right stays satisfiable against a 7-year append-only log.
   > Amended V8: clarified per S-07.
34. Every public page must meet the performance budget. Enforced by naming the exact URL set from Section 3.4 in `lighthouserc`; CI fails if any route in Section 3.4 is absent from that list.
   > Amended V8: strengthened per Section 10 of the review — "meet the budget" is only enforceable if the URL set is enumerated.
35. Accessibility is mandatory. The mechanical subset is enforced by axe-core in CI; the criteria that cannot be automated (focus order sanity, meaningful alt text, error-message clarity) are `[MANUAL CHECK]` performed by the **Frontend owner** at each release.
   > Amended V8: clarified per Section 10 of the review.
36. AI-generated public content requires staff review, enforced by `products.ai_draft_reviewed_by_staff_id NOT NULL` before publish is permitted — not by process alone.
   > Amended V8: strengthened per Section 10 of the review.
37. Expensive add-ons require Owner approval, enforced by gating the relevant feature flags behind an Owner-only RBAC write.
   > Amended V8: strengthened per Section 10 of the review.
38. **(New) D1 schema completeness:** the `otp_secrets`, `api_audit_logs`, and `ai_budget_limits` tables MUST exist (Section 6.1). `otp_secrets` is required for Owner TOTP 2FA (Section 18.1). `api_audit_logs` is required for `ProviderHealthDO` circuit breaker state and external API audit (Sections 2.4, 2.5, 11.2). `ai_budget_limits` is required for `BudgetCounterDO` durable config (Section 24.2).
39. **(New) Abandoned cart definition:** a cart is abandoned when `last_cart_update_at` is older than 24 hours (SQL: `< datetime('now', '-24 hours')`), `abandoned_email_sent_at IS NULL`, `converted_order_id IS NULL`, `consent_status = 'allowed'`, and `customer_email IS NOT NULL`. Cron deduplicates on `customer_email` via `ROW_NUMBER()` window. Full SQL pseudocode in Section 17.3.
40. **Buy Now session binding:** `DirectCheckoutSessionDO.session_id = HMAC(secret, timestamp + random)`, and the session is bound to the `__Host-bn_bind` `HttpOnly; Secure; SameSite=Lax; Path=/` cookie secret whose SHA-256 must match the stored `binding_hash`. The companion session cookie is `__Host-bn_sid`. `Origin` is checked on state-changing POSTs only. The User-Agent hash check is deleted. No session identifier appears in any URL. A failed check on a GET renders a fresh page; it MUST NOT 403 and MUST NOT delete the DO. The DO is deleted immediately after the order is successfully created. Full contract in Section 10.6.
   > Amended V8: corrected per RT-005 and S-02. The V7 rule returned 403 on the first page load of the primary conversion path, because browsers do not send `Origin` on same-origin top-level GET navigation.
   > Amended V8: the cookies are `__Host-bn_sid` and `__Host-bn_bind`. The `__Host-` prefix is mandatory: `Secure`, `Path=/`, no `Domain`, no subdomain-set cookie accepted.
41. **VAT server-side computation:** VAT is computed server-side by the single rule in Section 11.7 — rate from the D1 `tax_rates` table read in the same read as pricing, taxable base `subtotal_paisa - discount_paisa`, half-up integer rounding, largest-remainder per-line allocation such that `SUM(order_items.vat_paisa) = orders.vat_paisa`. POS uses the same rule. The browser must never supply VAT, enforced by a `.strict()` request schema.
   > Amended V8: corrected per F-06 and C-09. `VAT_RATE_PERCENT` is retired; a KV-sourced rate meant two orders seconds apart could carry different VAT on a legally binding invoice.
42. **BudgetCounterDO contract:** DeepSeek has a hard daily limit of $5.00 USD (UTC). Staff actions MUST call `canUseDeepSeek()` before the call and `recordUsage()` after success. If `canUseDeepSeek()` times out, fall back to Workers AI — never block the staff action — subject to the hourly Workers AI fallback cap in Section 24.2, because Workers AI overage is billed, not blocked.
   > Amended V8: strengthened per CF-08.
43. **Reservation race prevention:** `stock_reservations` carries a `checkout_id` column and two partial unique indexes: `(order_id, variant_id) WHERE status='active' AND order_id IS NOT NULL`, and `(checkout_id, variant_id) WHERE status='active'`. A multi-variant order writes one active row per variant and all succeed. The retired index `idx_stock_reservations_order_active` MUST NOT appear anywhere. The `release_requested_at` stamp prevents double-release between overlapping cron ticks. Full spec in Section 12.3.
   > Amended V8: corrected per RT-002.
44. **(New, closes RT-003) Stock entry and exit:** `VariantInventoryDO.adjustStock()` is the only way `stock` ever changes, in any channel, for any reason (return restock, goods receipt, stocktake, damage, theft, correction). It writes a `stock_adjustments` row and an `audit_log` entry and is idempotent on `adjustment_id`. A negative `delta` requires `approved_by_staff_id != staff_id`. Sales never touch `stock`; all sales increment `sold`.
45. **(New, closes RT-006) One alarm per Durable Object:** a Durable Object has exactly one alarm and `setAlarm()` overwrites any pending alarm. Any DO needing more than one deadline MUST store `alarm_purpose` in DO storage and branch on it in `alarm()`. `CartDO`'s `'persist'` alarm MUST hand off to `'cleanup'` and MUST NOT re-arm itself. DO storage is durable across restart and eviction; no alarm may be justified as a durability mechanism.
46. **(New, closes F-01) Payment event uniqueness:** `payment_events` carries `UNIQUE(provider, provider_event_id)`. The webhook handler treats a uniqueness violation as a replay: return 200, do not enqueue, do not credit. Every settled amount is additionally recorded in `payment_transactions`.
   > Amended V8: `payment_transactions` additionally carries `payment_event_id` with `UNIQUE(payment_event_id, direction)`. The queue consumer treats a violation there as a replay no-op: ack, stop, no second ledger row, no second `payment_status` write, no second email.
47. **(New, closes RT-004) Durable Object state is part of disaster recovery:** an hourly cron snapshots every active variant's `{stock, reserved, sold}` to R2 alongside the D1 backup, `VariantInventoryDO.restoreFromSnapshot()` exists and is env-gated by `DR_RESTORE_ENABLED`, D1 Time Travel is the primary D1 recovery mechanism, restores happen in place with no binding change, and every restore drill asserts DO/D1 stock parity — not only row counts.
48. **(New, closes RT-010) Migration discipline:** every migration file contains exactly one statement, is numbered exactly one greater than the highest number in `db/migrations/`, has a rollback file, and has a pre-flight query that returns zero rows when safe. There is no mapping between "plan numbers" and "repo numbers" — a mapping table is exactly the drift this document exists to prevent. Risk is classified against a non-empty production database.
49. **(New, closes C-04 / C-05) BudgetCounterDO object ID:** the object ID is `budget:{provider}` document-wide. One object holds both the daily and the monthly bucket and rolls them on UTC boundaries. No other format may appear in prose, code, or tests.
50. **(New, closes RT-001 / F-02) Reservation window outlasts the payment window:** every order carries `reservation_expires_at = created_at + 60 minutes`, which is strictly greater than the 30-minute payment window plus the 15-minute reconciliation interval. No code path releases a reservation attached to an order that is not cancelled.
   > Amended V8: clarified per RV8-005 — no code path releases a reservation attached to an order that is not cancelled; the expiry-based release branch was removed from the cleanup cron.

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
- [ ] Exactly five routes export `prerender = true` (`/about`, `/privacy`, `/terms`, `/return-policy`, `/size-guide`). Catalog routes are on-demand rendered with Cache API + SWR and tag purging.
- [ ] Cart authoritative state is in CartDO.
- [ ] KV cart JSON is not used.
- [ ] Checkout ignores client price/totals.
- [ ] Money uses integer paisa (exception: AI cost tracking in BudgetCounterDO uses float USD).
- [ ] FraudBD blocking/async behavior is not mixed.
- [ ] FraudBD circuit breaker: 5 failures/60s → open 5 min → fallback score 50 → `pending_review`. Checkout = 0 retries, fraud-audit queue = 1 retry / 2s backoff.
- [ ] Reservation release exists on every failure branch.
- [ ] `stock_reservations` has a `checkout_id` column and BOTH partial unique indexes: `idx_stock_res_order_variant_active` on `(order_id, variant_id) WHERE status='active' AND order_id IS NOT NULL`, and `idx_stock_res_checkout_variant_active` on `(checkout_id, variant_id) WHERE status='active'`.
- [ ] The name `idx_stock_reservations_order_active` appears nowhere in code, migrations, tests, or docs.
- [ ] Reservation cleanup cron runs hourly and releases only orphaned reservations and reservations of cancelled orders.
- [ ] `orders.reservation_expires_at` is written on every order-creation path and equals `created_at + 60 minutes`.
- [ ] `VariantInventoryDO` exposes `adjustStock()`; it is the only writer of `stock`. Negative deltas require a different approver.
- [ ] `VariantInventoryDO` exposes `reverseConfirm()`; confirmed-then-cancelled online orders decrement `sold` via this method only.
- [ ] `IdempotencyDO` object ID is `idem:{scope}:{idempotency_key}` at every call site; raw client keys are never used as global object IDs.
- [ ] `VariantInventoryDO` exposes `restoreFromSnapshot()`, gated by `DR_RESTORE_ENABLED`.
- [ ] Every Durable Object arms at most one alarm and stores `alarm_purpose` when it has more than one deadline. CartDO's `'persist'` alarm hands off to `'cleanup'`.
- [ ] `payment_events` has `UNIQUE(provider, provider_event_id)`; the webhook handler treats a violation as a replay.
- [ ] `payment_transactions` has `payment_event_id` and `UNIQUE(payment_event_id, direction)`; the queue consumer treats a violation as a replay no-op.
- [ ] `coupon_redemptions` is written inside the order-creation D1 batch, never at coupon validation, and has `UNIQUE(coupon_id, order_id)`.
- [ ] `BudgetCounterDO` object ID is `budget:{provider}` at every call site.
- [ ] Both `cart_activity` writers carry `cart_version` and use the version-conditional upsert.
- [ ] The DO snapshot cron exists and the restore procedure asserts DO/D1 parity.
- [ ] Abandoned cart has D1 queryable index (`cart_activity`).
- [ ] Abandoned cart definition: `last_cart_update_at` older than 24h (SQL `< datetime('now', '-24 hours')`), `abandoned_email_sent_at IS NULL`, `converted_order_id IS NULL`, `consent_status = 'allowed'`, deduplicated on `customer_email`.
- [ ] POS uses invoice ledger, not online orders.
- [ ] POS stock deduction uses `VariantInventoryDO.directSale()`.
- [ ] POS retries with the same idempotency key never double-deduct stock or duplicate an invoice.
- [ ] POS D1 invoice write failure calls `VariantInventoryDO.reverseDirectSale()` + logs P1 audit event.
- [ ] Browser uploads original image only; variants are queue/API generated.
- [ ] Short-lived Durable Objects use alarm cleanup.
- [ ] CartDO publishes `cart-activity` queue messages instead of synchronous D1 writes.
- [ ] CartDO has a 5-minute inactivity alarm that persists state to D1 `cart_activity` (projection-freshness path — DO storage is already durable).
- [ ] Resend is default email provider; Cloudflare Email Sending is not an approved outbound fallback at launch.
- [ ] Email adapter follows the same pattern as payments: `src/lib/integrations/email/{provider}/`, interface `sendEmail(request): Promise<SendResponse>`, swapped via `EMAIL_PROVIDER` env var.
- [ ] FraudBD checkout timeout is 1.5 seconds with zero retries and pending_review fallback.
- [ ] Buy Now does not mutate normal cart. DirectCheckoutSessionDO has ZERO interaction with CartDO.
- [ ] Buy Now `session_id = HMAC(secret, timestamp + random)`, bound by the `__Host-bn_bind` HttpOnly cookie secret. Cookies are `__Host-bn_sid` / `__Host-bn_bind` with `Secure`, `Path=/`, no `Domain`. No `sid` in any URL. `Origin` checked on POSTs only. No User-Agent check anywhere. A normal top-level GET never returns 403.
- [ ] DirectCheckoutSessionDO is deleted immediately after the order is successfully created.
- [ ] Buy Now submit uses secure checkout engine.
- [ ] Checkout Step 8 computes VAT by the Section 11.7 rule: rate from D1 `tax_rates`, base `subtotal - discount`, half-up rounding, largest-remainder line allocation. `VAT_RATE_PERCENT` appears nowhere.
- [ ] Turnstile at step 2 uses pre-checkout signals only; it does not reference the FraudBD score.
- [ ] COD checks quantity, monetary ceiling, and 24h per-phone/per-address velocity.
- [ ] Every migration file contains exactly one statement and is numbered above the current repository head.
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
- **Section 35 and `V8_MIGRATION_PLAN.md`** — Any schema-touching PR MUST reference the migration number, contain exactly one statement per file, and include forward SQL, rollback SQL, a pre-flight query returning zero rows when safe, and a test fixture. `V8_MIGRATION_PLAN.md` is authoritative where it and Section 35 differ.
- **Section 36** — TypeScript Contract Stubs. Any DO or adapter implementation MUST `implements` the corresponding interface from `src/lib/contracts/`. A PR that introduces a DO class without `implements` is incomplete.
- **Section 37** — Test matrix. Any PR touching `src/lib/integrations/fraudbd/`, `src/durable-objects/provider-health-do.ts`, or `src/lib/checkout/fraud-check.ts` MUST keep all 25 CB tests passing, and any PR touching inventory, checkout, payments, or migrations MUST keep the mandatory matrix in Section 37.0 passing — starting with `reservation-oversell-concurrency.test.ts`.
- **Section 38** — Drift Audit Playbook. The agent SHOULD self-audit its own PR using the `audit-drift.ts` script (Section 38.4) before requesting review. Any P0 finding blocks merge.

Agents that encounter a guardrail they believe is wrong MUST NOT work around it. They MUST propose an amendment per Section 34.8 (open an ADR) and let the Owner decide.

---

## 32. Feature Coverage Matrix

This matrix confirms that the V8 plan includes the required business, technical, operational, and AI-assisted features.

| Feature | V8 Coverage |
|---|---|
| Astro 7.2 | Included, using `output: 'server'` (universal). `output: 'static'` is FORBIDDEN anywhere in the project. Exactly five static legal/info routes opt in with `prerender = true`; catalog routes are on-demand rendered with Cache API + SWR (Section 3.3, RT-009). |
| Stock adjustment / receiving / restock | Included. `VariantInventoryDO.adjustStock()` with a two-person rule for negative deltas, `inventory.adjust` / `inventory.adjust.approve` RBAC, `stock_adjustments` rows, and `suppliers` / `purchase_orders` / `goods_receipts` (RT-003). |
| Disaster recovery of Durable Object state | Included. Hourly R2 snapshot of every variant's counters, `restoreFromSnapshot()`, D1 Time Travel, in-place restore, and a DO/D1 parity assertion in every drill (RT-004). |
| Invoice serial integrity | Included. `InvoiceCounterDO` issues `receipt_no`; `UNIQUE` on `invoices.receipt_no`; burned serials recorded rather than reused (RT-008). |
| POS cash-drawer close / Z-report | Included. `pos_cash_drawer_sessions`, expected-vs-counted reconciliation, daily output-VAT register (F-09). |
| Courier COD tracking | Included. `courier_shipments` and `courier_cod_remittance` (F-03). |
| Partial-prepayment ledger | Included. `payment_transactions`, the refund-cap trigger, and COD collection/remittance records (F-03). |
| VAT correctness | Included. Effective-dated `tax_rates` in D1, post-discount taxable base, half-up rounding, largest-remainder per-line allocation (F-06, C-09). |
| Cost model | Included. Section 2.2 states volume assumptions and per-unit drivers (CF-07). |
| Cloudflare Pages + Workers | Included |
| React 19 Islands | Included |
| Tailwind CSS design tokens | Included |
| D1 schema and constraints | Included and corrected. `otp_secrets`, `api_audit_logs`, `ai_budget_limits`, plus the V8 additions in Section 6.1 (`tax_rates`, `payment_transactions`, `courier_shipments`, `courier_cod_remittance`, `pos_cash_drawer_sessions`, `suppliers`, `purchase_orders`, `goods_receipts`) and the full constraint set including the two `stock_reservations` partial unique indexes at `(order_id, variant_id)` and `(checkout_id, variant_id)` (Section 12.3, RT-002). |
| R2 images | Included |
| KV sessions/flags/redirects | Included, cart removed from authoritative KV |
| Durable Objects | Included and corrected. **One alarm per object**, with `alarm_purpose` stored in DO storage where more than one deadline is needed (Section 6.6 / 6.8, RT-006). |
| VariantInventoryDO | Included with rollback contract, `reverseDirectSale()`, `reverseConfirm()`, `adjustStock()`, and `restoreFromSnapshot()` (Section 11.3 / 36.2). |
| CartDO | Included as normal cart source of truth. Single alarm with `'persist' → 'cleanup'` handoff; DO storage is already durable and the alarm is a projection-freshness mechanism, not a durability mechanism (Section 6.3 / 9.1, C-02). Adds `getCartForCheckout()`. |
| DirectCheckoutSessionDO | Included for Buy Now temporary sessions. Explicit zero-interaction contract with CartDO (Section 10.6). `session_id = HMAC(secret, timestamp + random)`, HttpOnly cookie-secret binding, `Origin` on POSTs only, no `sid` in URLs, immediate delete on order success (RT-005, S-02). |
| BudgetCounterDO | Included with full interface, object ID `budget:{provider}` holding both daily and monthly buckets, $5.00/day UTC limit, capped Workers AI fallback on DO timeout (Section 24.2, C-04/C-05, CF-08). |
| InvoiceCounterDO | Included. `invoice-counter:{YYYYMMDD}`, `nextInvoiceNumber()` (Section 15.5, RT-008). |
| IdempotencyDO | Included, with a defined interface in Section 36.7a (claim / complete / replay), session-scoped object ID `idem:{scope}:{idempotency_key}`, and 2-hour completed-response retention — V7 named the file but never specified the contract. |
| Queues | Included with corrected fraud queue role |
| UddoktaPay | Included as primary payment provider adapter with verify/reconcile flow |
| SSLCommerz fallback | Included |
| FraudBD | Included with direct checkout call, 1.5s timeout, **zero retries in checkout**, full circuit breaker spec (5 failures / 60s → open 5 min → fallback score 50 → `pending_review`), and async audit retry surface (Section 11.2). |
| Buy Now direct guest order | Included with direct landing page, DirectCheckoutSessionDO, secure checkout engine, and strict cart isolation contract (Section 10.6). |
| COD-first model | Included with clear total quantity rule |
| Partial prepayment | Included |
| Server-authoritative pricing | Included |
| Stock reservation lifecycle | Included and corrected. Hourly cleanup cron that releases only orphaned or dead-order reservations, `orders.reservation_expires_at` at 60 minutes (longer than the 30-minute payment window), and two correctly-grained partial unique indexes (Section 12.3, RT-001/RT-002/F-02). |
| Payment webhook/reconciliation | Included, with `UNIQUE(provider, provider_event_id)` as the enforcing idempotency mechanism (F-01) |
| 8-state order lifecycle | Included, with `restocked` removed as a state and `payment_status` added as an orthogonal field (C-06, F-05) |
| Returns/refunds | Included, with a real restock path (`adjustStock`), a server-enforced return window, and a refund cap constraint (RT-003, F-10, F-03) |
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
| Cart activity queue | Included for batched D1 `cart_activity` updates. Coexists with the mandatory 5-minute alarm-based projection refresh (Section 6.3) — DO storage is already durable; the alarm is a projection-freshness mechanism, not a durability mechanism. |
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
| Owner TOTP 2FA | Included via `otp_secrets` D1 table and mandatory login enforcement in Section 18.1 |
| External API audit trail | Included via `api_audit_logs` D1 table (Section 6.1, 2.5) |
| AI budget durable config | Included via `ai_budget_limits` D1 table (Section 6.1, 24.2) |
| Server-side VAT computation | Included in checkout Step 8 (Section 11.1) by the single rule in Section 11.7: rate from the D1 `tax_rates` table, post-discount taxable base, half-up rounding, largest-remainder line allocation. `VAT_RATE_PERCENT` is retired. |
| Email adapter contract | Included, mirrors payment adapter pattern (Section 2.3, 17.1) |
| Guardrail enforcement protocol | Included and rescoped to a 2–4 engineer team — four clusters, a CI audit checklist, waivers, amendments, and a monthly Owner dashboard review (Section 34) |
| D1 migration sequencing | Included — single-statement migrations numbered from `0040` against the real repository head, each with forward SQL, rollback SQL, a zero-row pre-flight query, test fixtures, and risk re-rated against a non-empty production database (Section 35 and `V8_MIGRATION_PLAN.md`) |
| Cost of goods sold / accounting export / general ledger | **Not included.** Out of scope for launch; see the classification table in Section 29.4 and DECISION REQUIRED (D-05). |
| Customer accounts | **Not included.** Guest-only pending DECISION REQUIRED (D-01). `mergeCart()` is declared NOT IMPLEMENTED rather than shipped. |
| TypeScript contract stubs | Included — `src/lib/contracts/` with interfaces for all 7 DOs + EmailProvider; implementations MUST use `implements` (Section 36) |
| FraudBD circuit breaker test suite | Included — 25-test matrix (CB-01 to CB-25) covering all Section 11.2 rules, with fixtures and CI integration (Section 37) |
| Mandatory test matrix | Included — 31 tests covering every P0/P1 path, with `reservation-oversell-concurrency.test.ts` as test #1 (Section 37.0) |
| Drift audit playbook | Included — 46 finding codes (D-01 to D-46), `audit-drift.ts` script, CI integration, V8 landing one-time audit (Section 38) |

---

## 33. Final Implementation Contract

This V8 plan is the implementation contract and supersedes V7 entirely. The project must remain Cloudflare-native, cost-aware, mobile-first, SEO-friendly, and safe for ecommerce operations.

The most important engineering rule is simple:

**Cached pages may sell the product, and Buy Now pages may convert the customer, but only server routes may trust data, change money, reserve stock, create orders, verify payments, send transactional emails, or change inventory.**

This contract is enforced, not aspirational. Sections 34–38 turn the rules in Section 30 into living practice:

- **Section 34** defines who enforces them at a 2–4 engineer team size and through which CI gates.
- **Section 35** and `V8_MIGRATION_PLAN.md` define how the D1 schema evolves without losing data or locking the database.
- **Section 36** defines the TypeScript interfaces that make the DO and adapter contracts compiler-enforced.
- **Section 37** defines the test suite that proves the FraudBD circuit breaker behaves as specified.
- **Section 38** defines the audit playbook that catches drift in the main branch and in-flight PRs.

A PR that satisfies Sections 30–38 is, by definition, conformant. A PR that violates any of them is, by definition, not ready to merge.

---

## 34. Guardrail Review and Enforcement Protocol

Section 30 lists 50 Absolute Guardrails. Listing rules is not enough — they must be enforced. This section defines an enforcement protocol that **the actual team can staff**.

### 34.0 Team Size Assumption (stated so the protocol is honest)

This is a boutique in Bangladesh. The assumed engineering team is **2–4 engineers plus the Owner**. V7's protocol required 17 named Guardrail Owners, a 3-member Architecture Review Board rotating quarterly, a Release Captain rotating weekly, an on-call rotation, weekly digests, monthly reviews, quarterly full re-reads, and an optional annual external audit. At 2–4 engineers, one person would own 5+ clusters — which is exactly the "two owners means no owner" failure the cluster map claimed to prevent, and it guarantees the rubber-stamp anti-pattern Section 34.9 forbids. An enforcement protocol that cannot be staffed will be skipped, and skipping it teaches the team that all the guardrails are optional.

V8 therefore collapses the protocol to what 2–4 people can actually run: **four clusters, one CI gate, and one monthly Owner review.**

If the team ever exceeds 8 engineers, this section MUST be revisited — the current shape is deliberately under-built for a larger team.

### 34.1 Roles and Accountability

| Role | Who | Accountability |
|---|---|---|
| **Cluster Owner** | One named engineer per cluster (4 clusters, so at 2 engineers each person owns 2) | Maintains the canonical interpretation of the rules in their cluster; is the required reviewer on PRs that touch them |
| **Owner** | The business owner | Approves guardrail amendments and waivers; reviews the CI dashboard monthly |

There is no ARB, no Release Captain, and no rotation. Cluster ownership is recorded in `docs/guardrail-owners.md`. An unowned cluster blocks the next release.

### 34.2 Review Cadence

| Cadence | Who | Scope | Output |
|---|---|---|---|
| **Per-PR (automated)** | CI | `audit-drift.ts` (Section 38) plus the Section 34.4 checklist. **Every finding is a PR blocker** — there is no P1-warns-only tier for drift on a PR. | Pass/fail merge gate |
| **Per-PR (human)** | Cluster Owner | Required review on PRs touching checkout, inventory, POS, payments, migrations, or DO contracts | Approval |
| **Monthly** | Owner | Review the CI dashboard: blocked-PR counts by finding code, open waivers, and any waiver older than 30 days | A short note in `docs/audit/monthly-{YYYY-MM}.md` |

The weekly, per-release, quarterly, and annual cadences from V7 are **deleted**. So are the weekly digest, the ARB meeting, and the external audit. The CI gate does the work those meetings were supposed to do, and it does it on every PR instead of once a week.

### 34.3 Guardrail Cluster Map

The 50 guardrails are grouped into **4 clusters**, each owned by exactly one engineer. Every guardrail appears in exactly one cluster — no overlaps, no orphans.

| Cluster | Guardrail #s | Count |
|---|---|---:|
| **1. Money & Commerce** — pricing, VAT, COD, coupons, fraud, payments, webhooks | 3, 4, 5, 9, 14, 15, 18, 19, 25, 41, 46 | 11 |
| **2. Inventory & POS** — reservations, stock arithmetic, POS, invoices, D1 constraints | 10, 11, 12, 16, 17, 32, 43, 44, 50 | 9 |
| **3. Security & Privacy** — staff access, secrets, PII, logs, a11y, performance, Owner authority | 20, 21, 22, 33, 34, 35, 36, 37, 40 | 9 |
| **4. Platform & Migrations** — Astro, rendering, cart, DOs, alarms, adapters, images, email, migrations, DR, AI budget | 1, 2, 6, 7, 8, 13, 23, 24, 26, 27, 28, 29, 30, 31, 38, 39, 42, 45, 47, 48, 49 | 21 |

Coverage check: 11 + 9 + 9 + 21 = **50** ✓ — every guardrail from 1 to 50 accounted for, exactly once, with no duplicates and no orphans.

### 34.4 Pre-Release Guardrail Audit Checklist

The checklist runs as a CI job (`guardrail-audit.yml`) on **every PR** and on every release branch. A failing item blocks the merge unless an Owner-approved waiver (Section 34.7) is on file. Items that cannot be automated are marked `[MANUAL CHECK]` with the named role that performs them.

| # | Check | Method | Pass criterion |
|---|---|---|---|
| 1 | No `output: 'static'` or `output: 'hybrid'` anywhere in repo | `rg "output:\s*'(static\|hybrid)'" --glob '!**/*.md'` (excludes the master plan and docs/ — the plan's own FORBIDDEN references are documentation, not drift) | Zero hits |
| 2 | No `prerender = false` in any route file | `rg "prerender\s*=\s*false" src/pages/` | Zero hits |
| 3 | Exactly the five legal/info routes export `prerender = true`; no catalog route does | AST scan of `src/pages/**/*.{astro,ts}` cross-referenced with the Section 3.4 table | The set of prerendered routes equals `{/about, /privacy, /terms, /return-policy, /size-guide}` — no more, no less |
| 4 | `cart_activity` table has `abandoned_email_sent_at` column, NOT legacy pair | D1 migration dry-run schema introspection | Column exists; legacy columns absent |
| 5 | `otp_secrets`, `api_audit_logs`, `ai_budget_limits` tables exist | D1 migration dry-run | All three tables present with the schema in Section 6.1 |
| 6 | `stock_reservations` has `checkout_id` and BOTH correct partial unique indexes, and does NOT have the retired one | D1 `PRAGMA index_list('stock_reservations')` + `PRAGMA table_info('stock_reservations')` | `idx_stock_res_order_variant_active` and `idx_stock_res_checkout_variant_active` present and unique; `idx_stock_reservations_order_active` **absent**; `checkout_id` column present |
| 7 | `VariantInventoryDO` interface includes `reverseDirectSale` | TypeScript type check | Method present with the signature in Section 11.3 |
| 8 | `BudgetCounterDO` interface includes `recordUsage` and `canUseDeepSeek` | TypeScript type check | Both methods present with the signatures in Section 24.2 |
| 9 | Email adapter implements `EmailProvider.sendEmail` | TypeScript type check | Both `resend` and `cloudflare_email` adapters conform |
| 10 | FraudBD checkout call has 1.5s timeout and zero retries | Code path audit | `AbortController` with 1500ms timeout; no retry loop in the checkout path |
| 11 | FraudBD circuit breaker config matches 5/60s → 5min → score 50 | Unit test assertions (Section 37) | All test cases pass |
| 12 | POS flow calls `reverseDirectSale` on D1 invoice write failure | Code path audit + integration test | Test `pos-compensating-transaction.test.ts` passes |
| 13 | Checkout Step 8 computes VAT by the Section 11.7 rule | Unit test + `rg "VAT_RATE_PERCENT"` | `vat-discount-rounding.test.ts` passes (per-line VAT sums exactly to `orders.vat_paisa`); `VAT_RATE_PERCENT` returns zero hits outside the changelog |
| 14 | `DirectCheckoutSessionDO` binds on the cookie secret, not on Origin/User-Agent, and never 403s a top-level GET | Integration test | `buy-now-no-origin-header.test.ts` and `buy-now-session-fixation.test.ts` pass; `rg "user_agent_hash"` returns zero hits in `src/` |
| 15 | `DirectCheckoutSessionDO` is deleted on successful order creation | Code path audit | `deleteAll()` called after D1 order write succeeds |
| 16 | CartDO arms exactly one alarm and hands off `'persist' → 'cleanup'` | Unit test | `cart-do-alarm-handoff.test.ts` passes: after the persist alarm fires, `getAlarm()` is ~30 days out, not ~5 minutes |
| 17 | Reservation cleanup cron schedule is hourly | `wrangler.toml` / Cron Trigger config | `crons = ["0 * * * *"]` |
| 18 | No PII in logs | `redaction.test.ts` (chokepoint proof) **plus** a lint rule banning direct log-sink writes outside `src/lib/observability/`; the 7-day staging log scan runs nightly using `CF_LOGS_READ_TOKEN` (Section 26.2) | Test passes, lint clean, scan returns zero findings. A missing token FAILS the check |
| 19 | All staff routes behind Zero Trust, with `/staff/login` excluded | Cloudflare Access config audit via `CF_ACCESS_READ_TOKEN` (Section 26.2) | All `/staff/*` and `/api/staff/*` paths covered except the login endpoints; break-glass rule absent or expired |
| 20 | All webhooks verify HMAC | Code path audit | No webhook handler without `verifyHmac()` call |
| 21 | Reservation cleanup cron never releases a live order's reservation | Unit test | `cron-never-releases-live-order.test.ts` passes |
| 22 | Reservation window outlasts the payment window | Unit test | `reservation-window-outlasts-payment.test.ts` passes for every order-creation path |
| 23 | `VariantInventoryDO` exposes `adjustStock` and `restoreFromSnapshot` | TypeScript type check | Both present with the Section 11.3 signatures; negative-delta approval rule tested |
| 24 | `payment_events` has `UNIQUE(provider, provider_event_id)` | D1 `PRAGMA index_list('payment_events')` + `payment-webhook-replay.test.ts` | Index present and unique; three identical signed events produce one credit |
| 25 | `BudgetCounterDO` object ID is `budget:{provider}` everywhere | `rg "idFromName\('budget:"` + `budget-counter-id-format.test.ts` | Every call site matches the single format; pre-flight and record resolve to the same instance |
| 26 | Every migration file contains exactly one statement and is numbered above the repository head | Migration lint script over `db/migrations/` | Statement count = 1 per file; `max(existing) + 1` for each new file; rollback file present; pre-flight query present |
| 27 | Disaster recovery covers Durable Object state | Config audit + test | DO snapshot cron configured; `dr-do-d1-parity.test.ts` passes |
| 28 | Oversell concurrency test exists and passes | Test run | `reservation-oversell-concurrency.test.ts` present and green |
| 29 | Coupon redemption is written in the order batch, not at validation | Code path audit + test | `coupon-rollback.test.ts` passes; zero redemptions after a forced `INSUFFICIENT_STOCK` |
| 30 | POS invoice serials are DO-issued and unique | Test | `pos-invoice-number-concurrency.test.ts` passes; `invoices.receipt_no` is UNIQUE |
| 31 | Mushak/VAT report field mapping signed off | `[MANUAL CHECK]` — **Owner**, with the VAT consultant | Signed note in `docs/audit/` before VAT is switched on |
| 32 | Accessibility criteria that cannot be automated | `[MANUAL CHECK]` — **Cluster 3 Owner (Security & Privacy)** | axe-core clean, plus a signed pass on focus order, alt-text meaningfulness, and error-message clarity |
| 33 | POS sale creation is idempotent | `pos-sale-retry-idempotency.test.ts` passes + D1 `PRAGMA index_list('invoices')` | Same idempotency key returns existing invoice; second `directSale` is `replayed: true`; unique index present |
| 34 | `site_settings` exists and is seeded | D1 introspection + seed assertion | Table exists; launch defaults present for COD ceiling, COD velocity, and return window |

### 34.5 Release Record

The CI job is the record. Each production deploy attaches the `guardrail-audit.yml` run to the deploy, and the two `[MANUAL CHECK]` items (checks #31 and #32) are recorded as a signed line in `docs/audit/release-{YYYY-MM-DD}-{short-sha}.md`:

```markdown
# Release — {YYYY-MM-DD} — {git-sha}

- Deployed by: {name}
- Guardrail audit CI run: {link}   (checks 1–30 and 33–34 automated)
- Manual check #31 (Mushak/VAT mapping): {Owner initials} {date} — or N/A, VAT not enabled
- Manual check #32 (non-automatable a11y): {Cluster 3 Owner initials} {date}
- Waivers in effect: (none) OR W-{YYYY}-{NN}, expires {date}
- Rollback plan: {link to runbook}
```

Four lines and a CI link. V7's full 20-row transcription table is deleted — copying CI output into markdown by hand is exactly the audit theatre Section 34.9 forbids.

### 34.6 Incident Response for Guardrail Violations

When a guardrail is violated in production (whether or not it caused customer impact), the response follows the standard incident severity matrix with one addition: a **Guardrail Violation (GV)** tag is attached to the incident for trend analysis.

| Severity | Trigger | Response | Post-incident |
|---|---|---|---|
| P0 | Guardrail violation caused data corruption, oversell, money loss, or PII leak | Immediate page; stop writes per Section 27.4; Owner notified within 1h; hotfix or rollback | Post-mortem within 24h; a CI check that would have caught it is added, or the finding is documented as uncatchable |
| P1 | Guardrail violation detected but no customer impact yet (e.g. POS compensation path triggered but reversal succeeded) | Notify the Cluster Owner within 15min; assess blast radius; fix or rollback within 1h | Post-mortem within 48h |
| P2 | Guardrail violation detected in CI before reaching production | The PR is already blocked. Fix it. | Counted on the monthly dashboard |
| P3 | Guardrail drift detected (code style, missing comment, etc.) | Fix in normal workflow | Counted on the monthly dashboard |

Every GV incident produces a `GV-{YYYY}-{NN}` identifier referenced in the monthly Owner review. Three GVs in the same cluster in a quarter trigger a proposed guardrail amendment — either to clarify the rule or to add the CI check that would have caught it.

### 34.7 Waiver Process

A waiver is a time-boxed, Owner-approved exception to a specific guardrail for a specific scope. Waivers exist because real-world migrations sometimes need a transitional state (e.g. shipping the new `otp_secrets` table before the 2FA UI is built).

| Step | Action | Owner |
|---|---|---|
| 1. Request | Open a waiver request with: guardrail #, scope (PR/service/route), justification, expiry date (≤ 30 days), mitigation in place | Requesting engineer |
| 2. Decision | Approve or reject within 1 business day | Owner + the relevant Cluster Owner |
| 3. Record | Approved waivers are listed in `docs/audit/waivers.md` with the waiver ID `W-{YYYY}-{NN}` and expiry. The CI job reads this file: a guardrail with an active, in-scope waiver reports WAIVED instead of FAIL, and the waiver ID appears in the CI output | Cluster Owner |
| 4. Expire | The CI job fails on an expired waiver. There is no reminder step — the build is the reminder | CI |

Waivers cannot be renewed more than twice. After two renewals (90 days total), the underlying work must either complete or the guardrail must be amended via the Section 34.8 process. A P0-closing guardrail (44–50) MUST NOT be waived.

### 34.8 Guardrail Amendment Process

Section 30 is not immutable, but amendments are deliberately heavyweight to prevent drift. The bar is "the rule as written no longer reflects production reality or actively harms the system."

| Step | Action | Threshold |
|---|---|---|
| 1. Propose | Open an ADR at `docs/adr/{NNNN}-amend-guardrail-{N}.md` citing the guardrail #, the proposed change, the evidence, and the alternatives considered | Any engineer |
| 2. Decide | The Owner and the relevant Cluster Owner approve or reject within 5 business days | Owner + Cluster Owner |
| 3. Document | An approved amendment updates Section 30 in the same PR, keeping the original guardrail number and adding an inline marker: `> Amended {YYYY-MM-DD}: guardrail {N} {clarified/strengthened/corrected/relaxed} per ADR {NNNN}` | Proposer |
| 4. Propagate | The same PR updates every mirror: Section 0, the owning section, Section 31 checklist, Section 32 matrix, Section 34.4 checklist, Section 36 contracts, Section 37 tests, Section 38 drift codes. **A PR that changes a rule in one place only is incomplete** | Proposer |
| 5. Retire (optional) | An obsolete guardrail moves to a "Retired Guardrails" appendix with the retirement date and rationale — it is NOT silently deleted, and its number is NOT reused | Owner |

**No new guardrail may be added unless an existing one is retired or merged, or unless it closes a P0 finding.** Guardrails 44–50 were added under the P0 exemption.

### 34.9 Anti-Patterns to Avoid

These behaviors defeat the purpose of the protocol and are explicitly forbidden:

- **Rubber-stamp reviews.** A Cluster Owner approving every PR in their cluster without reading the diff.
- **Silent waivers.** Shipping code that violates a guardrail without filing a waiver. Treated as a P2 GV incident.
- **Evergreen waivers.** Renewing the same waiver indefinitely. The two-renewal cap (Section 34.7) is hard.
- **Audit theatre.** Transcribing CI results into a document instead of investigating failures. This is why Section 34.5 is four lines and a link.
- **Guardrail accumulation.** Adding new guardrails without retiring stale ones. The document is now at 50 rules — the cap in Section 34.8 is hard: new rules require a retirement or a P0.
- **Ownership gaps.** A cluster with no named owner. Blocks the next release.
- **Unstaffable process.** Adding a cadence, board, or rotation that 2–4 engineers cannot run. This is the failure V7 shipped and V8 removed; do not reintroduce it.

### 34.10 Tooling

The protocol is supported by three pieces of tooling, all of which must be in place before the end of M7 (Observability) in Section 29:

1. **`guardrail-audit.yml` CI job** — runs checks 1–30 from Section 34.4 on every PR and on every release branch, reads `docs/audit/waivers.md`, and fails on any unwaived failure. A custom action wrapping `rg`, `tsc`, `vitest`, and a D1 schema introspection script.
2. **`docs/audit/` directory** — holds release records, monthly Owner notes, waivers, and GV incident links. Commit-only.
3. **Guardrail dashboard** — a single page in the staff dashboard (`/staff/guardrails`) showing the four clusters, current owners, open waivers, and the last 30 days of GV incidents. Read-only; **RBAC `guardrails.view` required — not `reports.view`** (C-08). Under `reports.view`, a Viewer could see violation history while a Staff member could not, inverting the trust hierarchy.

---

## 35. D1 Migration Sequencing Plan

**The authoritative migration specification is `V8_MIGRATION_PLAN.md`.** It contains, for every migration: forward SQL, rollback SQL, a pre-flight query that returns zero rows when it is safe to apply, test fixture assertions, a risk class re-rated against a **non-empty** production database, and the dependency order. Where this section and that file differ, that file wins. This section states only the rules that govern it.

### 35.1 Migration Numbering and Layout

| Property | Convention |
|---|---|
| File location | `db/migrations/{NNNN}_{short_slug}.sql` |
| Rollback file | `db/migrations/rollback/{NNNN}_{short_slug}.rollback.sql` (mandatory for every migration) |
| Pre-flight file | `db/migrations/preflight/{NNNN}_{short_slug}.preflight.sql` (mandatory for every migration) |
| Numbering | Zero-padded 4-digit, monotonically increasing, never reused, **numbered against the real repository head**. The repository head is `0039`; V8 migrations run `0040` upward. |
| Statements per file | **Exactly one.** |
| Test fixture | `db/migrations/tests/{NNNN}_{short_slug}.test.ts` — runs against D1 local in CI before merge |
| Status field | Every applied migration is recorded in `_migrations`: `(id, applied_at, sha256, rollback_sha256)` |

Three V7 rules are corrected here:

1. **There is no plan-number-to-repo-number mapping.** V7 said plan numbers `0024`–`0027` map to repo files `0021`–`0024`, while also requiring that a new migration be exactly one greater than the highest existing number. Both cannot hold: the repository already contained those files with different content, so `_migrations.sha256` would mismatch and CI gate #6 would fail on every schema PR. The mapping paragraph is deleted. Plan numbers *are* repo numbers (RT-010, M-01).
2. **One statement per file.** D1 migrations are not transactional. A file with `ALTER TABLE` followed by `CREATE UNIQUE INDEX` can half-apply, and a rollback file that only drops the index leaves a schema the diff script accepts and the code does not expect (M-04, CF-03).
3. **A pre-flight is a query that returns zero rows when safe.** `PRAGMA table_info(...)` followed by "inspect the result" is a human eyeball step, not a CI gate, and a `PRAGMA` never returns zero rows (M-03).

Editing an applied migration is FORBIDDEN per Section 26.3. A change to an applied migration requires a new forward migration that supersedes it.

### 35.2 Migration Sequence

The full sequence with SQL is in `V8_MIGRATION_PLAN.md`. Summary, in dependency order:

| # | Slug | Delivers | Finding | Risk (non-empty prod) |
|---|---|---|---|---|
| 0040 | `stock_reservations_add_checkout_id` | `stock_reservations.checkout_id` | RT-002 | Low |
| 0041 | `drop_idx_stock_reservations_order_active` | Drops the wrong-grain index | RT-002 | Medium |
| 0042 | `create_idx_stock_res_order_variant_active` | `(order_id, variant_id) WHERE status='active' AND order_id IS NOT NULL` | RT-002 | Medium |
| 0043 | `create_idx_stock_res_checkout_variant_active` | `(checkout_id, variant_id) WHERE status='active'` | RT-002 | Medium |
| 0044 | `orders_add_reservation_expires_at` | `orders.reservation_expires_at` | RT-001, F-02 | Low |
| 0045 | `orders_add_payment_status` | `orders.payment_status` | F-05 | Low |
| 0046 | `orders_add_fraud_score` | `orders.fraud_score` | Section 4 | Low |
| 0047 | `orders_add_fraud_source` | `orders.fraud_source` | Section 4 | Low |
| 0048 | `orders_add_created_by_staff_id` | `orders.created_by_staff_id` | Section 4 | Low |
| 0049 | `orders_add_staff_override` | `orders.staff_override` | Section 4 | Low |
| 0050 | `payment_events_add_provider` | `payment_events.provider` | F-01 | Low |
| 0051 | `payment_events_add_provider_event_id` | `payment_events.provider_event_id` | F-01 | Low |
| 0052 | `create_idx_payment_events_provider_event` | `UNIQUE(provider, provider_event_id)` | F-01 | **High** |
| 0053 | `create_payment_transactions` | Settled-money ledger + `payment_event_id` uniqueness | F-03, RV8-001 | Low |
| 0054 | `create_coupon_redemptions` | Redemption table | RT-007 | Low |
| 0055 | `create_idx_coupon_redemptions_coupon_order` | `UNIQUE(coupon_id, order_id)` | RT-007 | Low |
| 0056 | `create_tax_rates` | Effective-dated VAT | C-09 | Low |
| 0057 | `seed_tax_rates` | Seed row(s) — separate file, per M-04 | C-09 | Low |
| 0058 | `cart_activity_add_cart_version` | `cart_activity.cart_version` | CF-04 | Low |
| 0059 | `create_courier_shipments` | COD parcel tracking | F-03 | Low |
| 0060 | `create_courier_cod_remittance` | COD remittance | F-03 | Low |
| 0061 | `create_pos_cash_drawer_sessions` | Z-report | F-09 | Low |
| 0062 | `create_suppliers` | Supply chain | RT-003 | Low |
| 0063 | `create_purchase_orders` | Supply chain | RT-003 | Low |
| 0064 | `create_goods_receipts` | Supply chain | RT-003 | Low |
| 0065 | `returns_add_restocked_at` | Restock timestamp | C-06 | Low |
| 0066 | `product_variants_add_cost_paisa` | COGS groundwork | Section 8 | Low |
| 0067 | `create_trg_refund_cap` | Refund-cap trigger | F-03 | Medium |
| 0068 | `drop_csrf_nonces` | Retires the unused CSRF table | S-10 | Medium |
| — | *(withdrawn — see note)* | `invoices.idempotency_key` already exists in `db/migrations/0016_invoices.sql` as `UNIQUE`; no migration needed. RV8-002's POS replay guard implements against the existing column (RR-03). | RV8-002 | — |
| 0069 | `seed_site_settings_commerce_defaults` | Seed COD ceiling, COD velocity, and return-window rows into the existing site_settings table | RV8-006 | Low |
| 0070 | `seed_ai_budget_limits_imagify` | `imagify` budget defaults | C-14 | Low |
| 0071 | `drop_variants_view` | Remove compatibility view after code is clean | C-15 | Low |

Migration `0069` MUST NOT create `site_settings`; Section 6.1 is canonical that the table already exists. Migration `0069` MUST be a single INSERT/UPSERT statement that seeds the V8 rows.

Migrations `0041`–`0043` MUST be applied as a set in a single maintenance window: between `0041` and `0042` the table has no uniqueness protection at all.

### 35.3 Sequencing and Milestone Mapping

| Migrations | Milestone | Phase | Blocking |
|---|---|---|---|
| 0040–0044 | M4 Inventory | Phase 1 | Reservation lifecycle and cleanup cron. **These are the P0 set — nothing ships before them.** |
| 0045–0049 | M2/M5 | Phase 1 | Order state machine, staff order ownership, fraud fields |
| 0050–0053 | M3 Payment | Phase 1 | Webhook idempotency and the money ledger |
| 0054–0055 | M2 Checkout | Phase 1 | Coupon redemption inside the order batch |
| 0056–0057 | M2 Checkout | Phase 1 | VAT computation |
| 0058 | M9 Email | Phase 2 | Abandoned-cart projection correctness |
| 0059–0061 | M10/M11 | Phase 2 | COD remittance, Z-report |
| 0062–0064 | M4/M10 | Phase 1–2 | Goods receipt path |
| 0065–0066 | M10 | Phase 2 | Return restock, COGS groundwork |
| 0067 | M10 | Phase 2 | Refund cap |
| 0068 | M6 Security | Phase 2 | CSRF simplification |
| — | M11 POS | Phase 2 | POS sale retry idempotency — no migration; `invoices.idempotency_key` already exists (RR-03) |
| 0069 | M2 Checkout / M10 Returns | Phase 1–2 | Owner-editable COD and return-window settings |
| 0070 | M7 Observability | Phase 2 | Imagify budget defaults |
| 0071 | M10/M12 cleanup | Phase 2 | Retire the `variants` compatibility view |

### 35.4 Migration CI Gate

Every migration PR must pass these checks before merge, in addition to Section 26.2:

1. **Exactly one statement** in the forward file. A file with two statements fails.
2. **Forward SQL runs cleanly** against a fresh D1 local instance.
3. **Rollback SQL runs cleanly** against an instance that has just had the forward SQL applied. After rollback the schema must match the pre-migration schema, honouring documented `-- ROLLBACK_EXCEPTION:` markers for additive columns left in place.
4. **Test fixture passes.**
5. **Invalid-insert tests** — for every NOT NULL, FK, CHECK, and UNIQUE constraint, an insert that violates it must fail. This is the constraint test referenced in Guardrail #32.
6. **Pre-flight query exists and returns zero rows** against staging data. A pre-flight that cannot return zero rows (for example a bare `PRAGMA`) fails this gate.
7. **Numbering** — `NNNN` is exactly one greater than the highest number in `db/migrations/`. No gaps, no reuse. The check runs against the repository directory, not against this document.
8. **Rollback file exists** and is non-empty.
9. **`_migrations` insertion** — the runner inserts id, applied timestamp, forward SHA-256, and rollback SHA-256.

A migration PR that fails any check is blocked. No role can override this gate.

### 35.5 Migration Apply Procedure (Staging → Production)

| Step | Action | Owner | Soak |
|---|---|---|---|
| 1 | `wrangler d1 migrations apply zabir-dev-db --local` then `--remote` | PR author | N/A |
| 2 | Dev smoke tests: product page, cart, checkout, staff login, POS | PR author | 30 min |
| 3 | Run the pre-flight against **production** (read-only) and confirm zero rows | Cluster 2 Owner | N/A |
| 4 | `wrangler d1 migrations apply zabir-staging-db --remote` | PR author | N/A |
| 5 | Staging constraint tests (the invalid-insert suite) | Cluster 2 Owner | 1h |
| 6 | **24-hour soak** for any migration rated Medium or High | Cluster 2 Owner | 24h |
| 7 | Owner sign-off for High-risk migrations only | Owner | N/A |
| 8 | Confirm a fresh D1 export **and** a fresh DO snapshot exist (Section 27.2) | PR author | Until verified |
| 9 | `wrangler d1 migrations apply zabir-prod-db --remote` in the agreed window | PR author + Cluster 2 Owner | N/A |
| 10 | Post-deploy verification: smoke tests + the migration's own fixture against production | PR author | 30 min |
| 11 | Update the release record (Section 34.5) | PR author | N/A |

Step 3 is new and is the fix for M-06: a pre-flight run only against staging proves nothing about production data. The soak in step 6 is driven by the risk rating **against a non-empty production database** — V7 exempted its additive migrations by assuming an empty database, which this system is not (CF-12).

### 35.6 Migration Failure Recovery

1. **Do not panic-rollback.** Capture the exact error, the runner state, and the current schema (`PRAGMA table_info` on affected tables).
2. **Assess blast radius.** With one statement per file, a migration either applied or it did not — the half-applied state that made V7's recovery ambiguous is now structurally impossible.
3. **If the statement applied but verification failed:** apply the rollback. If the rollback fails, this is a P0 incident.
4. **If the statement did not apply:** fix forward. Do not renumber; open a new migration.
5. **Restore only as a last resort** — prefer D1 Time Travel to the pre-migration timestamp (Section 27.3), which is far cheaper than a dump restore and loses far less.

#### `_migrations` SHA-256 Reconciliation Runbook (M-09)

A `sha256` mismatch means the file on disk differs from the file that was applied. It is not self-healing and V7 had no procedure for it.

| Situation | Action |
|---|---|
| Mismatch on a migration that was edited after being applied | The edit is the bug. Restore the file from git history to the applied version, confirm the SHA matches, then write a **new** forward migration for the intended change. |
| Mismatch after a renumbering | Do not rewrite `_migrations`. Add a superseding migration and record the reconciliation in `docs/audit/`. |
| Mismatch with no known cause | Treat as a P1 integrity incident: freeze schema PRs, diff the applied schema against a fresh build of all migrations, and reconcile before any further apply. |

Never `UPDATE _migrations` to make a mismatch disappear. The runbook lives at `docs/runbooks/migrations-sha-reconciliation.md`.


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
├── idempotency-do.ts            // IdempotencyDO interface (Section 36.7a)
├── invoice-counter-do.ts        // InvoiceCounterDO interface (Section 36.7b)
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
   * Idempotency per Section 11.3: a repeated call with the same invoice_id, variant_id, and quantity returns `{ success: true, replayed: true }`; a repeated call with a different quantity returns `{ error: 'CONFLICT' }`.
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
    | { success: true; replayed?: false }
    | { success: true; replayed: true }
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
   * Compensating transaction for online orders cancelled after confirmation.
   *
   * Decrements the sold units created by confirm(). Does not change stock or reserved.
   * Writes a stock_adjustments row with reason = 'order_cancel_reversal'
   * and emits a P1 audit event. This is the ONLY way to undo the stock effect
   * of an online confirm().
   *
   * Idempotent on order_id + variant_id + quantity: a second call with the
   * same triple returns the original audit_event_id without re-applying.
   */
  reverseConfirm(input: {
    variant_id: string;
    quantity: number;
    order_id: string;
    reason: string; // 'order_cancel_after_confirmation' | ...
    staff_id: string;
  }): Promise<
    | { reversed: true; audit_event_id: string }
    | { reversed: false; audit_event_id: string; message: 'already_reversed' }
  >;

  /**
   * Adjust total stock. The ONLY way stock enters or leaves outside of
   * sales (Section 11.3, RT-003). Covers return restock, goods receipt,
   * stocktake, damage, theft, and correction.
   *
   * Writes a stock_adjustments row and an audit_log entry.
   * Idempotent on adjustment_id: a repeat call returns { applied: false }
   * with the original new_stock.
   *
   * Rejects with APPROVER_REQUIRED when delta < 0 and
   * approved_by_staff_id === staff_id (two-person rule, Section 14.1).
   */
  adjustStock(input: {
    variant_id: string;
    delta: number;               // positive = receive/restock, negative = write-off
    reason: 'return_restock' | 'goods_receipt' | 'stocktake'
          | 'damage' | 'theft' | 'correction';
    reference_id?: string;       // return_id, purchase_order_id, invoice_id
    staff_id: string;
    approved_by_staff_id: string;
    adjustment_id: string;       // idempotency key
  }): Promise<
    | { applied: boolean; new_stock: number; adjustment_id: string }
    | { error: 'APPROVER_REQUIRED' | 'NEGATIVE_STOCK' }
  >;

  /**
   * Disaster recovery only (Section 27.3, RT-004). Overwrites the DO
   * counters from an R2 snapshot captured alongside the D1 backup.
   *
   * Gated by env.DR_RESTORE_ENABLED; returns { error: 'RESTORE_DISABLED' }
   * when the flag is unset. Writes a P1 audit_log entry on every call.
   * Idempotent on snapshot_id.
   */
  restoreFromSnapshot(input: {
    stock: number;
    reserved: number;
    sold: number;
    snapshot_id: string;
  }): Promise<
    | { restored: true; snapshot_id: string }
    | { error: 'RESTORE_DISABLED' }
  >;

  /**
   * Current availability for the variant. Used by staff dashboards and by
   * the DO snapshot cron. The PUBLIC stock endpoint MUST convert this to a
   * band (in_stock | low | out) and never expose exact counts (Section 2.2).
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
 * One Durable Object instance PER PROVIDER. The object ID format is:
 *   `budget:{provider}`
 * and nothing else (C-04). Three competing formats in V7 meant the
 * pre-flight read one object while the write updated another, so the
 * budget was never actually enforced.
 *
 * A single object holds BOTH buckets — daily and monthly (C-05). A
 * period-keyed object has no visibility into the monthly total, which made
 * the monthly limit unenforceable while recordUsage() claimed to return
 * both totals from one instance.
 *
 * Buckets roll inside the object: on every call the DO compares the stored
 * daily_period_key (YYYY-MM-DD, UTC) and monthly_period_key (YYYY-MM, UTC)
 * against the current keys and zeroes whichever has changed, before
 * evaluating limits. Config is read from D1 `ai_budget_limits` on the first
 * call after a roll and cached in-DO.
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
 *
 * Session binding (RT-005, S-02):
 *   - Bound to sha256(__Host-bn_bind cookie secret), NOT to Origin or User-Agent.
 *   - Origin is verified by the ROUTE HANDLER on state-changing POSTs only,
 *     never on GET. Browsers omit Origin on same-origin top-level GET
 *     navigation, so a GET-time check 403s the first page load.
 *   - There is no user_agent_hash. The check is deleted, not relaxed.
 *   - No session identifier appears in any URL.
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
  binding_hash: string; // sha256(__Host-bn_bind cookie secret) — the ONLY binding
  order_id?: string; // set on successful order creation, triggers immediate delete
}

export interface DirectCheckoutSessionDO {
  /**
   * Create a new session. Generates session_id as HMAC(secret, timestamp + random)
   * and a binding_secret the caller returns as the __Host-bn_bind HttpOnly cookie.
   * Stores only sha256(binding_secret). Arms a 30-minute alarm.
   */
  create(input: {
    product_id: string;
    variant_id: string;
    quantity: number;
    selected_options: Record<string, string>;
    source_page: string;
    utm_params?: Record<string, string>;
    binding_secret: string; // hashed on write; never persisted in the clear
  }): Promise<{ session_id: string; expires_at: string }>;

  /**
   * Read the current session state. Verifies sha256(binding_secret) against
   * the stored binding_hash. Callers on a GET path MUST treat BINDING_MISMATCH
   * and SESSION_NOT_FOUND identically: render a fresh page. They MUST NOT
   * return 403 and MUST NOT delete the DO (RT-005).
   */
  get(input: {
    session_id: string;
    binding_secret: string;
  }): Promise<
    | { state: DirectCheckoutSessionState }
    | { error: 'SESSION_NOT_FOUND' | 'SESSION_EXPIRED' | 'BINDING_MISMATCH' }
  >;

  /**
   * Update the form draft (customer is filling out the order form).
   * Verifies the binding. This is a POST path, so the route handler ALSO
   * verifies the Origin header before calling this method.
   */
  updateFormDraft(input: {
    session_id: string;
    form_draft: Record<string, string>;
    binding_secret: string;
  }): Promise<{ updated: boolean } | { error: 'SESSION_NOT_FOUND' | 'BINDING_MISMATCH' }>;

  /**
   * Mark the session as converted (order created). Sets state.order_id and
   * IMMEDIATELY deletes all DO storage. The alarm is cancelled.
   * Verifies sha256(binding_secret) against the stored binding_hash.
   *
   * Return type is `Promise<{ deleted: true }>` (always true on success) — the
   * boolean is not optional because the prose contract says deletion is
   * immediate and unconditional on success. A failure to delete would throw
   * rather than return `deleted: false`.
   */
  markConvertedAndDelete(input: {
    session_id: string;
    order_id: string;
    binding_secret: string;
  }): Promise<
    | { deleted: true }
    | { error: 'SESSION_NOT_FOUND' | 'BINDING_MISMATCH' }
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
 * Alarm contract (mandatory, Section 6.3 / 9.1, RT-006):
 *   - A Durable Object has EXACTLY ONE alarm. setAlarm() overwrites any
 *     pending alarm, so the two-stage design in V7 was not implementable.
 *   - DO storage holds `alarm_purpose`: 'persist' | 'cleanup'.
 *   - Every mutation calls armAlarm('persist') (now + 5 min), superseding
 *     any pending 'cleanup'.
 *   - When 'persist' fires: upsert cart_activity, then armAlarm('cleanup')
 *     (now + 30 days). It MUST NOT re-arm 'persist'.
 *   - When 'cleanup' fires: final cart_activity write, then deleteAll().
 *   - DO storage is already durable across restart and eviction. The alarm
 *     keeps the D1 projection fresh; it is NOT a durability mechanism (C-02).
 *   - Both cart_activity writers carry cart_version and use a
 *     version-conditional upsert (CF-04).
 */

export type AlarmPurpose = 'persist' | 'cleanup';

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
   * Checkout read. Returns the cart together with the cart_version observed.
   * Checkout MUST pass that version back when it reserves stock (Section 11.1
   * step 14); if the cart mutated in between, checkout aborts with
   * CART_VERSION_CONFLICT before any stock is held.
   *
   * getCart() offers no such guarantee, which left a window between the
   * checkout read and the reservation in V7.
   */
  getCartForCheckout(input: { session_id: string }): Promise<
    | { state: CartState; cart_version: number }
    | { error: 'CART_NOT_FOUND' | 'CART_EMPTY' }
  >;

  /**
   * NOT IMPLEMENTED in V8 — blocked on DECISION REQUIRED (D-01), Section 10.6.
   *
   * mergeCart() presumes a logged-in customer. There is no `customers` table,
   * no customer session specification, no customer role in the RBAC table, and
   * no customer-auth milestone (C-07). The method is declared so the gap is
   * visible in the contract rather than hidden, and any implementation MUST
   * throw NOT_IMPLEMENTED until D-01 is answered.
   */
  mergeCart(input: {
    source_session_id: string;
    target_session_id: string;
    target_cart_version: number;
  }): Promise<{ error: 'NOT_IMPLEMENTED' }>;

  /**
   * Arm the single alarm with an explicit purpose. Stores alarm_purpose in
   * DO storage, then setAlarm(). See the alarm contract above.
   */
  armAlarm(purpose: AlarmPurpose): Promise<void>;

  /**
   * Single alarm handler. Branches on the stored alarm_purpose:
   *   - 'persist': upsert cart_activity, then armAlarm('cleanup'). Never re-arm 'persist'.
   *   - 'cleanup': final cart_activity write, then deleteAll().
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

### 36.7a `idempotency-do.ts`

V7 listed this file in the directory layout, omitted it from the barrel, and specified the claim/complete/replay contract only as prose in Section 11.1. It is a checkout-critical object with no interface, which is how a stuck claim becomes an undefined behaviour.

```ts
// src/lib/contracts/idempotency-do.ts

/**
 * IdempotencyDO contract — Section 11.1 steps 1, 17, 18.
 *
 * One Durable Object instance per scoped Idempotency-Key (object ID: `idem:{scope}:{idempotency_key}`). `scope` is the checkout session identity: cart session_id, Buy Now session_id, or staff session_id. A raw client-supplied key MUST NOT be used as a global object ID.
 * Single alarm, purpose 'expire': storage is deleted 2 hours after the
 * operation completes (reduced from V7's 24 hours per the cost model in
 * Section 2.2 — every checkout attempt otherwise holds an object for a day).
 */

export type IdempotencyStatus = 'claimed' | 'completed' | 'failed';

export interface IdempotencyDO {
  /**
   * Atomically claim the scoped key. Exactly one caller for the same `scope + idempotency_key` receives { claimed: true }.
   *
   * A second caller receives the current status:
   *   - 'completed' → the stored response, which the caller MUST return verbatim.
   *   - 'claimed'   → IN_FLIGHT. The caller returns 409 and the client retries.
   *                   If claimed_at is older than claim_ttl_seconds, the claim
   *                   is considered abandoned (the Worker died between claim and
   *                   complete) and is re-granted to this caller. This is the
   *                   stuck-claim resolution V7 never defined.
   *   - 'failed'    → the claim is re-granted.
   */
  claim(input: {
    scope: string;
    idempotency_key: string;
    claim_ttl_seconds: number; // 60
  }): Promise<
    | { claimed: true }
    | { claimed: false; status: 'completed'; response_json: string }
    | { claimed: false; status: 'claimed'; error: 'IN_FLIGHT' }
  >;

  /** Store the successful response and arm the 2-hour expiry alarm. */
  complete(input: {
    scope: string;
    idempotency_key: string;
    order_id: string;
    response_json: string;
  }): Promise<{ completed: true }>;

  /** Mark the claim failed and released, so a retry may proceed immediately. */
  fail(input: {
    scope: string;
    idempotency_key: string;
    reason: string;
  }): Promise<{ failed: true }>;

  /** Alarm handler: deleteAll() after the retention window. */
  alarm(): Promise<void>;
}

export type IdempotencyDOClass = new (state: DurableObjectState, env: Env) =>
  DurableObject & IdempotencyDO;
```

### 36.7b `invoice-counter-do.ts`

```ts
// src/lib/contracts/invoice-counter-do.ts

/**
 * InvoiceCounterDO contract — Section 15.5 (RT-008).
 *
 * One Durable Object instance per UTC day (object ID: `invoice-counter:{YYYYMMDD}`).
 * The ONLY legal source of invoices.receipt_no. D1 has no SELECT ... FOR UPDATE,
 * so a read-modify-write on daily_invoice_counters is not safe under concurrency.
 */
export interface InvoiceCounterDO {
  /**
   * Issue the next serial for the day. Serials are strictly increasing and
   * never re-issued. If the caller's D1 invoice write fails, the serial is
   * BURNED (recorded in invoice_audit as 'serial_burned'), not reused:
   * a gap is acceptable to an auditor, a duplicate is not.
   */
  nextInvoiceNumber(input: {
    staff_id: string;
  }): Promise<{ receipt_no: string; seq: number }>;

  /** Read-only, for the staff dashboard. */
  getCurrentSeq(): Promise<{ seq: number; date_key: string }>;

  /** Alarm handler: deleteAll() 48h after the day ends. */
  alarm(): Promise<void>;
}

export type InvoiceCounterDOClass = new (state: DurableObjectState, env: Env) =>
  DurableObject & InvoiceCounterDO;
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
  AlarmPurpose,
} from './cart-do';

export type {
  IdempotencyDO,
  IdempotencyDOClass,
  IdempotencyStatus,
} from './idempotency-do';

export type {
  InvoiceCounterDO,
  InvoiceCounterDOClass,
} from './invoice-counter-do';

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

## 37. Test Matrix

V7's test investment was misallocated: 25 tests, all on the FraudBD circuit breaker, and **no oversell test anywhere** — despite "No overselling" being priority #1 in Section 1. The circuit breaker suite is genuinely good and is kept in full (Section 37.1). Section 37.0 adds the tests that cover the P0 and P1 paths that had none.

### 37.0 Mandatory Test Matrix

Every test below is mandatory. A PR touching the named area cannot merge while its test fails or is absent. Tests are listed in build order; **test #1 is written first, before any of the fixes it covers are implemented**, because it proves the platform's primary claim.

| # | Test | Asserts | Covers |
|---:|---|---|---|
| 1 | `reservation-oversell-concurrency.test.ts` | N concurrent `reserve()` calls on one variant with stock N−1: exactly N−1 succeed and exactly one returns `INSUFFICIENT_STOCK`. Repeat at N = 2, 10, 50. | The core no-overselling claim in Section 1 — **untested in V7** |
| 2 | `reservation-cron-pending-review.test.ts` | Create a `pending_review` order, advance the clock 90 minutes, run the cleanup cron: `getAvailability()` still shows the units reserved | RT-001 |
| 3 | `reservation-multi-variant.test.ts` | A 3-variant order writes 3 active reservation rows sharing one `order_id` and all succeed; a second active row for the same `(order_id, variant_id)` fails | RT-002 |
| 4 | `reservation-checkout-retry-guard.test.ts` | Two `reserve()` calls with the same `checkout_id` and `variant_id` while the first is active: the second fails at the D1 constraint | RT-002 |
| 5 | `reservation-window-outlasts-payment.test.ts` | For every order-creation path, `reservation_expires_at − created_at > payment_window + reconcile_interval` | F-02 |
| 6 | `return-restock.test.ts` | Approving a return increases `getAvailability().stock` by exactly the returned quantity and writes a `stock_adjustments` row. A negative adjustment with `approved_by_staff_id === staff_id` is rejected | RT-003 |
| 7 | `dr-do-d1-parity.test.ts` | Restore D1 from a snapshot, restore DO counters from the matching R2 snapshot, then assert per-variant DO/D1 stock parity — not row counts | RT-004 |
| 8 | `buy-now-no-origin-header.test.ts` | A top-level GET with no `Origin` header returns 200 and the session survives; the DO is not deleted | RT-005 |
| 9 | `buy-now-session-fixation.test.ts` | A request carrying a valid `__Host-bn_sid` but a wrong or absent `__Host-bn_bind` cannot read `form_draft`; a POST from a foreign `Origin` is rejected | RT-005, S-02 |
| 10 | `cart-do-alarm-handoff.test.ts` | After the persist alarm fires, `getAlarm()` returns a timestamp ~30 days out, not ~5 minutes | RT-006 |
| 11 | `coupon-rollback.test.ts` | Force `INSUFFICIENT_STOCK` after coupon validation: `coupon_redemptions` has zero rows and remaining usage is unchanged | RT-007 |
| 12 | `pos-invoice-number-concurrency.test.ts` | 20 concurrent `directSale` + invoice creations produce 20 distinct sequential serials | RT-008 |
| 13 | `catalog-publish-latency.test.ts` | Publish a product through the staff API; the public URL returns 200 with the new content within 60 seconds | RT-009 |
| 14 | `payment-webhook-replay.test.ts` | Deliver the same signed event three times: one `payment_events` row, one `payment_transactions` row, one credit, including a simulated consumer crash-and-redeliver between the ledger write and the ack | F-01, RV8-001 |
| 15 | `idempotency-stuck-claim.test.ts` | Kill the Worker between claim and complete; a retry with the same key resolves deterministically once `claim_ttl_seconds` elapses | Missing entirely in V7 |
| 16 | `cart-activity-out-of-order-upsert.test.ts` | Deliver queue messages B then A: `cart_activity` does not regress and `last_cart_update_at` never moves backwards | CF-04 |
| 17 | `cod-split-order-velocity.test.ts` | Five sequential 2-item COD orders from one phone: the velocity rule blocks. A single order above `MAX_COD_VALUE_PAISA` is refused COD | S-04 |
| 18 | `vat-discount-rounding.test.ts` | Per-line `vat_paisa` sums exactly to `orders.vat_paisa` across 1,000 randomized discounted carts; the taxable base is post-discount; rounding is half-up | F-06 |
| 19 | `budget-counter-id-format.test.ts` | `canUseDeepSeek()` and `recordUsage()` resolve to the same DO instance; the monthly bucket is visible to a call made on any day | C-04, C-05 |
| 20 | `migration-single-statement.test.ts` | Every file in `db/migrations/` contains exactly one statement, has a rollback file, and has a pre-flight file whose query returns zero rows against staging | M-04, M-03 |
| 21 | `redaction.test.ts` | A fixture containing `+8801XXXXXXXXX`, a Dhaka address, and an API key passes through every log sink with no leak | S-12 |
| 22 | `forged-totals.test.ts` | A checkout body carrying `total_paisa`, `vat_paisa`, `discount_paisa`, or `delivery_paisa` is rejected by the `.strict()` schema; server values win | Guardrails #3, #4 |
| 23 | `pos-sale-retry-idempotency.test.ts` | `directSale` + invoice write succeed, response lost, retry with the same idempotency key: exactly one invoice, one serial, one stock deduction; second `directSale` returns `replayed: true` | RV8-002 |
| 24 | `buy-now-host-cookie-tossing.test.ts` | A request presenting session cookies without the `__Host-` prefix is ignored; a simulated subdomain-set cookie cannot read `form_draft`; cookie attributes assert `Secure`, `Path=/`, no `Domain`, `SameSite=Lax` | RV8-003 |
| 25 | `cron-never-releases-live-order.test.ts` | An order past `reservation_expires_at` but not cancelled survives the cleanup cron; reconciliation cancels it and releases atomically | RV8-005, C-12 |
| 26 | `payment-after-cancellation-refund.test.ts` | Provider confirms payment after local cancellation: order stays cancelled, refund is initiated, refund ledger row written, P1 alert raised | RV8-008 |
| 27 | `prepay-split-rounding.test.ts` | Odd `total_paisa` values split as `advance_paisa = floor(total_paisa / 2)` and `balance_paisa = total_paisa - advance_paisa`; invariant holds | C-10 |
| 28 | `idempotency-cross-session-isolation.test.ts` | Two different checkout scopes using the same client idempotency key do not return each other's completed response; claim is scoped by `scope` and `idempotency_key` | Idempotency key scoping |
| 29 | `owner-totp-enforcement.test.ts` | Owner login without TOTP fails; Owner without an `otp_secrets` row enters forced enrollment and cannot receive an Owner session; backup code is one-time | Owner TOTP enforcement |
| 30 | `online-confirmed-cancel-reversal.test.ts` | Confirm an order (reserved→sold), then cancel the confirmed order: `reverseConfirm()` decrements sold exactly once, replay returns already_reversed, and stock/reserved remain unchanged | Confirmed online order cancellation stock reversal |
| 31 | `coupon-usage-limit-concurrency.test.ts` | usage_limit = 1; 5 concurrent checkouts with the same coupon: exactly 1 succeeds, 4 receive 409 COUPON_LIMIT_REACHED; coupons.redeemed_count = 1 | Coupon global usage race |

Guardrails #3 and #4 were previously unenforceable ("never move pricing authority to the browser" is semantic and no lint can detect it). Test #22 plus a `.strict()` Zod schema makes them mechanical: the assertion is that the schema rejects unknown keys.

### 37.1 FraudBD Circuit Breaker Fixtures

Section 11.2 specifies the FraudBD circuit breaker rules. This section defines the exact CI test matrix that proves the implementation conforms. Every test below is mandatory and must pass on every PR that touches the FraudBD adapter, `ProviderHealthDO`, or the checkout fraud-check path. Tests live in `tests/fraudbd-circuit-breaker/`.

#### Circuit Breaker Test Matrix

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

A failing test blocks the PR. No role can override this gate; an Owner-approved waiver (Section 34.7) is the only path to ship with a failing FraudBD test.

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

When the V8 plan lands, the team almost certainly has in-flight PRs that pre-date the new rules. This section is the playbook for auditing those PRs before merge so they don't reintroduce contradictions. It is also the playbook for periodic drift audits (nightly per Section 38.5) to catch silent drift in the main branch.

### 38.1 Audit Triggers

Run the audit when any of the following is true:

1. The V8 Master Plan was just merged — audit every open PR.
2. A new guardrail was added or amended (Section 34.8) — audit every open PR in the affected cluster.
3. Nightly drift audit — audit the main branch.
4. Pre-release audit (Section 34.4) — audit the release branch.
5. Ad-hoc: a Cluster Owner requests an audit of a specific PR or service.

### 38.2 Drift Findings Catalog

The findings below are the known drift patterns (46 codes, D-01 to D-46). Each has a stable finding code (`D-NN`) for tracking in `docs/audit/`. New drift patterns discovered in the wild are added here with a new code.

| Code | Finding | Detection method | Fix |
|---|---|---|---|
| D-01 | `output: 'static'` in `astro.config.mjs`, docs, or generated notes | `rg "output:\s*'(static\|hybrid)'" --glob '!**/*.md' -t ts -t tsx -t js -t mjs` (excludes the master plan and docs/ — the plan's own FORBIDDEN references are documentation, not drift) | Replace with `output: 'server'`. Delete any prose justifying `static` (it's wrong post-V7). |
| D-02 | `export const prerender = false` in any route file | `rg "prerender\s*=\s*false" src/pages/` | Delete the line. Dynamic routes are dynamic by default under `output: 'server'`. |
| D-03 | Prerendered-route set differs from the Section 3.3 five | AST scan of `src/pages/**/*.{astro,ts}` cross-referenced with Section 3.4 | The set MUST equal `{/about, /privacy, /terms, /return-policy, /size-guide}`. A `prerender = true` on a catalog route is a P0 — it breaks publishing (RT-009). A missing one on a legal route is a P2. |
| D-04 | Reference to `abandoned_1h_sent_at` or `abandoned_24h_sent_at` in code or migration | `rg "abandoned_1h_sent_at\|abandoned_24h_sent_at"` | Replace with `abandoned_email_sent_at` (single 24h touch). Add a forward migration to drop the old columns if they exist in production. |
| D-05 | CartDO mutation that does NOT call `armAlarm('persist')`, or a `'persist'` handler that re-arms itself | Code review of `src/durable-objects/cart-do.ts` plus `cart-do-alarm-handoff.test.ts` | Every mutation calls `armAlarm('persist')`; the `'persist'` branch hands off to `'cleanup'` and never re-arms itself (RT-006). A re-arm loop is a P0 cost defect. |
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
| D-17 | `DirectCheckoutSessionDO` binding drift: any `user_agent_hash` reference, an `Origin` check on a GET path, a `sid` in a URL, or stale contract docstrings claiming User-Agent binding | `rg "user_agent_hash\|[?&]sid=" src/ src/lib/contracts/` plus code review of `get`, `updateFormDraft`, `markConvertedAndDelete` | Bind on `sha256(__Host-bn_bind)` only. `Origin` on POSTs only. No session id in any URL. A GET must never 403 (RT-005, S-02, RV8-009). |
| D-18 | `DirectCheckoutSessionDO` not deleted after order creation | Code review of the checkout flow | Call `markConvertedAndDelete` immediately after D1 order write succeeds. |
| D-19 | VAT computed from the wrong base, the wrong source, or without line allocation | `rg "VAT_RATE_PERCENT"` plus `vat-discount-rounding.test.ts` | Rate from D1 `tax_rates`; base `subtotal − discount`; half-up integer rounding; largest-remainder line allocation. Any `VAT_RATE_PERCENT` hit outside the changelog is a P0 (F-06, C-09). |
| D-20 | Browser-supplied VAT accepted | `rg "vat" src/pages/checkout*` and check request parsing | Strip VAT from any client-supplied data; always recompute server-side. |
| D-21 | Reservation cleanup cron schedule ≠ hourly | `wrangler.toml` cron config | Set `crons = ["0 * * * *"]` for the reservation-cleanup worker. |
| D-22 | Reservation cleanup query releases live orders' reservations | Code review of the cron handler plus `cron-never-releases-live-order.test.ts` | The query MUST join `orders` and release only orphans (`order_id IS NULL AND created_at < datetime('now','-15 minutes')`) or cancelled orders. Reconciliation, not cleanup cron, owns attached-order expiry. A bare 15-minute filter is a **P0 oversell defect** (RT-001, RV8-005). |
| D-23 | Wrong reservation index shape, or the retired index still present | D1 `PRAGMA index_list('stock_reservations')` plus `rg "idx_stock_reservations_order_active"` | Both `idx_stock_res_order_variant_active` and `idx_stock_res_checkout_variant_active` must exist; the retired name must return zero hits outside the changelog. Apply 0041–0043 (RT-002). |
| D-24 | `stock_reservations` missing `release_requested_at` or `checkout_id` | D1 schema introspection | Apply migration 0040 and the existing `release_requested_at` migration. |
| D-25 | Missing any table from the Section 6.1 list | D1 schema introspection | Apply the migration named for it in `V8_MIGRATION_PLAN.md`. |
| D-26 | `cart-activity` queue not wired up | `wrangler.toml` queues config | Add the queue binding. Confirm `CartDO` publishes to it on every mutation. |
| D-27 | Abandoned cart cron query missing `customer_email` dedup | Code review of `src/cron/abandoned-cart.ts` | Add the `ROW_NUMBER() OVER (PARTITION BY customer_email)` window per Section 17.3. |
| D-28 | Abandoned cart cron missing `consent_status = 'allowed'` filter | Same as D-27 | Add the consent filter. Never send marketing email without consent. |
| D-29 | Money stored as REAL/FLOAT outside AI cost | SQL-side: `rg "(price\|cost\|subtotal\|total\|delivery\|discount\|advance\|balance\|refund\|vat).*\\b(REAL\|FLOAT\|DOUBLE)\\b" migrations/`. TS-side: `rg ":(number\|float).*(_paisa\|_amount\|price\|cost\|subtotal\|total\|delivery\|discount\|advance\|balance\|refund\|vat)" src/` excluding `cost_usd` in BudgetCounterDO (the documented float exception) | Convert to integer paisa. The only float money is `cost_usd` in `BudgetCounterDO.recordUsage()`. The broadened regex catches columns/types without the `_paisa` suffix that earlier drafts missed. |
| D-30 | PII in structured logs | Log scan over staging for the last 7 days | Add PII redaction at the log sink. Treat as P2 finding. |
| D-31 | Webhook handler missing HMAC verification | `rg "webhook" src/api/payments/` and check each handler | Add `verifyHmac()` call before any processing. |
| D-32 | Staff route missing Zero Trust or RBAC middleware | Cloudflare Access config audit + `rg "export (async )?function (GET\|POST\|...)" src/pages/staff/` | Add Zero Trust on the Cloudflare side; add RBAC middleware in the route handler. |
| D-33 | External API call without going through a provider adapter | `rg "fetch\('https://" src/` excluding `src/lib/integrations/**` | Move the call into a provider adapter per Section 2.3. |
| D-34 | AI call sending PII to the provider | Code review of AI prompts — search for customer name, phone, address in prompt templates | Strip PII from prompts. Log the violation as a P1 finding. |
| D-35 | Migration without a rollback file | `ls db/migrations/` and `ls db/migrations/rollback/` — every `NNNN_*.sql` needs a matching `rollback/NNNN_*.rollback.sql` | Write the rollback file. Block the PR until it exists. |
| D-36 | Migration file containing more than one statement | Statement count over `db/migrations/*.sql` | Split into one statement per file. D1 migrations are not transactional (M-04). P0. |
| D-37 | Migration missing a pre-flight file, or a pre-flight that cannot return zero rows (e.g. a bare `PRAGMA`) | `ls db/migrations/preflight/` plus a parse check for `PRAGMA` as the only statement | Write a `SELECT` that returns zero rows when it is safe to apply (M-03). |
| D-38 | `VariantInventoryDO` missing `adjustStock` or `restoreFromSnapshot` | TypeScript type check against `src/lib/contracts/variant-inventory-do.ts` | Add the methods per Section 11.3 / 36.2. Without `adjustStock` there is no legal way to load opening stock or restock a return (RT-003). P0. |
| D-39 | `BudgetCounterDO` object ID in any format other than `budget:{provider}` | `rg "idFromName\('budget:"` and `rg "idFromName\(.*deepseek"` | Use `budget:{provider}` at every call site (C-04, C-05). P0 — a mismatch means the budget is silently unenforced. |
| D-40 | `payment_events` missing `UNIQUE(provider, provider_event_id)`, or a webhook handler that ignores the uniqueness violation | `PRAGMA index_list('payment_events')` plus `payment-webhook-replay.test.ts` | Apply migration 0052 and treat a violation as a replay (F-01). P0 — this is a direct double-credit path. |
| D-41 | A Durable Object arming more than one alarm, or an alarm handler with no `alarm_purpose` branch where the object has multiple deadlines | Code review of `src/durable-objects/*.ts` plus `rg "setAlarm"` | One alarm per object; store `alarm_purpose` (RT-006, CF-01). P0 for `CartDO`. |
| D-42 | `payment_transactions` missing `payment_event_id` or `UNIQUE(payment_event_id, direction)`, or a queue consumer that does not treat the violation as a replay | `PRAGMA table_info('payment_transactions')` + `PRAGMA index_list('payment_transactions')` + `payment-ledger-replay.test.ts` | Add `payment_event_id`, add the unique constraint, and treat violation as replay. P0. |
| D-43 | POS sale path without idempotency — `directSale` not idempotent on `(invoice_id, variant_id)` or `/api/staff/invoices` missing the `idempotency_key` unique handling | Code review of POS flow + `pos-sale-retry-idempotency.test.ts` | Add `directSale` replay semantics and `invoices.idempotency_key` unique replay handling. P0. |
| D-44 | Buy Now session cookies referenced without the `__Host-` prefix | `rg "bn_sid|bn_bind" src/` | Every hit must be `__Host-bn_sid` / `__Host-bn_bind`. P1. |
| D-45 | COD ceiling/velocity or return window read from anywhere other than `site_settings` | `rg "MAX_COD_VALUE_PAISA|COD_ORDERS_PER_PHONE_24H|RETURN_WINDOW_DAYS"` and trace through the accessor | Route every read through the `site_settings` accessor. P1. |
| D-46 | Code still references the `variants` compatibility view | `rg "FROM variants\\b|JOIN variants\\b" src/` | Remove the reference and target `product_variants` directly. P1. |

### 38.3 Audit Execution Procedure

| Step | Action | Tool |
|---|---|---|
| 1. Scope | Identify the PRs or branches to audit. For the nightly run, audit `main`. For pre-release, audit the release branch. For V8 landing, audit all open PRs. | Git |
| 2. Automated scan | Run `audit-drift.ts` (in `scripts/audit/`), which executes every detection method in the table above. Output is JSON. | Node script |
| 3. Manual review | The Cluster Owner for each affected cluster reviews the automated findings and adds any manual findings (e.g. D-08, D-17 which require code review). | Cluster Owner |
| 4. Triage | Each finding is assigned a severity for trend tracking. On a PR, every severity blocks merge. | Cluster Owner |
| 5. Report | Generate `docs/audit/drift-{YYYY-MM-DD}-{scope}.md` with the findings table, severities, and assignees. | CI |
| 6. Fix loop | Each finding becomes a ticket. The ticket references the finding code (e.g. `D-04`) so trend analysis is possible. Findings of the same code in subsequent audits indicate the fix didn't stick and trigger an amendment proposal. | Engineering team |
| 7. Trend | The monthly Owner review (Section 34.2) looks at finding-code frequency. A code appearing > 3 times in a quarter triggers a CI check to automate its detection. | Owner |

### 38.4 The `audit-drift.ts` Script

The script is the workhorse of the audit. It lives at `scripts/audit/audit-drift.ts` and is invoked as `npx tsx scripts/audit/audit-drift.ts --scope {pr\|weekly\|release} --output docs/audit/drift-{date}.md`.

**Implementation completeness note:** the skeleton below shows the script structure with only 3 of the 46 checks filled in (D-01, D-02, D-04). The production script MUST implement all 46 checks from Section 38.2. A script that ships with only 3 checks silently skips 43 drift patterns — this is worse than not running the audit at all, because it gives false confidence. The CI gate in Section 38.5 MUST verify that the script's `checks` array has exactly 46 entries before allowing the job to pass; a script with fewer entries fails CI with the error `audit-drift.ts: expected 46 checks, found N`.

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
  // ... all 46 checks ...
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
  // The skeleton above shows only 3 checks; the production script must have all 46.
  if (checks.length !== 46) {
    console.error(`audit-drift.ts: expected 46 checks, found ${checks.length}.`);
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

The drift script runs in CI on every PR (scope: `pr`) and nightly on `main` (scope: `weekly`). The PR-scope run is a merge gate; the nightly run produces the dashboard the Owner reviews monthly (Section 34.2).

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

Every finding blocks the PR (Section 34.2). The nightly `main` run produces the dashboard the Owner reviews monthly.

### 38.6 V8 Landing Audit (One-Time)

When the V8 plan is merged, a one-time comprehensive audit runs against the entire codebase. This audit is more thorough than the weekly drift audit and includes the manual-review findings (D-08, D-17, D-19, D-20, D-30, D-34) that the automated script cannot detect.

The V8 landing audit:

1. Runs the `audit-drift.ts` script with scope `v8-landing`.
2. Each Cluster Owner manually reviews their cluster (Section 34.3) and adds manual findings.
3. The combined report is `docs/audit/drift-v8-landing-{date}.md`.
4. Every P0 finding must be fixed before any new feature work continues.
5. P1 findings are tracked as tickets with a 2-week fix SLA.
6. The Owner reviews the V8 landing audit at the next monthly review and proposes any guardrail amendments needed to catch the most common drift patterns going forward.

The V8 landing audit is the single most important execution step after the plan is merged. Skipping it means the plan is aspirational rather than binding.

---

