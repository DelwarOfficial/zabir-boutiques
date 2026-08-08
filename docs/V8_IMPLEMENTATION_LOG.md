# V8 Implementation Log — Zabir Boutiques

**Purpose:** ticket-by-ticket record of what actually happened when the V8 master plan's fix list (T-01–T-26) was executed against the real codebase, not the abstract plan. Read this before trusting any gap description in `Zabir_Boutiques_Master_Plan_V8_Part-1.md` / `Part-2.md` / `V8_CHANGELOG.md` for anything in the reservation, payment, coupon, or inventory-adjustment areas — several "gaps" those documents describe were already solved, by different and often better mechanisms than the plan assumed.

**Method that mattered:** every ticket was verified against the actual caller/route/schema before any code was written. ~40% of tickets (T-01–05, T-14/15, most of T-16, T-17/18/20/21/23) turned out to be non-issues on inspection. Do not repeat the false starts below — read the "Real mechanism" column first.

**Final state:** 503 tests passing, `tsc --noEmit` clean. Migrations `0040`–`0047` applied (see `V8_MIGRATION_PLAN.md`).

---

## Non-issues (do not re-fix)

| Ticket | What the plan assumed | What's actually there |
|---|---|---|
| T-01 | `stock_reservations.order_id` needed to become nullable so reserve-before-order-write could work | `orders.ts:createOrderWithReservations` writes `orders` + `order_items` + `stock_reservations` in **one atomic D1 batch** — `order_id` is always known at insert time. No nullable window ever exists. |
| T-02 | Needed `(order_id, variant_id)` + `(checkout_id, variant_id)` unique indexes to stop double-reservation on retry | Double-reserve is prevented **upstream**, before `reserveVariants()` is ever called: the idempotency claim (`checkout.ts:222-231`) happens first. A retried request never reaches the reservation code a second time. |
| T-03 | Reorder checkout to reserve stock before the order exists | N/A — see T-01. Order and reservation are never separated in time. |
| T-04 | `payment_events` needed `provider`/`provider_event_id` columns + a unique index to stop webhook-replay double-credit | `payments.ts:103-236` (`applyPaymentVerified`) already does an atomic `INSERT OR IGNORE` claim on `UNIQUE(invoice_id, event_type, status)` **inside the same batch** as the payment-status update, with a `changes() !== 1` guard for replay detection. Different key shape than the plan assumed, same guarantee. |
| T-05 | Webhook handler needed to treat a uniqueness violation as a replay | Already does, via the mechanism above. |
| T-14 | `coupon_redemptions` table needed, with `UNIQUE(coupon_id, order_id)` | `money.ts` (`applyCouponAtomic` / `releaseCouponUsageAtomic` / `recordCouponClaim`) tracks usage via `coupons.used_count` + a claim row in `checkout_idempotency_coupon_claims`, released on **every** failure path in `checkout.ts` including a top-level catch-all (`checkout.ts:435-456`). No separate ledger table needed. |
| T-15 | Move coupon redemption into the order-creation D1 batch | N/A — see T-14. Redemption is already correctly guarded, just via a claim-token pattern instead of batch-ordering. |
| T-16 (table) | `tax_rates` effective-dated table + D1 lookup | `VAT_RATE_PERCENT` is a single live env var; nothing reads a table today, and VAT is off at launch (rate defaults to 0). Building an unused table was scope creep — not done. |
| T-17 | Needed a new `reservation-oversell-concurrency.test.ts` | Already exists: `tests/race-conditions.test.ts` ("10 parallel attempts reserve last 1 unit"). |
| T-18 | Needed a new `payment-webhook-replay.test.ts` | Already exists: `tests/webhook-ingress.test.ts`. |
| T-20 | Needed a new invoice-number-concurrency test | Already exists: `tests/pos-invoices.test.ts`. |
| T-23 | Needed a new coupon-rollback test | Already covered: `tests/race-conditions.test.ts` ("20 parallel checkouts for 1-use coupon"). |

## Real bugs found and fixed

