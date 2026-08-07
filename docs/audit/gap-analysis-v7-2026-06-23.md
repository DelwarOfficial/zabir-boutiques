# Gap Analysis Report: Zabir Boutiques V8 Master Plan vs Current Codebase

**Date:** 2026-06-23  
**Version:** V8 Final  
**Overall Compliance Score:** **64%** aligned with V8 Master Plan  
**Analyst:** Architecture Review + Red-Team Analysis  
**Status:** Production-Blocking Issues Identified

---

## Executive Summary

The current codebase has significant divergence from the V8 Master Plan. While core business logic (checkout pricing, inventory DO, idempotency) is relatively mature, the **foundational state management layer** (CartDO authority) and several **production-critical configurations** are incomplete or misaligned.

### Compliance by Domain

| Domain                        | Score  | Status     | Criticality |
|-------------------------------|--------|------------|-------------|
| **Cart Architecture**         | 42%    | Critical   | P0          |
| **Checkout & Payment Flow**   | 78%    | High       | P0          |
| **Inventory & Stock Authority** | 85%  | Good       | P1          |
| **Data Layer & Contracts**    | 70%    | Medium     | P1          |
| **Security (CSP, Headers)**   | 48%    | Critical   | P0          |
| **Cron & Operations**         | 35%    | Critical   | P0          |
| **Testing & Guardrails**      | 80%    | Good       | P2          |
| **Observability**             | 55%    | Medium     | P1          |

### Top 7 Highest-Risk Gaps (Must Fix Before Launch)

| Rank | Gap ID     | Title                                           | Severity | Risk Level     |
|------|------------|--------------------------------------------------|----------|----------------|
| 1    | **C-01**   | CartDO not used as authoritative cart source     | P0       | Catastrophic   |
| 2    | **CHK-01** | CSP blocks all payment & courier domains         | P0       | Catastrophic   |
| 3    | **C-02**   | CartDO alarm lifecycle & guarded projection incomplete | P0 | High           |
| 4    | **OPS-01** | All cron triggers commented out in wrangler.jsonc | P0    | High           |
| 5    | **C-03**   | localStorage still treated as cart source of truth | P0   | High           |
| 6    | **INV-01** | Direct D1 stock mutations in staff/return paths  | P1       | Medium-High    |
| 7    | **C-04**   | CartDO contract interface too thin               | P1       | Medium         |

**Estimated Remediation Effort:** 14–18 engineer-days

---

## Detailed Gap Analysis

### 1. Cart Architecture (Highest Risk Area)

#### GAP-C-01: CartDO is not the authoritative cart source
- **Severity:** P0
- **Master Plan Reference:** §2, §6, §9.1, §10, Guardrail #5 & #9
- **Current Evidence:**
  - `src/hooks/useLocalCart.ts` + `src/lib/cart-store.ts` use `localStorage` as primary state
  - `src/islands/GuestCheckout.tsx` sends raw `cart` array instead of `session_id`
  - `src/pages/api/checkout.ts:85` requires `session_id` and loads from `CartDO`, causing `MISSING_CART_SESSION`
- **Root Cause:** Legacy optimistic cart model was never migrated to CartDO architecture.
- **Risk:** Guest checkout fails or gets hacked around. Cart state can be tampered with client-side.
- **Required Fix:**
  - Make `CartDO` the single source of truth.
  - Read `zb_cart_sid` cookie in checkout.
  - Refactor `useLocalCart` to be a cache layer only (hydrate from `/api/cart`).

#### GAP-C-02: CartDO alarm lifecycle & D1 projection incomplete
- **Severity:** P0
- **Master Plan Reference:** §9.1 (Two-stage alarm), §7.3 (Guarded upsert), Guardrail #6 & #7
- **Current Evidence:**
  - `src/do/cart-do.ts` only sets a single 5-minute alarm.
  - No `soft_alarm_active`, `five_min_alarm_at`, or `thirty_day_alarm_at` logic.
  - `getCart()` does not re-arm alarm after eviction.
  - D1 `cart_activity` upsert is naive (no `last_d1_write_seq` guard).
- **Risk:** Stale writes, broken abandoned cart logic, memory leaks in DOs.
- **Fix:** Implement full two-stage alarm lifecycle + monotonic guarded upsert from Master Plan §7.3.

#### GAP-C-03: localStorage treated as authoritative cart state
- **Severity:** P0
- **Master Plan Reference:** §35.1 (Forbidden Patterns)
- **Current Evidence:** `cart-store.ts` reads/writes `zb_cart_v68a` as primary source.
- **Risk:** Violates core V8 principle. Causes drift and tampering surface.
- **Fix:** Convert to cache-only. Remove as source of truth.

#### GAP-C-04: CartDOContract interface too thin
- **Severity:** P1
- **Master Plan Reference:** §9.1
- **Current Evidence:** `src/lib/contracts/cart-do.ts` only defines 5 methods. Missing `applyCoupon`, `removeCoupon`, `updateCustomerContact`, `mergeCart`.
- **Fix:** Expand contract + add typed wrappers in `do-client.ts`.

