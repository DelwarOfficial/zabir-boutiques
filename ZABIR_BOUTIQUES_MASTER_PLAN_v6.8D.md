# Zabir Boutiques AI Commerce Master Plan

**Architecture:** Cloudflare-Native | Astro 6 + @astrojs/cloudflare 13+
**Infrastructure:** D1 + R2 + KV + Workers
**Integrations:** UddoktaPay + FraudBD | Bangladesh F-Commerce
**Status:** Production Handoff Ready | June 2026

## 1. Document Purpose
This master plan serves as the definitive technical and business architecture reference for Zabir Boutiques. It formalizes the finalized v6.8D project specification, reconciling previous drafts into an authoritative source for deployment, security, payment flows, and operational guardrails.

## 2. Client-Ready Master Plan Foundation

| Field | Final Value |
| :---: | :--- |
| **Document Title** | Zabir Boutiques AI Commerce Master Plan |
| **Version** | Production Reconciled v6.8D |
| **Target Platform** | Cloudflare Workers + Static Assets + D1 + R2 + KV |
| **Core Framework** | Astro 6 (output: "static" + on-demand via adapter) + Cloudflare Workers |
| **Adapter** | @astrojs/cloudflare 13.x |
| **UI Strategy** | React 19 Islands (client:idle hydration) |
| **Key Integrations** | UddoktaPay, FraudBD, DeepSeek/OpenAI |
| **Regional Context** | Bangladesh F-commerce (COD-first, Phone Normalization) |

---

## 3. Architecture Overview
The platform uses **Astro static output** (`output: "static"`) with the Cloudflare adapter providing the Worker runtime for on-demand routes. Static pre-built pages for marketing/content routes; server execution (via adapter) for checkout, order tracking, staff workflows, payment verification, fraud routing, and API routes.

### 3.1 Key Distinction: Static Build + Pages Functions / Worker
- **Static routes** (home, product detail, category listing) are pre-built during `astro build` as HTML files (and can use build-time snapshots from D1).
- **Dynamic / on-demand routes** (checkout, staff, API endpoints, any `prerender = false`) execute in the Cloudflare Worker / Pages Functions with full access to D1, KV, R2, and secrets.
- Per-route control via `export const prerender = false` (or adapter behavior) for anything needing fresh data or mutations.

### 3.2 Absolute Guardrails
- **Database:** Use only SQLite-compatible syntax (Cloudflare D1). No PostgreSQL-only features.
- **Writes:** All writes go through Pages Function routes. Frontend public pages must never write directly to D1, R2, or KV.
- **Money:** All money values use INTEGER paisa. Floating-point money fields are banned.
- **Checkout Integrity:** Checkout uses fresh D1 conditional updates (`reserveVariants()`). It ignores browser-supplied unit prices, subtotals, or totals.
- **Payments:** UddoktaPay must be verified server-to-server.
- **Cleanup:** Automated cron job required every 10 minutes to release expired stock reservations.
- **Build Validation:** Build must fail immediately if snapshot generation fails. An escape hatch (`npm run build:skip-snapshots`) exists for CI environments without D1 read access.

---

## 4. Operational Guardrails & Checkout Flow

### 4.1 Guest Checkout Flow
1. Validate idempotency key (header `Idempotency-Key` or body `idempotency_key`).
2. Normalize phone (+880).
3. Parse cart — variant_id + quantity only. Client prices are never trusted.
4. Load authoritative variant snapshots from D1.
5. Compute subtotal + delivery server-side from D1 price_paisa.
6. Claim idempotency (prevents duplicate concurrent processing).
7. Apply coupon atomically (if provided, D1 conditional update).
8. Compute total = subtotal + delivery - discount (minimum 0).
9. Evaluate prepayment rule:
   - ≤2 items + COD → no prepayment.
   - >2 items + COD → rejected with `402 PREPAYMENT_REQUIRED`. Client must retry with `partial_prepay`.
   - `partial_prepay` → 50% advance via UddoktaPay, 50% COD on delivery.
   - `uddoktapay` → full online payment, no split.
   - `in_store` → exempt (walk-in, no payment needed).
10. Check FraudBD risk score (skip for in-store).
11. Atomically reserve variants (`reserveVariants()`).
12. Create order with D1 atomic batch (order + order_items + stock_reservations).
13. Store advance_paisa / balance_paisa via UPDATE.
14. Complete idempotency (caches response for retry replay).

### 4.2 Operations & Staff Workflows

**3.36.1 In-Store Order Creation**
- API route: `POST /api/staff/orders/create` with `channel: 'in_store'`.
- Staff dashboard allows creating orders for walk-in customers.
- Orders auto-confirmed (`staff_confirmed`), stock deducted immediately.
- No COD/UddoktaPay initiation or fraud check required.

**3.36.2 Owner/Super Admin Coupon Management**
- API route: `POST /api/staff/coupons` (owner-tier only, `assertOwnerOnly()`).
- Only Owner/Super Admin can create coupons (fixed amounts: ৳50, ৳100, ৳150, ৳200).
- All changes logged in the audit system.

**3.36.3 Staff-Assisted Phone Orders**
- API route: `POST /api/staff/orders/create` with `channel: 'phone' | 'messenger' | 'whatsapp'`.
- Server-authoritative pricing and inventory apply.
- Prepays the same checkout pipeline as guest minus idempotency.

**3.36.4 Mandatory Partial Prepayment**
- Orders with > 2 items require 50% advance via UddoktaPay.
- Flow: Guest checkout with COD → 402 rejection with advance amount → client retries with `payment_method: 'partial_prepay'` → order created with split → `/api/payments/create` charges the advance amount only → webhook marks `payment_status = 'partially_paid'` (no inventory deduction) → staff confirms order manually to deduct stock.
- For staff-created orders >2 items, payment_method auto-upgrades from `cod` to `partial_prepay`.
- UI must display friendly notice: "Orders containing more than two items require a 50% advance payment to confirm the order. The remaining amount can be paid to the delivery person when receiving the parcel."

**3.36.5 Shipping Label Generation**
- Button: "Print Label" in staff dashboard.
- API route: `GET /api/staff/orders/:id/label` (RBAC: orders.view).
- Format: Self-contained HTML+SVG document that auto-triggers browser print dialog.
- Layout: 210mm × 99mm per label (3 fit vertically on A4, but rendered one per page).
- No external dependencies — pure HTML/CSS rendering.

---

## 5. Security & Deployment

- **CSRF:** Independent nonce-based HMAC verification.
- **Staff Auth:** HttpOnly/Secure/Strict cookies. Raw tokens never stored (only HMAC-SHA256).
- **Scheduled Jobs:** Cron triggers (e.g., reservation cleanup, daily backups, Tinify retry) routed via `src/lib/cron-dispatch.ts`.
- **AI Content:** DeepSeek integration via protected API endpoint, budget-gated by KV counters, requires staff review before persistence.

---

## 6. Appendix C — Handoff Notes
- Treat this document as the implementation contract.
- Do not move price authority back to the browser.
- Do not create orders before reservation success.
- Use Cloudflare secrets for all API keys.
- Keep generated D1 snapshot files out of Git.
- Application-layer validation enforces `payment_method` values (`cod`, `uddoktapay`, `partial_prepay`, `in_store`). The D1 CHECK constraint is documented but not strictly enforced at the database level.

---

*End of Zabir Boutiques AI Commerce Master Plan — Client Edition v6.8D*
*Accurate as of June 2026*
