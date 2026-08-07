# V8 Changelog — Zabir Boutiques Master Plan

## V8.1 Patch Release

| Property | Value |
|---|---|
| From | V8 |
| To | **V8.1** |
| Date | 2026-08-07 |
| Scope | RV8-001…RV8-012 plus consistency fixes C1…C15 |
| Migration note | 0053 (`create_payment_transactions`) amended in place because it is unapplied; 0069–0071 appended per §35.6 forward-fix rule. Two originally drafted additions (`invoices.idempotency_key` column + index) were withdrawn per RR-03 — the column already exists in `db/migrations/0016_invoices.sql`. |

### V8.1 Change Summary

| Finding ID | Sections edited | Change |
|---|---|---|
| RV8-001 | 0, 6.1, 11.5, 30 (#46), 31, 32, 34.4 #24, 36.5, 37.0 #14, 38 (D-42), `V8_MIGRATION_PLAN.md` 0053 | `payment_transactions` now carries `payment_event_id` with `UNIQUE(payment_event_id, direction)`; queue replay after ledger write is a no-op |
| RV8-002 | 6.1, 11.3, 15.1, 30 (#16), 31, 32, 34.4 #33, 36.2, 37.0 #23, 38 (D-43) | POS sale path is idempotent on both `(invoice_id, variant_id)` and `invoices.idempotency_key`; no migration needed — the column already exists (RR-03) |
| RV8-003 | 0, 10.3, 10.6, 30 (#40), 31, 32, 34.4 #14, 36.5, 37.0 #24, 38 (D-44) | Buy Now cookies renamed to `__Host-bn_sid` / `__Host-bn_bind`; sibling-subdomain cookie tossing blocked mechanically |
| RV8-004 | 6.8, 27.2 | Idempotency retention contradiction fixed to 2 hours everywhere |
| RV8-005 | 12.3, 30 (#12), 31, 34.4 #21, 37.0 #25, 38 (D-22) | Cleanup cron no longer releases non-cancelled orders; reconciliation owns attached-order expiry |
| RV8-006 | 6.1, 11.1 step 11, 13.2, 34.4 #34, 38 (D-45), `V8_MIGRATION_PLAN.md` 0069–0070 | `site_settings` defined and seeded; D-04 resolved-with-defaults |
| RV8-007 | 13.2 | Launch scope for COD-collected refunds stated explicitly: manual only, outside `refunds` table |
| RV8-008 | 11.6, 37.0 #26 | Paid-but-cancelled branch now refunds and pages instead of silently leaving paid+cancelled |
| RV8-009 | 36.5, 38 (D-17) | `markConvertedAndDelete` docstring corrected to binding-hash verification |
| RV8-010 | 11.1 step 16, 12.2 | Checkout batch is sole inserter of `stock_reservations`; DO repair paths never insert |
| RV8-011 | 17.1 | D-02 marked resolved-deferred; Resend is only launch provider and alert pages at >5% failure |
| RV8-012 | 27.1, 27.3 | D1 Time Travel verification task added; restore secret workflow made explicit |
| C1–C15 | 0, 6.1, 11.2, 11.4, 12.5, 24.2, 31, 32, 38.3, 38.4, `V8_MIGRATION_PLAN.md` 0070–0071 | Reservation wording, projection-freshness wording, retired `csrf_nonces` note, rounding rules, test count 27, audit gate 46, Imagify seed, and `variants` view retirement aligned |

---

## 1. Version Header

| Property | Value |
|---|---|
| From | V7 Cloudflare Canonical Plan (June 2026) |
| To | **V8** |
| Date | 2026-08-07 |
| Source review | `Zabir_Boutiques_V7_RedTeam_Review.md`, accepted in full and not re-litigated |
| Artifacts | `Zabir_Boutiques_Master_Plan_V8_Part-1.md` (Sections 0–25), `Zabir_Boutiques_Master_Plan_V8_Part-2.md` (Sections 26–38), `V8_MIGRATION_PLAN.md`, this file |
| Repository state assumed | `db/migrations/` head is `0039`; V8 migrations begin at `0040` |
| Team size assumed | 2–4 engineers plus the Owner (stated in the Part-1 header and Section 34.0) |

---

## 2. Change Table

### Tier 1 — P0

| Finding ID | Severity | Sections edited | What changed | Old rule | New canonical rule |
|---|---|---|---|---|---|
| RT-002 | P0 | 0, 6.1, 12.3, 30 (#32, #43), 31, 32, 34.4 #6, 35, 38 (D-23, D-24), `V8_MIGRATION_PLAN.md` | Replaced the reservation uniqueness index with two correctly-grained partial indexes and added the missing `checkout_id` column | One partial unique index `idx_stock_reservations_order_active` on `(order_id) WHERE status='active'`; `checkout_id` passed to `reserve()` but never a column | `idx_stock_res_order_variant_active` on `(order_id, variant_id) WHERE status='active' AND order_id IS NOT NULL`, plus `idx_stock_res_checkout_variant_active` on `(checkout_id, variant_id) WHERE status='active'`; `stock_reservations.checkout_id` exists |
| RT-001 + F-02 | P0 | 0, 11.1, 11.6, 12.3, 13.1, 30 (#12, #50), 31, 34.4 #21/#22, 37.0 | Cleanup cron no longer releases live orders' stock; reservation window now outlasts the payment window | Cron released every active reservation older than 15 minutes with no order filter; reservations expired at 15 min while payment had 30 min | Cron releases only orphans (`order_id IS NULL` and >15 min), cancelled orders, or orders past `orders.reservation_expires_at`; `reservation_expires_at = created_at + 60 minutes` |
| RT-003 | P0 | 11.3, 12.3, 13.2, 14.1, 30 (#17, #44), 36.2, 37.0, 29.4 | Added the only legal path for stock to enter or leave outside sales | Six DO methods, none of which increases `stock`; Guardrail #17 forbade direct D1 writes with no alternative | `VariantInventoryDO.adjustStock({...})` with a two-person rule for negative deltas; `inventory.adjust` and `inventory.adjust.approve` in RBAC; wired into return restock and goods receipt |
| RT-006 + C-02 | P0 | 0, 6.3, 6.6, 6.8, 9.1, 30 (#6, #13, #28, #45), 31, 32, 34.4 #16, 36.6, 38 (D-05, D-41) | One alarm per Durable Object, with a stored purpose; corrected the false durability rationale | "Two-stage alarm: 5-min → upsert and re-arm; 30-day → final write then deleteAll", justified as protecting against loss on Worker restart/eviction | Single alarm with `alarm_purpose` in DO storage; `'persist'` hands off to `'cleanup'` and never re-arms itself. DO storage is already durable; the alarm exists only to keep the D1 projection fresh |
| RT-005 + S-02 | P0 | 0, 10.3, 10.6, 30 (#40), 31, 32, 34.4 #14, 36.5, 38 (D-17) | Replaced header-based session binding with a cookie secret; removed `sid` from URLs | `Origin` **and** `sha256(User-Agent)` verified on every request including GET; mismatch → 403 + delete the DO; `sid` in the query string | Binding is `sha256(__Host-bn_bind)` against a stored `binding_hash`; `Origin` checked on state-changing POSTs only; the User-Agent check is deleted; `__Host-bn_sid` and `__Host-bn_bind` are HttpOnly cookies; no identifier in any URL; a failed GET renders a fresh page and never deletes the DO |
| F-01 | P0 | 6.1, 11.5, 30 (#46), 31, 34.4 #24, 35, `V8_MIGRATION_PLAN.md` 0050–0052 | Added an enforcing uniqueness constraint for webhook replay | "Store event id in D1 `payment_events` idempotently" with no constraint; the repo table had no provider identity at all | `payment_events.provider` and `.provider_event_id` columns plus `UNIQUE(provider, provider_event_id)`; the handler treats a violation as a replay — 200, no enqueue, no credit |
| RT-010 + M-01/M-03/M-04 | P0 | 26.3, 30 (#31, #48), 31, 35 (all), `V8_MIGRATION_PLAN.md` | Renumbered against the repository, deleted the mapping paragraph, split every multi-statement migration, rewrote pre-flights as zero-row queries | Plan numbers `0024`–`0027` mapped to repo files `0021`–`0024` while CI required exact monotonic numbering; multi-statement files; 0028's pre-flight was `PRAGMA table_info` + "inspect the result" | No mapping exists — plan numbers are repo numbers, starting at `0040`. One statement per file. Every migration has a rollback file and a pre-flight query that returns zero rows when safe |
| C-04 + C-05 | P0 | 6.6, 24.2, 30 (#49), 31, 34.4 #25, 36.3, 37.0, 38 (D-39) | One canonical BudgetCounterDO object ID; re-keyed by provider | Three formats: `budget:{service}:{period}`, `budget:{provider}:{YYYY-MM-DD}`/`{YYYY-MM}`, and `idFromName('deepseek:' + today)`; daily and monthly limits could not coexist | `budget:{provider}` everywhere; one object holds both buckets and rolls them on UTC boundaries |
| RT-004 + M-07 | P0 | 27.1, 27.2, 27.3, 30 (#47), 31, 34.4 #27, 36.2, 37.0 | Durable Object state added to backup and restore; D1 Time Travel adopted | Backup was "D1 export stored in R2"; restore verified row counts; no DO state anywhere; RPO 6h; restore step 6 required a binding change | Hourly R2 snapshot of every variant's `{stock, reserved, sold}`; `restoreFromSnapshot()` env-gated by `DR_RESTORE_ENABLED`; D1 Time Travel is the primary D1 mechanism (RPO near-zero); restore happens **in place**; every drill asserts DO/D1 parity |

### Tier 2 — P1

| Finding ID | Severity | Sections edited | What changed | Old rule | New canonical rule |
|---|---|---|---|---|---|
| RT-007 | P1 | 11.1 steps 9/16, 11.3, 18.4, 6.1 | Coupon redemption moved into the order batch | Coupon applied atomically at step 9, before reservation and order write; no rollback | Step 9 validates only; redemption is written in the same D1 batch as the order at step 16; `UNIQUE(coupon_id, order_id)`; a defensive rollback path exists |
| RT-008 | P1 | 6.1, 15.3, 15.4, 15.5, 6.6, 36.7b | POS serials issued by a Durable Object | `daily_invoice_counters` read-modify-write in D1, no uniqueness | `InvoiceCounterDO` (`invoice-counter:{YYYYMMDD}`) issues `receipt_no`; `invoices.receipt_no` is UNIQUE; a failed write burns the serial rather than reusing it; `daily_invoice_counters` is advisory only |
| RT-009 | P1 | 0, 1, 2.1, 3.3, 3.4, 19.1, 19.2, 30 (#2), 31, 32, 34.4 #3, 38 (D-03) | Catalog routes moved to on-demand rendering | `/`, `/products/[slug]`, `/categories/[slug]`, `/collections/[slug]`, `/blog/[slug]` marked `prerender = true` with no `getStaticPaths()` and no rebuild trigger | Those five are on-demand rendered with Cache API + SWR and tag purging; `prerender = true` is exactly `{/about, /privacy, /terms, /return-policy, /size-guide}`; publish SLA ≤ 60s |
| S-04 | P1 | 11.1 step 11, 30 (#15), 31 | COD gained a monetary ceiling and velocity limits | COD allowed when `total_quantity <= 2`; no value cap, no velocity limit | Quantity cap **and** `MAX_COD_VALUE_PAISA` **and** 24-hour per-phone and per-address COD velocity limits, all server-side (values pending D-04) |
| S-05 | P1 | 11.2 | Circuit-open window hardened | Breaker open → approve everything with fallback score 50 for 5 minutes | COD hard-blocked while open; order rate tightened; `pending_review → processing` requires an explicit staff action in `audit_log` |
| S-06 | P1 | 18.6, 26.1 | CSP corrected | Missing `frame-ancestors`; missing Turnstile in `connect-src`; FraudBD in `connect-src`; `style-src 'unsafe-inline'`; undefined `cdn.zabirboutiques.com` | `frame-ancestors 'none'`; Turnstile added; FraudBD removed; nonce-based `style-src`; `images.zabirboutiques.com`, now defined in the Section 26.1 environment table |
| S-07 | P1 | 18.2, 28.3 | Audit log holds no raw PII | Audit log recorded staff PII access and was retained 7 years, in direct conflict with the deletion right | `customer_ref = HMAC(AUDIT_CUSTOMER_REF_SALT, normalized_phone)` plus `order_id`; anonymizing the customer row satisfies deletion completely |
| F-03 | P1 | 5, 6.1, 13.2 | Partial-prepayment ledger added | Refunds had no cap, COD collection and courier remittance were unrecorded | `payment_transactions`, `courier_shipments`, `courier_cod_remittance`, and the `trg_refund_cap` trigger enforcing `SUM(refunds) <= advance_paisa` |
| F-04 | P1 | 11.3, 12.1 | Stock arithmetic made canonical | Never stated whether `directSale` decremented `stock` or incremented `sold` | All sales increment `sold`; `stock` changes only via `adjustStock()`. A per-operation table is now in Section 11.3 |
| F-05 | P1 | 11.5, 13.1 | Payment modelled as an orthogonal field | Fulfilment-only state machine; a prepaid low-risk order had no automatic path out of `created` | `orders.payment_status` (`unpaid` / `partially_paid` / `paid` / `partially_refunded` / `refunded`); paid + `fraud_score <= 40` + `created` auto-confirms; everything else waits for staff |
| F-06 | P1 | 11.1 step 8, 11.7, 15.2, 30 (#41) | VAT rule made complete and testable | `vat_paisa = round(subtotal_paisa * vat_rate / 100)` with an unspecified rounding mode and no line allocation | Base is `subtotal − discount`; half-up integer rounding; largest-remainder per-line allocation with `SUM(order_items.vat_paisa) = orders.vat_paisa` |
| C-01 | P1 | 11.1 steps 2, 13 | Turnstile ordering de-circularized | Step 2 required Turnstile "when risk score requires it"; the score is produced at step 12 | Step 2 uses pre-checkout signals only; FraudBD may trigger a second challenge at step 13 in the 41–70 band |
| C-03 | P1 | 17.3 | Compare-and-set restored to the pseudocode | Prose claimed an atomic CAS; the pseudocode omitted `AND abandoned_email_sent_at IS NULL` | The predicate is in the SQL, and the code must check `changes() = 1` before enqueueing |
| C-06 | P1 | 13.1, 12.3 | `restocked` removed as a state | Listed as a transition target with no matching state row | Restocking is an inventory action: `adjustStock()` + `return_requests.restocked_at` + a `stock_adjustments` row |
| C-07 | P1 | 10.6, 28.3, 36.6 | Customer identity scoped honestly | Three features assumed a customer identity system that the schema, phases, and RBAC never built | Guest-only pending **D-01**; `mergeCart()` declared `NOT_IMPLEMENTED`; `/api/me/*` authenticates by phone OTP against `orders` |
| C-08 | P1 | 14.1, 34.10 | Guardrail dashboard permission fixed | `/staff/guardrails` required `reports.view`, which a Viewer holds and a Staff member does not | New `guardrails.view` permission, Owner and Manager only |
| C-09 | P1 | 5, 6.1, 11.7, 18.7 | VAT rate moved to D1 | "a Cloudflare secret / KV feature flag (`VAT_RATE_PERCENT`)" — two stores named in one sentence, neither strongly consistent | Effective-dated `tax_rates` table read in the same read as pricing; `VAT_RATE_PERCENT` retired |
| C-10 | P1 | 11.2 | 4xx branch defined | Scoring table had no row for a 4xx response, so a FraudBD 429 left checkout undefined | 4xx or any scoreless outcome → fallback 50 → `pending_review`; logged as `client_error`; not counted toward the breaker; P3 alert above a 5% rate |
| CF-04 | P1 | 6.1, 6.3, 30 (#28), 37.0 | Dual-writer made monotonic | Two writers with no ordering guarantee could move `cart_activity` backwards | `cart_activity.cart_version` plus a version-conditional upsert on both writers |
| CF-09 | P1 | 2.1, 17.1, 30 (#30) | Unverified email capability demoted | Cloudflare Email Sending listed as an optional provider and a fallback | Not an approved outbound provider pending **D-02**; the only guaranteed fallback is manual staff notification |
| CF-10 | P1 | 18.2 | Zero Trust ↔ cookie session interaction specified | Never stated; the login form appeared to sit behind the perimeter that requires being logged in | Access is the network perimeter, cookies are the application identity; `/staff/login` is excluded from the perimeter; POS uses a service token; a time-boxed break-glass procedure exists |
| M-05 | P1 | `V8_MIGRATION_PLAN.md` §5 | `0025` marked irreversible once live | `DROP TABLE api_audit_logs` treated as an ordinary rollback | Irreversible once FraudBD is live — it destroys the circuit breaker's persisted state; reversal is an Owner decision, not a script |
| M-06 | P1 | 26.3, 35.5, `V8_MIGRATION_PLAN.md` | Risk re-rated against real data; pre-flights assert schema shape | "Low — additive table, no existing data touched" on a live system; FK assumptions never verified | Every rating is against a non-empty production database; FK-declaring migrations assert the referenced table and primary key shape in the pre-flight; pre-flights run against production read-only before staging |

### Tier 3 — P2/P3

| Finding ID | Severity | Sections edited | What changed |
|---|---|---|---|
| S-03 | P2 | 18.4, 18.5 | Coupon rate limit re-keyed from client-chosen `session_id` to IP + normalized phone; Turnstile after exactly 3 failures |
| S-08 | P2 | 18.4 | Per-IP limits replaced with session/phone keys on write paths and Bot Management scores on read paths, for CGNAT reality |
| S-09 | P2 | 18.4 | Webhook provider allowlist made advisory and alert-only; signature verification is the control |
| S-10 | P2 | 18.3, `V8_MIGRATION_PLAN.md` 0068 | CSRF reduced to one stateless mechanism; `csrf_nonces` retired; 24-hour dual-key rotation window |
| S-11 | P2 | 18.7 | Rotation cadence, dual-key overlap, and a runbook for every secret; `AUDIT_CUSTOMER_REF_SALT` marked never-rotate |
| S-12 | P3 | 25.1 | Central `redact()` chokepoint, lint ban on direct log sinks, `redaction.test.ts` |
| F-09 | P2 | 6.1, 15.6, 14.1 | POS cash-drawer close, variance tracking, and Z-report with the daily output-VAT register |
| F-10 | P2 | 13.2, 14.1 | Return window enforced server-side from `site_settings`, with a `returns.override_window` permission |
| CF-01 | P2 | 6.6 | One-alarm-per-DO rule documented; `ProviderHealthDO` explicitly single-purpose |
| CF-06 | P2 | 12.3 | Cron single-instancing treated as an unsafe assumption; the `release_requested_at` stamp declared load-bearing |
| CF-07 | P2 | 2.2 | Cost model with volume assumptions and per-unit drivers; `/api/stock/[variant_id]` returns a band, not a count |
| CF-08 | P2 | 24.2 | Corrected the false claim that Workers AI is platform-blocked; added an hourly fallback cap with a KV backstop |
| CF-11 | P2 | 12.5 | The undefined "virtual queue" sentence deleted; real controls stated instead |
| CF-12 | P3 | 6.1 | `variants` documented as a read-only compatibility view scheduled for deletion; writes to it fail at runtime |
| M-08 | P3 | 27.1 | D1 Time Travel adopted; RPO revised from 6 hours to near-zero |
| M-09 | P2 | 35.6 | `_migrations` SHA-256 reconciliation runbook added |
| M-10 | P3 | 35.2 | "The four migrations below" listing five — the whole section was rewritten, so the defect is gone |
| C-02 | P3 | 6.3, 30 (#6) | DO durability rationale corrected |
| Section 8 | — | 1, 29.4 | ERP classification table reproduced verbatim; Section 1 claim narrowed to "ecommerce, POS, and light-operations platform" |
| Section 10 | — | 30 (#3, #4, #21, #33–#37), 37.0 | Every guardrail the review called unenforceable given a mechanical enforcement point |
| Section 34 rescope | — | 34.0–34.10 | 17 clusters → 4; cadence table deleted; ARB and Release Captain deleted; CI gate expanded from 20 to 32 checks |

---

## 3. Guardrail Diff

**Count: 43 → 50.** No guardrail was retired or renumbered. Seven were added, each closing a P0; the Section 34.8 rule ("no new guardrail without a retirement, a merge, or a P0") is satisfied by the P0 exemption.

### Added

| # | Closes | Rule |
|---|---|---|
| 44 | RT-003 | `adjustStock()` is the only way `stock` changes, in any channel; sales only increment `sold` |
| 45 | RT-006 | One alarm per Durable Object, with a stored `alarm_purpose`; DO storage is durable and no alarm may be justified as a durability mechanism |
| 46 | F-01 | `UNIQUE(provider, provider_event_id)` on `payment_events`; a violation is a replay |
| 47 | RT-004 | Durable Object state is part of disaster recovery: hourly snapshot, `restoreFromSnapshot()`, Time Travel, in-place restore, parity assertion |
| 48 | RT-010 | Migration discipline: one statement per file, numbered against the repository, rollback plus zero-row pre-flight, risk rated against non-empty production |
| 49 | C-04, C-05 | `BudgetCounterDO` object ID is `budget:{provider}` document-wide |
| 50 | RT-001, F-02 | `reservation_expires_at = created_at + 60 minutes`, strictly longer than the payment window; no path releases a live order's reservation |

### Amended (original numbers kept, inline `> Amended V8:` marker added)

| # | Type | Per |
|---|---|---|
| 2 | corrected | RT-009 |
| 6 | corrected | RT-006, C-02 |
| 12 | corrected | RT-001, F-02, CF-06 |
| 13 | clarified | RT-006, CF-01 |
| 14 | strengthened | S-05, C-10 |
| 15 | strengthened | S-04 |
| 17 | clarified | RT-003 |
| 28 | corrected | RT-006, CF-04 |
| 30 | corrected | CF-09 |
| 31 | strengthened | RT-010, M-03, M-04 |
| 32 | corrected | RT-002, Section 4 of the review |
| 33 | clarified | S-07 |
| 34 | strengthened | Section 10 of the review |
| 35 | clarified | Section 10 of the review |
| 36 | strengthened | Section 10 of the review |
| 37 | strengthened | Section 10 of the review |
| 40 | corrected | RT-005, S-02 |
| 41 | corrected | F-06, C-09 |
| 42 | strengthened | CF-08 |
| 43 | corrected | RT-002 |

### Retired

None. (Retired *artifacts* are listed in Section 8 below.)

### Renumbered

None. Every guardrail keeps its V7 number.

### Cluster arithmetic

| Cluster | Guardrail #s | Count |
|---|---|---:|
| 1. Money & Commerce | 3, 4, 5, 9, 14, 15, 18, 19, 25, 41, 46 | 11 |
| 2. Inventory & POS | 10, 11, 12, 16, 17, 32, 43, 44, 50 | 9 |
| 3. Security & Privacy | 20, 21, 22, 33, 34, 35, 36, 37, 40 | 9 |
| 4. Platform & Migrations | 1, 2, 6, 7, 8, 13, 23, 24, 26, 27, 28, 29, 30, 31, 38, 39, 42, 45, 47, 48, 49 | 21 |

**Sum: 11 + 9 + 9 + 21 = 50** ✓ — every guardrail from 1 to 50 appears exactly once, no duplicates, no orphans.

---

## 4. Schema Diff

| Object | Change | Delivered by |
|---|---|---|
| `stock_reservations.checkout_id` | Column added | 0040 |
| `idx_stock_reservations_order_active` | **Dropped (retired)** | 0041 |
| `idx_stock_res_order_variant_active` | Partial unique index added on `(order_id, variant_id) WHERE status='active' AND order_id IS NOT NULL` | 0042 |
| `idx_stock_res_checkout_variant_active` | Partial unique index added on `(checkout_id, variant_id) WHERE status='active'` | 0043 |
| `orders.reservation_expires_at` | Column added | 0044 |
| `orders.payment_status` | Column added with CHECK | 0045 |
| `orders.fraud_score` | Column added with CHECK 0–100 | 0046 |
| `orders.fraud_source` | Column added with CHECK | 0047 |
| `orders.created_by_staff_id` | Column added (no FK — see the migration note) | 0048 |
| `orders.staff_override` | Column added with CHECK (0,1) | 0049 |
| `payment_events.provider` | Column added | 0050 |
| `payment_events.provider_event_id` | Column added | 0051 |
| `idx_payment_events_provider_event` | **Unique** index added on `(provider, provider_event_id)` | 0052 |
| `payment_transactions` | Table added, including `payment_event_id` with `UNIQUE(payment_event_id, direction)` (RV8-001) | 0053 |
| `coupon_redemptions` | Table added | 0054 |
| `idx_coupon_redemptions_coupon_order` | Unique index added on `(coupon_id, order_id)` | 0055 |
| `tax_rates` | Table added | 0056 |
| `tax_rates` launch row | Seed (`goods`, 0%) | 0057 |
| `cart_activity.cart_version` | Column added | 0058 |
| `courier_shipments` | Table added | 0059 |
| `courier_cod_remittance` | Table added | 0060 |
| `pos_cash_drawer_sessions` | Table added | 0061 |
| `suppliers` | Table added | 0062 |
| `purchase_orders` | Table added | 0063 |
| `goods_receipts` | Table added | 0064 |
| `return_requests.restocked_at` | Column added | 0065 |
| `product_variants.cost_paisa` | Column added with CHECK | 0066 |
| `trg_refund_cap` | Trigger added on `refunds` | 0067 |
| `csrf_nonces` | **Table dropped (retired)** | 0068 |
| `site_settings` | Table added | 0069 |
| `site_settings` launch rows | Seed (COD ceiling/velocity, return window defaults) | 0070 |
| `ai_budget_limits` `imagify` row | Seed | 0070 |
| `variants` compatibility view | **Dropped (retired)** | 0071 |
| `invoices.receipt_no` UNIQUE | Already present in the repository (`0016_invoices.sql`) — no migration needed; the plan now names the correct column | — |
| `invoices.idempotency_key` UNIQUE | Already present in the repository (`0016_invoices.sql`) — no migration needed (RR-03) | — |

**Naming correction surfaced during the edit:** the review and V7 refer to `invoices.invoice_no`; the repository column is `invoices.receipt_no`, and it is already `UNIQUE`. V8 uses `receipt_no` throughout. See Section 8.

---

## 5. Contract Diff

| Contract | Change |
|---|---|
| `VariantInventoryDO.adjustStock()` | **Added.** The only writer of `stock`. Idempotent on `adjustment_id`; two-person rule for negative deltas; returns `APPROVER_REQUIRED` / `NEGATIVE_STOCK` |
| `VariantInventoryDO.restoreFromSnapshot()` | **Added.** DR only; env-gated by `DR_RESTORE_ENABLED`; returns `RESTORE_DISABLED` when unset |
| `VariantInventoryDO.getAvailability()` | Doc changed: public callers MUST convert to a band, never expose exact counts |
| `CartDO.getCartForCheckout()` | **Added.** Returns the cart with the observed `cart_version`, which checkout re-asserts before reserving |
| `CartDO.armAlarm(purpose)` | **Added.** Single-alarm arming with `'persist' \| 'cleanup'` |
| `CartDO.alarm()` | **Changed.** Branches on `alarm_purpose`; `'persist'` hands off to `'cleanup'` and never re-arms itself |
| `CartDO.mergeCart()` | **Changed to `Promise<{ error: 'NOT_IMPLEMENTED' }>`** pending D-01 |
| `AlarmPurpose` type | **Added** and exported from the barrel |
| `DirectCheckoutSessionDO.create()` | **Changed.** Takes `binding_secret`; no longer takes `origin` or `user_agent` |
| `DirectCheckoutSessionDO.get()` / `.updateFormDraft()` / `.markConvertedAndDelete()` | **Changed.** Take `binding_secret`; error union is now `SESSION_NOT_FOUND \| SESSION_EXPIRED \| BINDING_MISMATCH`; `ORIGIN_MISMATCH` and `USER_AGENT_MISMATCH` removed |
| `DirectCheckoutSessionState` | **Changed.** `origin`, `user_agent_hash`, and `customer_session_link` removed; `binding_hash` added |
| `BudgetCounterDO` | **Changed.** Object ID is `budget:{provider}`; one object holds both buckets and rolls them internally |
| `IdempotencyDO` | **Added — the interface did not exist in V7.** `claim()` with `claim_ttl_seconds` and defined stuck-claim resolution, `complete()`, `fail()`, `alarm()`. Retention reduced from 24h to 2h |
| `InvoiceCounterDO` | **Added.** `nextInvoiceNumber()`, `getCurrentSeq()`, `alarm()` |
| `EmailProvider` | Unchanged in shape. The `'cloudflare_email'` member of the `provider` union is blocked on D-02 |
| Barrel `index.ts` | Now exports `IdempotencyDO`, `IdempotencyStatus`, `InvoiceCounterDO`, `AlarmPurpose` and their class types |

---

## 6. Migration Renumbering Map

The V7 mapping paragraph is deleted. This table exists once, here, as a historical record of what the V7 numbers meant — it is **not** a mapping any code or process may consult.

| V7 plan number | V7 claimed repo file | Actual repository state | V8 disposition |
|---|---|---|---|
| 0024 `create_otp_secrets` | repo `0021` | `0021_create_otp_secrets.sql` — already applied | No new migration; already in production |
| 0025 `create_api_audit_logs` | repo `0022` | `0022_create_api_audit_logs.sql` — already applied | No new migration; marked **irreversible once FraudBD is live** (M-05) |
| 0026 `create_ai_budget_limits` | repo `0023` | `0023_create_ai_budget_limits.sql` — already applied | No new migration; already in production |
| 0027 `stock_reservations_unique_constraint` | repo `0024` | `0024`, `0027`, and `0028` in the repository all touch this index, and the live index is `idx_stock_reservations_order_active` on `(order_id, variant_id) WHERE status='active'` | **Superseded by 0041 + 0042 + 0043.** The V7 forward SQL (`(order_id)` alone) MUST NOT be applied |
| 0028 `drop_legacy_abandoned_cart_columns` | (unstated) | The repository has already moved `cart_activity` past the legacy columns | **Dropped from the plan.** Its pre-flight was unrunnable and its forward SQL relied on runner error tolerance that does not exist |
| — | — | Repository head `0039_staff_roles_consolidate_5.sql`. Six migrations (`0034`–`0039`) landed between the original V8 draft and adoption — guest-cart/session/provider-health D1 tables, password-reset tokens, RBAC management, a `site_settings` seed, inventory movements, and a staff-role consolidation. They are unrelated to the V8 schema work and are not superseded by anything below. | V8 migrations begin at **0040** |

Full forward numbering: `0040`–`0071`, one statement each, specified in `V8_MIGRATION_PLAN.md`.

---

## 7. DECISION REQUIRED List

| ID | Question | Where | Blocks |
|---|---|---|---|
| **D-01** | Guest-only, or customer accounts? | Section 10.6 | `CartDO.mergeCart()`, `customer_session_link`, the `/api/me/*` identity model, a `customers` table, and a customer role in RBAC. V8 assumes guest-only and declares `mergeCart()` `NOT_IMPLEMENTED` rather than shipping it (C-07) |
| **D-02** | Is Cloudflare Email Sending generally available for outbound transactional mail on this account? | Section 17.1 | The provider-order list, the `SendResponse.provider` union, Guardrail #30, and the `cloudflare_email` adapter folder. Until answered, Resend has no automated fallback and `EMAIL_PROVIDER=cloudflare_email` MUST NOT be set (CF-09) |
| **D-03** | Is delivery subject to VAT? | Section 11.7 | The `tax_rates` seed (0069) and step 3 of the VAT rule. Only the `goods` row is seeded until answered (F-06) |
| **D-04** | What are `MAX_COD_VALUE_PAISA`, `COD_ORDERS_PER_PHONE_24H`, and `COD_ORDERS_PER_ADDRESS_24H`? | Section 11.1 step 11 | **Resolved with launch defaults.** `site_settings` seeds BDT 5,000 / 2 / 3, and the Owner may edit them without a deploy (RV8-006) |
| **D-05** | Add a Phase 4 finance module, or leave the "critical before scaling" ERP items unscheduled? | Section 29.4 | Nothing at launch. Blocks any ERP claim and all gross-margin reporting. The Section 1 wording change is applied unconditionally because the claim was inaccurate either way |
| **D-06** | Key `VariantInventoryDO` as `variant:{variant_id}:{location_id}` now? | Section 29.4 | The DO object ID format and every call site. Deferring is the expensive option — changing a DO key later is a migration across the entire object space. V8 keeps the single-location key and records the cost |

---

## 8. New Conflicts Surfaced During Edit

**NC-01 — `invoices.invoice_no` does not exist; the column is `receipt_no`.**
The review's RT-008 fix says to add `CREATE UNIQUE INDEX idx_invoices_no ON invoices(invoice_no)`. The repository's `0016_invoices.sql` defines `receipt_no TEXT NOT NULL UNIQUE`. **Resolution:** V8 uses `receipt_no` everywhere and states that the uniqueness constraint already exists. No migration is issued. The `InvoiceCounterDO` fix still lands in full, because uniqueness alone does not prevent two cashiers from computing the same serial — it only turns a silent duplicate into a failed write.

**NC-02 — `coupon_redemptions` does not exist in the repository at all.**
Section 6.1 lists it and RT-007 assumes it. It appears in no migration. **Resolution:** migration 0054 creates it and 0055 adds the unique index. This also means no historical redemption data exists to migrate, which is why 0055 is Low risk rather than High.

**NC-03 — `payment_events` has no provider identity.**
F-01 says to add `UNIQUE(provider, provider_event_id)`, but the repository table has neither column. Its existing constraint is `UNIQUE(invoice_id, event_type, status)`, which is not a replay guard: a redelivered event with a different status passes it, and two genuinely distinct events with the same triple would be wrongly rejected. **Resolution:** migrations 0050 and 0051 add the columns before 0052 adds the index, and the index carries a `WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL` predicate so historical NULL rows are excluded explicitly rather than by relying on SQLite's NULL-distinctness — the same subtlety that made the V7 reservation index a no-op.

**NC-04 — the plan's `returns` table is the repository's `return_requests`.**
C-06's fix requires `returns.restocked_at`. **Resolution:** migration 0065 targets `return_requests`, and Section 6.1 notes the naming. The pre-flight asserts the table exists before altering it.

**NC-05 — the repository index already has the `(order_id, variant_id)` grain, but under the retired name and without the NULL predicate.**
Repo migrations `0024`, `0027`, and `0028` converged on `idx_stock_reservations_order_active ON stock_reservations(order_id, variant_id) WHERE status = 'active'`. This is closer to correct than the V7 *document* described, but it still lacks `AND order_id IS NOT NULL`, so it does nothing at reserve time, and it provides no `checkout_id` retry guard. **Resolution:** 0041 drops it by name (the name carries the wrong semantics into every audit check and code comment), and 0042/0043 create the two correctly-grained indexes. The acceptance criterion "the old name appears nowhere except the changelog" is therefore about both the shape and the name.

**NC-06 — Guardrail #12's 15-minute window and Guardrail #50's 60-minute window would have coexisted.**
Applying RT-001 without amending #12 would have left two contradictory release rules in Section 30. **Resolution:** #12 is amended in place rather than supplemented; the 15-minute window now applies only to orphaned reservations with no order, and #50 governs everything attached to an order.

**NC-07 — Section 34.4 check #3 could not pass under either rendering model as written.**
The V7 check demanded 100% `prerender = true` coverage for the Section 3.4 static list, which RT-009 makes wrong. **Resolution:** check #3 now asserts set equality against the five legal/info routes, so it fails both when a legal route is missing the flag and when a catalog route has it.

---

## 9. Findings Not Applied

| Finding | Reason |
|---|---|
| **CF-09 (verification half)** | Whether Cloudflare Email Sending is generally available cannot be determined from inside this document. The plan change that *can* be made — demoting it from "fallback" to "unapproved pending verification" — is applied. The verification itself is **D-02** |
| **S-04 (numeric values)** | The COD ceiling and velocity numbers are business risk appetite, not engineering. The mechanism, the enforcement point, and a working default are specified; the numbers are **D-04** |
| **F-06 (delivery VAT treatment)** | A tax-filing question for the Owner and the VAT consultant. The taxable base, rounding mode, and allocation rule are applied; the delivery question is **D-03** |
| **C-07 (build the identity system)** | Building customer accounts is a scope decision with a milestone and a schema attached. V8 makes the gap explicit and unshippable-by-accident instead of silently choosing. **D-01** |
| **Section 8 "critical before scaling" ERP items** (COGS method, purchase-order workflow, supplier payables aging, daily sales reporting, staff performance reporting) | Scheduling them is a budget decision. The *schema groundwork* that would be expensive to retrofit is applied now — `product_variants.cost_paisa`, `suppliers`, `purchase_orders`, `goods_receipts` — but the reporting and valuation logic is out of launch scope. **D-05** |
| **Multi-location DO keying** | Applying it changes the object ID format for every variant and every call site, which is a larger change than a document edit and has a real complexity cost today. The cost of deferring is stated explicitly rather than discovered later. **D-06** |
| **General ledger, double-entry journal, accounting export, fixed assets, payroll, batch/lot/serial tracking** | Classified by the review itself as not required for a boutique launch. Recorded in Section 29.4; no plan change |

---

## 10. Acceptance Criteria Self-Check

| Criterion | Result |
|---|---|
| Every P0 applied or has a DECISION REQUIRED block | **Pass.** RT-001, RT-002, RT-003, RT-004, RT-005, RT-006, F-01, F-02, RT-010/M-01, C-04/C-05 all applied in full. No P0 required a business decision |
| No section contradicts another; each changed rule grepped and every mirror updated | **Pass** — see the mirror table below |
| `idx_stock_reservations_order_active` appears nowhere except as a retired artifact | **Pass.** Six remaining occurrences, all of which are the retirement itself: Part-1 §12.3 (retirement statement), Part-2 Guardrail #43, Part-2 §31 checklist ("appears nowhere"), Part-2 §34.4 check #6 ("absent"), Part-2 §35.2 (migration 0041's slug), Part-2 §38 D-23 (detection). Plus this changelog |
| Reservation window provably longer than the payment window | **Pass.** 60 min vs 30 min payment + 15 min reconcile interval, asserted by `reservation-window-outlasts-payment.test.ts` (§37.0 test #5) |
| `VariantInventoryDO` has a method that increases stock | **Pass.** `adjustStock()` in §11.3 and §36.2 |
| CartDO arms exactly one alarm | **Pass.** §6.8 code, §9.1, §36.6, Guardrail #45, check #16, D-41 |
| No route flow returns 403 on a normal top-level GET | **Pass.** §10.3 step 7 and §10.6 both state a failed GET binding renders a fresh page; §36.5 documents it in the contract; test #8 asserts it |
| `payment_events` has a uniqueness constraint on the provider event id | **Pass.** Migrations 0050–0052, Guardrail #46, check #24 |
| Every migration single-statement and correctly numbered | **Pass.** 0040–0071, one statement each, numbered from the real head of `0039` |
| `BudgetCounterDO` has one object ID format document-wide | **Pass.** `budget:{provider}` in §6.6, §24.2 (both prose and code sample), §36.3, Guardrail #49 |
| Section 27 restores Durable Object state | **Pass.** §27.2 snapshot cron, §27.3 steps 6–7, `restoreFromSnapshot()` |
| An oversell concurrency test exists in Section 37 | **Pass.** §37.0 test #1, written first |
| Section 34 staffable by the stated team size | **Pass.** 4 clusters, one CI gate, one monthly Owner review; team size stated in §34.0 and the Part-1 header |
| Guardrail count and cluster arithmetic balance | **Pass.** 11 + 9 + 9 + 21 = **50** |

### Mirror update record

Each changed rule was grepped across both parts; every location listed below was updated in the same pass.

| Rule changed | Mirrors updated |
|---|---|
| Reservation index shape | §0, §6.1 (constraint table), §12.3, Guardrails #32/#43, §31 checklist, §32 matrix, §34.4 #6, §35.2, §38 D-23/D-24, `V8_MIGRATION_PLAN.md` |
| Cleanup cron eligibility / reservation window | §0, §11.1 #16, §11.6, §12.3, §13.1, Guardrails #12/#50, §31, §32, §34.4 #21/#22, §37.0 #2/#5, §38 D-22 |
| `adjustStock()` | §0, §11.3, §12.2, §12.3, §13.2, §14.1, Guardrails #17/#44, §29 M4, §29.4, §31, §32, §34.4 #23, §36.2, §37.0 #6, §38 D-38 |
| One alarm per DO | §0, §6.3, §6.6, §6.8, §9.1, Guardrails #6/#13/#28/#45, §31, §32, §34.4 #16, §36.6, §37.0 #10, §38 D-05/D-41 |
| Buy Now binding | §0, §10.3, §10.6, Guardrail #40, §31, §32, §34.4 #14, §36.5, §37.0 #8/#9, §38 D-17 |
| Payment event uniqueness | §5, §6.1, §11.5, Guardrail #46, §31, §32, §34.4 #24, §35.2, §37.0 #14, §38 D-40, `V8_MIGRATION_PLAN.md` |
| Rendering model | §0, §1, §2.1, §3.3, §3.4, §19.1, §19.2, Guardrail #2, §31, §32, §34.4 #3, §38 D-03 |
| `BudgetCounterDO` object ID | §6.6, §24.2 prose, §24.2 code sample, §24.2 budget table, Guardrail #49, §31, §32, §34.4 #25, §36.3, §37.0 #19, §38 D-39 |
| VAT rule | §5, §6.1, §11.1 #8, §11.7, §15.2, §18.7, Guardrail #41, §31, §32, §34.4 #13, §37.0 #18, §38 D-19 |
| Migration discipline | §26.3, Guardrails #31/#48, §31, §34.4 #26, §35 (all), §37.0 #20, §38 D-35/D-36/D-37, `V8_MIGRATION_PLAN.md` |
| DO state in DR | §27.1, §27.2, §27.3, Guardrail #47, §31, §32, §34.4 #27, §36.2, §37.0 #7 |
| Section 34 rescope | §30 preamble, §33, §34.0–§34.10, §31 agent-awareness, §38.3, §38.5 |