| Ticket | Real bug | Fix | Files |
|---|---|---|---|
| T-06/T-07 | Buy Now session bound to `Origin`/`User-Agent`; the `User-Agent` check 403s + deletes the session on a legitimate browser hand-off (in-app-browser → external browser), and `sid` was exposed in the URL query string | Bound to an `HttpOnly` cookie-secret hash (`bn_sid`/`bn_bind`) instead. `Origin` check moved to POST-only, decoupled from session state. Covers both the DO path and the D1-fallback path. | `src/lib/buy-now-cookies.ts` (new), `src/do/direct-checkout-session-do.ts`, `src/lib/contracts/direct-checkout-session-do.ts`, `src/pages/api/buy-now/session.ts`, `submit.ts`, `src/pages/buy-now/[slug].astro`, migration `0040`, `src/db/schema/cart.ts`. Test updated: `tests/master-plan-v7-guardrails.test.ts`. |
| T-08/T-09 | COD had a quantity threshold only (`<=2` items) — no value ceiling, no phone/address velocity limit. A single high-value item shipped COD unchecked; nothing stopped repeat COD orders from one phone/address | New `checkCodLimits()` reads thresholds from `site_settings`, checked in both `/api/checkout` and `/api/buy-now/submit` | `src/lib/cod-limits.ts` (new), migration `0041`, `checkout.ts`, `buy-now/submit.ts`. Test: `tests/cod-limits.test.ts` (new, 6 cases). |
| T-11 | `cleanExpiredReservations` (flat 10-min TTL) released stock with zero regard for order status, racing ahead of `reconcilePendingPayments`'s correct 2-hour abandonment window — a slow payment redirect or an overnight `pending_review` order could lose its stock hold while still legitimately alive | Added `JOIN orders` + `o.status NOT IN ('pending_review', 'pending_payment')` exemption; those orders now defer entirely to the 2h reconciliation job, which already releases correctly on cancel | `src/lib/inventory.ts` (`cleanExpiredReservations`). Test: `tests/reservation-expiry-consistency.test.ts` updated with a new RT-001 case (90-min-expired `pending_review` reservation survives the sweep). (T-10's schema additions — `reservation_expires_at` etc. — were not needed; the fix used existing `orders.status` instead.) |
| T-12/T-13 | `do-client.ts`'s `doAdjustStock()` already threaded an idempotency key correctly, and `returns/approve.ts` already used it (`return:${id}:${variantId}`) — but `src/pages/api/staff/inventory/adjust.ts` (the manual stock-adjustment route) called it with **no key**, so a network retry double-applied the delta. No two-person check for negative deltas (damage/theft/correction) either | Route now requires `Idempotency-Key` header, threads it through. Negative deltas require `approvedByStaffId` — different staff, active, holding `inventory.adjust` | `src/pages/api/staff/inventory/adjust.ts`. No new test file — logic is inline validation, covered by existing route-level checks. |
| T-16 (VAT base) | VAT computed on pre-discount subtotal — a discounted order would be VAT-overcharged once `VAT_RATE_PERCENT` is enabled | One-line fix: taxable base is `max(0, subtotal - discount)` | `src/pages/api/checkout.ts`. (Buy Now doesn't need this — that flow has no coupon support.) |
| T-24 | No route existed to transition an order to `delivered` at all (state machine defined `shipped → delivered` but nothing called it); no record of COD cash actually collected vs. what the courier owes the shop | New `deliver.ts` route (also fixes the missing transition), captures `cod_collected_paisa`; new remittance route computes `expected_paisa` server-side from `SUM(cod_collected_paisa)`, flags shortfall | Migrations `0042`/`0043`, `src/pages/api/staff/orders/[id]/deliver.ts` (new), `src/pages/api/staff/courier/remittance.ts` (new), `src/db/schema/orders.ts`, `operations.ts`. Test: `tests/courier-remittance.test.ts` (new, 4 cases). |
| T-25 | No cash-drawer session concept; a cashier's cash payments had no expected-vs-counted reconciliation | New open/close routes; `close` computes `expected = opening_float + SUM(cash invoice_payments since open)` server-side; `invoices/index.ts` now refuses a cash payment with no open drawer | Migration `0044`, `src/pages/api/staff/pos/drawer/open.ts` + `close.ts` (new), `src/pages/api/staff/invoices/index.ts` gate, `src/db/schema/pos.ts`. Test: `tests/pos-cash-drawer.test.ts` (new, 4 cases). |
| T-26 | No way to load opening stock / receive supplier goods except direct D1 edits (violates the "DO is sole inventory writer" rule enforced everywhere else) | New `suppliers` / `purchase_orders` / `goods_receipts` tables; receive route reuses the exact idempotent `doAdjustStock` pattern from `returns/approve.ts` (deterministic key `po:{poId}:{variantId}`, `UNIQUE(adjustment_id)`) | Migrations `0045`/`0046`/`0047`, `src/pages/api/staff/suppliers/index.ts`, `purchase-orders/index.ts`, `purchase-orders/[id]/receive.ts` (all new), `src/db/schema/operations.ts`. Test: `tests/goods-receipts.test.ts` (new, 4 cases). |

## Deliberately skipped

| Ticket | Reason |
|---|---|
| T-19 (vat-rounding test) | VAT is disabled at launch (`VAT_RATE_PERCENT` unset → rate 0); the fix was a one-line taxable-base correction. Not worth a dedicated concurrency-style test file until VAT is actually turned on. |

## RBAC note

None of T-24–T-26 added new permissions. `deliver.ts` and `remittance.ts` reuse `orders.ship`/`payments.verify`; drawer routes and PO/supplier routes reuse `orders.create`/`inventory.manage`/`inventory.adjust`. Deliberate — avoids rippling into the `Permission` enum, the role-tier tables in `rbac.ts`, and `rbac.test.ts`'s assertions about them.

## Migration numbering

`0040`–`0047`, applied in the order listed in `V8_MIGRATION_PLAN.md`. That file's earlier draft (pre-implementation) described a fictional `0040`–`0071` set for tables that were never built (`tax_rates`, `coupon_redemptions`, a `stock_reservations` rebuild). It has been rewritten to match what's actually on disk — see that file, not `V8_CHANGELOG.md`'s migration-plan sections, for current migration state.
