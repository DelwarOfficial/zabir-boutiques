# 08 — Re-Verified Findings (REDTEAM Step 8)

**Date:** 2026-08-08 · **Method:** every cited file:line re-read at HEAD; seeded K-01..K-45 confirmed/refuted with current evidence; master-plan invariant violations added.

> Severity is business-impact calibrated (per prompt §6). Critical = direct money loss / PII leak / auth bypass / compliance violation. The invariant violations (INV-*) are the deepest defects — they void V8 guarantees the K-findings only nibble at.

---

## A. CRITICAL — invariant violations (void V8 guarantees)

### FINDING-INV-1: `confirm()` decrements `stock` — violates V8 §11.3 stock arithmetic
- **Domain:** Inventory
- **File:line:** `src/do/variant-inventory-do.ts:190` (`this.stock -= qty;` in confirm action); mirrored at D1 in `src/lib/inventory.ts:366` (`quantity = quantity - ?1` inside `confirmReservationsForOrder`)
- **Severity:** Critical
- **CWE:** CWE-840 (business logic), CWE-682 (incorrect calculation)
- **Master-plan ref:** §11.3 stock table (Part-1:1468-1477), Guardrail #44
- **Description:** V8 mandates `stock` is invariant under `confirm()`; only `reserved → sold` shifts (`reserved -= qty; sold += qty`). The DO instead decrements `stock` on confirm, directly contradicting its own `adjustStock()` (which correctly treats stock as invariant). `available = stock - reserved - sold` therefore drifts from D1 on every confirmed order.
- **Attack scenario:** Two buyers reserve the last unit; first confirms → DO `stock` drops, `sold` rises, `reserved` drops. Second buyer's reservation now points at a `stock` value that no longer reflects "units ever received." Inventory reconciliation reports phantom drift; `getAvailability()` returns wrong numbers; stocktake corrections applied via `adjustStock` compound the error.
- **Fix:** In `variant-inventory-do.ts:186-197` confirm action, replace `this.stock -= qty; this.reserved -= qty; this.sold += qty;` with `this.reserved -= qty; this.sold += qty;`. Mirror at `inventory.ts:366` (do not decrement `quantity` on confirm).
- **Verification:** §37.0 #1 `reservation-oversell-concurrency` + a new `confirm-stock-invariant` test asserting `stock` unchanged across reserve→confirm.

### FINDING-INV-2: Settled-money ledger layer entirely missing (F-01 / RV8-001)
- **Domain:** Payments
- **File:line:** `grep payment_transactions src/ db/` = 0 hits; `db/migrations/0001_initial_v6_8a_schema.sql:231-240` (`payment_events` has `UNIQUE(invoice_id, event_type, status)`, no `provider`/`provider_event_id` columns)
- **Severity:** Critical
- **CWE:** CWE-294 (authentication bypass by replay), CWE-697 (incorrect comparison)
- **Master-plan ref:** §0 (Part-1:87), §11.5 step 7, Guardrail #46
- **Description:** The V8 double-credit defenses — `payment_events.UNIQUE(provider, provider_event_id)` and `payment_transactions.UNIQUE(payment_event_id, direction)` — do not exist. Current dedup is the ingress body-hash id PK (weak, K-06) plus a single `payments.status` WHERE guard in `applyPaymentVerified`. `applyPaymentVerified` (`src/lib/payments.ts:188`) generates a fresh `crypto.randomUUID()` for `payment_events.id`, so the INSERT never conflicts (the dedup is a placebo on this path).
- **Attack scenario:** Queue consumer crash between `applyPaymentVerified` commit and `msg.ack()` → redelivery → fresh UUID → second `payment_events` row → second credit, bounded only by the `payments.status` guard. Any future refactor relaxing that guard reopens a direct double-credit.
- **Fix:** Land V8 migrations (renumbered 0048+ per C1) for `payment_events` columns + unique, `payment_transactions` table + unique; rewrite `applyPaymentVerified` to use the stable provider event id and write the ledger row keyed by it; treat unique violation as a no-op replay.
- **Verification:** §37.0 #14 `payment-webhook-replay` — same signed event 3× = 1 row, 1 ledger entry, 1 credit.