---

### 2. Checkout & Payment Flow

#### GAP-CHK-01: CSP blocks payment, courier, and fraud domains
- **Severity:** P0
- **Master Plan Reference:** §18.2 (Public CSP)
- **Current Evidence:** `src/middleware.ts` CSP is extremely restrictive. Missing:
  - `connect-src`: UddoktaPay, SSLCommerz, FraudBD, Resend, DeepSeek, Pathao, etc.
  - `frame-src`: UddoktaPay, SSLCommerz
- **Risk:** Payment redirects and iframes will be blocked in production.
- **Fix:** Implement split public/staff CSP as defined in V8 §18.2 and §18.3.

#### GAP-CHK-02: COD prepayment rule uses line count instead of quantity sum
- **Severity:** P1
- **Master Plan Reference:** §12.1 step 9
- **Current Evidence:** `src/pages/api/checkout.ts` uses `items.length` instead of total quantity.
- **Fix:** Change to `items.reduce((sum, i) => sum + i.quantity, 0)`.

---

### 3. Inventory & Stock Authority

#### GAP-INV-01: Direct D1 stock mutations bypass VariantInventoryDO
- **Severity:** P1
- **Master Plan Reference:** §2, §14, Guardrail #15 & #36
- **Current Evidence:**
  - `src/pages/api/staff/inventory/adjust.ts`
  - `src/pages/api/staff/returns/[id]/approve.ts`
  - `src/lib/invoices.ts` (void path)
- **Risk:** DO/D1 divergence and potential overselling on admin actions.
- **Fix:** Route all stock changes through `VariantInventoryDO.directSale()` / `reverseDirectSale()`.

---

### 4. Cron & Operations

#### GAP-OPS-01: All cron triggers are commented out
- **Severity:** P0
- **Master Plan Reference:** §29
- **Current Evidence:** `wrangler.jsonc` lines 49–67 — entire cron block is commented out.
- **Risk:** No reservation cleanup, no payment reconciliation, no D1 backups, no sitemap generation.
- **Fix:** Resolve Dashboard conflict and deploy crons via wrangler.

---

### 5. Security

#### GAP-SEC-01: No separate staff CSP
- **Severity:** P1
- **Master Plan Reference:** §18.3
- **Current Evidence:** Single CSP applied to all routes.
- **Fix:** Implement route-aware CSP dispatch in middleware.

---

### 6. Testing & Guardrails

#### GAP-TST-01: Drift audit only covers ~35/44 guardrails
- **Severity:** P2
- **Master Plan Reference:** §34
- **Fix:** Update `scripts/audit/audit-drift.ts` to validate all 44 guardrails.

#### GAP-TST-02: Missing component tests for critical islands
- **Severity:** P2
- **Fix:** Add tests for `GuestCheckout.tsx`, `AddToCartButton.tsx`, and cart flow.

---

## Prioritized Remediation Roadmap

### Phase 0: Launch Blockers (Must fix before any production deploy)

| Priority | Gap ID     | Task                                              | Effort | Owner     |
|----------|------------|---------------------------------------------------|--------|-----------|
| P0       | CHK-01     | Fix CSP (public + staff split + all domains)      | 1 day  | Lead      |
| P0       | C-01       | Wire checkout to CartDO via session cookie        | 2 days | Full-stack|
| P0       | C-03       | Remove localStorage as cart source of truth       | 2 days | Full-stack|
| P0       | OPS-01     | Enable all cron triggers                          | 1 day  | DevOps    |
| P0       | C-02       | Implement CartDO two-stage alarm + guarded upsert | 2 days | Backend   |

### Phase 1: State Integrity (High Priority)

| Priority | Gap ID     | Task                                              | Effort | Owner     |
|----------|------------|---------------------------------------------------|--------|-----------|
| P1       | C-04       | Expand CartDOContract + typed wrappers            | 1.5d   | Backend   |
| P1       | INV-01     | Remove direct D1 stock mutations                  | 2 days | Backend   |
| P1       | C-02       | Add CartDO alarm re-arm on `getCart()`            | 1 day  | Backend   |

### Phase 2: Hardening & Quality

| Priority | Gap ID     | Task                                              | Effort | Owner     |
|----------|------------|---------------------------------------------------|--------|-----------|
| P2       | SEC-01     | Route-aware CSP dispatch                          | 1 day  | Backend   |
| P2       | TST-01/02  | Expand test coverage + drift audit                | 2 days | QA + Dev  |
| P2       | CHK-02     | Fix COD prepayment calculation                    | 0.5d   | Backend   |

---

## Implementation Recommendations

### 1. Cart Session Wiring (Recommended Pattern)

```ts
// In /api/checkout.ts
const sessionId = getCartSessionIdFromCookie(request);
if (!sessionId) {
  return json({ ok: false, code: "MISSING_CART_SESSION" }, { status: 400 });
}

const cartDO = env.CART_DO.get(env.CART_DO.idFromName(sessionId));
const cart = await cartDO.fetch("https://do/get").then(r => r.json());