### FINDING-INV-3: `InvoiceCounterDO` is dead code — receipts use racy D1 read-modify-write (RT-008)
- **Domain:** POS / compliance
- **File:line:** `grep INVOICE_COUNTER_DO.get src/` = 0 call sites; `src/lib/invoices.ts:280` `generateReceiptNoWithRetry` → `:58-73` `SELECT receipt_no … ORDER BY … LIMIT 1` + compute next
- **Severity:** Critical (Mushak compliance)
- **CWE:** CWE-367 (TOCTOU race)
- **Master-plan ref:** §15.5 (Part-1:1903-1918), RT-008
- **Description:** The DO is bound (`wrangler.jsonc:93`) and exported (`entry-cloudflare.ts:37`) but never instantiated. `invoices.ts` uses the exact `SELECT MAX+1` anti-pattern V8 §15.5 forbids. Two concurrent cashiers race the SELECT→gap; the `UNIQUE(receipt_no)` constraint + retry only catches collisions after the fact, producing burned (gapped) serials — a VAT-audit liability.
- **Fix:** Replace `generateReceiptNoWithRetry` with `env.INVOICE_COUNTER_DO.idFromName('invoice-counter:{YYYYMMDD}')` → `nextInvoiceNumber()`. On D1 invoice-write failure, record the serial as `serial_burned` in `invoice_audit` (never reuse).
- **Verification:** §37.0 #12 `pos-invoice-number-concurrency` — 20 concurrent creations = 20 distinct sequential serials.

### FINDING-INV-4: DO snapshot + `restoreFromSnapshot` entirely missing (RT-004)
- **Domain:** Disaster recovery
- **File:line:** `grep restoreFromSnapshot src/` = 0; `grep backups/do src/` = 0; `src/lib/cron-dispatch.ts:40-45` hourly job runs reconcile only
- **Severity:** Critical
- **CWE:** CWE-400 (uncontrolled resource consumption — unrecoverable state), CWE-754
- **Master-plan ref:** §27.2 (Part-2:87), §27.3 step 6-7, RT-004
- **Description:** The hourly VariantInventoryDO→R2 JSONL snapshot, the `restoreFromSnapshot()` DO method, and the `DR_RESTORE_ENABLED` env gate all absent. The weekly restore drill (`backup.ts:287-339`) only counts D1 rows — it cannot assert DO/D1 stock parity. Restoring D1 leaves every DO holding pre-restore counters; the cleanup cron can never reconcile orphaned reservations.
- **Fix:** Add hourly cron writing `{variant_id,stock,reserved,sold,snapshot_id,captured_at}` to R2 `backups/do/…`; add `restoreFromSnapshot()` to VariantInventoryDO (gated by `DR_RESTORE_ENABLED`); extend the drill to assert per-variant `DO.reserved == SUM(active stock_reservations)`.
- **Verification:** §37.0 #7 `dr-do-d1-parity`.

### FINDING-INV-5: Audit log stores raw PII — `customer_ref` salted hash absent (S-07)
- **Domain:** Privacy / compliance
- **File:line:** `audit_log` schema (`db/migrations/0001…:266-277`) has no `customer_ref`; `src/lib/audit.ts:76-94` INSERT writes raw `entity_id` (e.g. email/phone); `grep AUDIT_CUSTOMER_REF_SALT wrangler.jsonc env.d.ts` = 0
- **Severity:** Critical
- **CWE:** CWE-532 (inclusion of sensitive information in log files), CWE-359 (exposure of private personal information)
- **Master-plan ref:** §18.2 (S-07), §28.3, Guardrail #33
- **Description:** The 7-year append-only audit log holds raw customer identifiers, directly conflicting with the §28.3 deletion right — anonymizing the customer row cannot satisfy deletion when the audit log still links the phone/email. The salted-hash `customer_ref` and `AUDIT_CUSTOMER_REF_SALT` secret exist only in markdown.
- **Fix:** Add `customer_ref` column + `AUDIT_CUSTOMER_REF_SALT` secret; in `prepareAuditLogInsert` hash any customer identifier into `customer_ref`, store only `order_id` + hash (never raw phone/email). Mark the salt NEVER-rotated in the rotation runbook.
- **Verification:** `redaction` (§37.0 #21) + grep proving no raw phone/email in audit writes.

### FINDING-INV-6..10 (summary — see 01-system-truth-sheet.md conflicts C7/C8 + guardrails)

| ID | Invariant | Evidence | Severity |
|---|---|---|---|
| INV-6 | Reservation TTL 10-min not 60-min (F-02/G50) | `src/lib/reservation-ttl.ts:13 RESERVATION_TTL_MINUTES = 10` | Critical |
| INV-7 | No `stock_reservations.checkout_id`; retired index present; no 2 partial uniques (RT-002) | `0001:188-198`; `0028:3-6` dropped partial clause; grep `checkout_id` db/ = 0 | Critical |
| INV-8 | BudgetCounterDO object ID `{provider}:{date}` not `budget:{provider}` (G49) | `src/do/budget-counter-do.ts:330,338,346` | High→Critical (monthly cap unenforceable) |
| INV-9 | Order state machine V7 (missing `created`/`confirmed`/`processing`) | `order-state-machine.ts:13`; schema `0013:57` | High |
| INV-10 | VAT from `VAT_RATE_PERCENT` env not D1 `tax_rates` (G41) | `checkout.ts:248`, `buy-now/submit.ts:217`, `staff/orders/create.ts:133`, `staff/invoices/index.ts:137`; `env.d.ts:58`; `tax_rates` table absent | High (compliance) |

---

## B. HIGH — re-verified K-findings

| ID | Status | CWE | Evidence (current file:line) | Failure impact | Fix |
|---|---|---|---|---|---|
| **K-13a** | CONFIRMED | CWE-601 | `checkout.ts:383,391-393` builds `redirectUrl`/`cancelUrl` from raw `context.request.headers.get('Origin')` with no validation | Open redirect → phishing/payment redirect to attacker origin | Validate Origin against own-origins allowlist; fall back to `env.PUBLIC_SITE_URL` |
| **K-14** | CONFIRMED | CWE-287 | `direct-checkout-session-do.ts:223` `if (!session.bindingHash) return true;`; `do-client.ts:449-461` `doCreateDirectSession` sends no `bindingSecret` → DO stores `sha256('')`; `submit.ts:54` `?? ''` | Empty binding hashes match → Buy Now session binding is a no-op | Require non-empty `bindingSecret` at create; reject `bindingHash === sha256('')` |
| **K-19** | CONFIRMED | CWE-287/807 | `staff/login.ts:64` `if (env.TURNSTILE_SECRET_KEY && !body.totp_code)` — any `totp_code` skips Turnstile | Bot-check bypassable by sending any `totp_code` field | Decouple: Turnstile unconditional when secret set; validate TOTP independently |
| **K-22** | CONFIRMED | CWE-345 | `totp/verify.ts:26` `verifyTotpCode(body.secret, body.code)`; `:29` `storeStaffTotpSecret(... body.secret)` | Attacker enrolls own TOTP on stolen session → persistent owner ATO | Store server-generated pending secret at enrollment; verify against that; ignore `body.secret` |
| **K-23** | CONFIRMED | CWE-306 | `totp/disable.ts:7-18` only `requireAuth`+role, no step-up | Stolen cookie disables 2FA | Require `requireRecentStaffSession` before `clearStaffTotpSecret` |
| **K-24** | CONFIRMED | CWE-308 | `requireRecentStaffSession` absent on: `returns/[id]/approve.ts:21`, `invoices/[id]/void.ts:22`, `api-keys/index.ts:46/121`, `roles/index.ts:51`, `settings.ts:28`, `cache/purge.ts:12`, `inventory/adjust.ts:12` | Sensitive financial/admin ops lack step-up | Call `requireRecentStaffSession` in each |
| **K-35** | CONFIRMED | CWE-347 | `grep webhook|signature|hmac src/lib/integrations/courier/` = 0; no courier webhook route | Forged courier status callbacks (fake delivery) | Add `/api/courier/[provider]/webhook` with HMAC + replay guard |

---

## C. MEDIUM / LOW — re-verified K-findings (table)

| ID | Sev | Status | One-line current evidence |
|---|---|---|---|
| K-01 | Med | CONFIRMED | `webhook.ts:29-32` IPN-key check fail-open (both operands conditional) |
| K-02 | Low | CONFIRMED | `payment-webhook-ingress.ts:24-31` generic `X-Signature`/`Signature` fallbacks (PAY-003 open) |
| K-03 | Med | PARTIAL | `payments/create.ts:18-22,66` client `Idempotency-Key` becomes `payments.id` PK |
| K-04 | Med | CONFIRMED | `payments/status/[id].ts:8-26` no auth, no ownership — unauthenticated amount/invoice leak |
| K-05 | Med | CONFIRMED | `webhook.ts:55-63` `void work` no-retry fallback; provider already got 200 |
| K-06 | Med | CONFIRMED | `payment-webhook-ingress.ts:44-53` event-id fallback `sha256(rawBody)` |
| K-07 | Med | CONFIRMED | `payments.ts:154-157` order_id mismatch check skipped when metadata absent |
| K-08 | Med | CONFIRMED | `payments.ts:203-240` partial-prepay holds reservation indefinitely (no release path) |
| K-09 | Med | CONFIRMED | `checkout.ts:354-376` `advance_paisa` set in separate UPDATE → 0-paisa window |
| K-10 | Med | CONFIRMED | `coupon-rate-limit.ts` dead code; `validate-coupon.ts` no rate limit |
| K-11 | High | CONFIRMED | `validate-coupon.ts:12,43,55-62` trusts client `subtotalPaisa` + leaks coupon params |
| K-12 | Med | CONFIRMED (mitigated) | `buy-now/submit.ts:145-148` `body.variant_id` overrides session (contained by product check) |
| K-15 | Med | CONFIRMED | `fraud.ts:19,80-81` circuit-open/timeout → score 50 → review → order allowed (fail-open) |
| K-16 | Med | PARTIAL | `fraud/override.ts:24-26` has step-up but no cooldown/rate-limit |
| K-17 | Low-Med | CONFIRMED | `cod-limits.ts:69` address velocity weak normalization (no whitespace/punct/unicode) |
| K-17 | — | — | (split row above) |
| K-18 | Med | CONFIRMED | `checkout.ts:88,97` `body.session_id` overrides `zb_cart_sid` cookie |
| K-20 | Low | CONFIRMED | `session-blacklist.ts` / `login.ts:193` / `rbac.ts:218` three divergent KV namespaces; revocation = D1 only |
| K-21 | Med | CONFIRMED | `reset-password.ts:65-67` sibling tokens not invalidated account-wide |
| K-25 | Med | CONFIRMED | `password.ts:20` PBKDF2 100k iterations (OWASP ≥600k) |
| K-26 | Med | CONFIRMED | `login-rate-limit.ts:40` fails open when SESSION KV missing |
| K-27 | Med | CONFIRMED | `audit.ts:19`, `middleware.ts:120`, `api-keys.ts:89` `X-Forwarded-For` fallback (spoofable; drives api-keys IP allowlist) |
| K-28 | Med | CONFIRMED | `totp.ts:52-58` no replay protection; `otp-secrets.ts:100` no real backup codes |
| K-29 | Med | CONFIRMED | non-CT compares in phone-verification/login/step-up/csrf |
| K-30 | Med | CONFIRMED | `pii-scrubber.ts:9-23` missing NID/passport/postal/name/dob keys |
| K-31 | Med | CONFIRMED | `audit.ts:104,160` windowed chain verify (LIMIT 1000/10000) |
| K-32 | — | (see INV-3) | InvoiceCounterDO dead code |
| K-33 | Med | CONFIRMED | `returns/[id]/approve.ts:135-153,182-188` restock before refund; not reversed on failure |
| K-34 | Med | CONFIRMED | `courier.ts:86` `body.mock === true` settable in prod |
| K-36 | Low | CONFIRMED | `csrf-rotation.ts:8` placeholder; key never actually rotates |
| K-37 | Low-Med | CONFIRMED | `confirm.ts:76-96` bypasses `canTransition()` (inline status ladders) |
| K-38 | Med | CONFIRMED | no `cancel`/`refund` order API route exists |
| K-39 | Med | CONFIRMED | `consumers.ts:152` abandoned-cart URL leaks `session_id` in query |
| K-40 | Med | CONFIRMED | `cart/index.ts:116` raw UUID cookie (no HMAC); `doMergeCart` dead code |
| K-41 | — (test integrity) | CONFIRMED | `race-conditions.test.ts:34-44` fake (sequential JS, no real reserve/D1) |
| K-42 | Med | CONFIRMED | 3 `*-dlq` declared, 0 consumers; 3 queues have no DLQ |
| K-43 | Low | CONFIRMED | `consumers.ts` order-email not idempotent on retry |
| K-44 | Med | CONFIRMED | `do-client.ts:153-166` doAdjustStock D1 fallback non-atomic (SELECT-then-UPDATE) |
| K-45 | — (test integrity) | CONFIRMED | `paid-expired-reservation.test.ts` hand-rolled Map, no SQL |

**Re-verification tally:** of 45 seeded findings — **45 CONFIRMED/PARTIAL (100%)**, 1 REFUTED (K-13b buy-now open-redirect, mitigated by `:59-62` Origin check). 0 false alarms in the seed.

---

## Domain posture (2 lines each)

- **Payments:** happy path hardened (server-authoritative pricing, atomic batches, reconciliation backstop); **V8 ledger invariants unimplemented** (no `payment_transactions`, placebo `applyPaymentVerified` dedup) + ingress edges weak (fail-open IPN, generic sig headers, body-hash event id, unauth status endpoint, client-chosen payment PK, checkout open-redirect).
- **Auth/RBAC/CSRF:** spine sound (`__Host-` cookies, D1 `is_revoked`, two-person rule, step-up primitive exists); **TOTP sub-system is the weak flank** (client `body.secret`, no disable step-up, Turnstile bypass via any `totp_code`, owner not TOTP-gated until enrollment). **S-07 `customer_ref` HMAC entirely unimplemented** = compliance blocker.
- **Inventory/Orders:** D1 atomic-batch discipline strong; **4 of 6 checked invariants violated** (confirm decrements stock, 10-min TTL, no checkout_id/2 partials, no snapshot/restore); orphaned primitives (InvoiceCounterDO, `doMergeCart`); **missing core lifecycle endpoints** (no cancel/refund); client input steers variant + coupon subtotal; fraud fail-opens; restock-before-refund not reversed.

---

## Remaining steps (not yet executed this pass)

- **Step 2** Attack-surface map (per-endpoint inventory)
- **Step 3** STRIDE + top-10 attack trees with PoCs
- **Step 4** Domain-by-domain §4.1-4.13 verify-checklists (partially covered via K-reverification + invariants)
- **Step 5-7** Finding format polish + cross-cutting (deps, logging, BC, Bangladesh compliance)
- **Step 10** `REDTEAM-FINAL-REPORT.md` consolidation

These follow in subsequent passes. The truth sheet (01) + this findings file (08) are the evidence-anchored foundation; all later steps reference them.
