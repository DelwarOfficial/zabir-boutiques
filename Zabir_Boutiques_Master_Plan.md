# Zabir Boutiques Master Plan V7

**Canonical, Conflict-Free, Cloudflare-Native Architecture**  
**Target market:** Bangladesh F-commerce and boutique retail  
**Primary hosting budget:** Cloudflare Workers Paid plan, minimum $5/month account plan  
**Document status:** Source of truth for developers and AI coding agents  
**Version:** V7 Cloudflare Canonical Plan  
**Date:** June 2026

---

## Table of Contents

**Part I — Architecture (Sections 1–10)**

- [0. Non-Negotiable Canonical Decisions](#0-non-negotiable-canonical-decisions)
- [1. Executive Summary](#1-executive-summary)
- [2. Platform and Cost Strategy](#2-platform-and-cost-strategy)
- [3. Astro 6 Framework Configuration](#3-astro-6-framework-configuration)
- [4. Cloudflare Service Matrix](#4-cloudflare-service-matrix)
- [5. Source-of-Truth Ownership](#5-source-of-truth-ownership)
- [6. Data Architecture](#6-data-architecture)
- [7. UI/UX Design System](#7-uiux-design-system)
- [8. Component Architecture](#8-component-architecture)
- [9. Cart Architecture](#9-cart-architecture)
- [10. Buy Now Direct Guest Order Landing Flow](#10-buy-now-direct-guest-order-landing-flow)

**Part II — Commerce Flows (Sections 11–17)**

- [11. Checkout and Payment Flow](#11-checkout-and-payment-flow)
- [12. Inventory and Stock Control](#12-inventory-and-stock-control)
- [13. Order Lifecycle](#13-order-lifecycle)
- [14. Staff Workflows and RBAC](#14-staff-workflows-and-rbac)
- [15. POS and In-Store Sales](#15-pos-and-in-store-sales)
- [16. Shipping Labels](#16-shipping-labels)
- [17. Email and Notifications](#17-email-and-notifications)

**Part III — Cross-Cutting Concerns (Sections 18–28)**

- [18. Security Architecture](#18-security-architecture)
- [19. Caching and CDN](#19-caching-and-cdn)
- [20. SEO Architecture](#20-seo-architecture)
- [21. Performance Budgets](#21-performance-budgets)
- [22. Search Architecture](#22-search-architecture)
- [23. Image Pipeline](#23-image-pipeline)
- [24. AI Integration](#24-ai-integration)
- [25. Observability and Monitoring](#25-observability-and-monitoring)
- [26. Environment Separation and CI/CD](#26-environment-separation-and-cicd)
- [27. Disaster Recovery](#27-disaster-recovery)
- [28. Compliance and Privacy](#28-compliance-and-privacy)

**Part IV — Delivery (Sections 29–33)**

- [29. Implementation Phases](#29-implementation-phases)
- [30. Absolute Guardrails](#30-absolute-guardrails)
- [31. AI Coding Agent Instructions](#31-ai-coding-agent-instructions)
- [32. Feature Coverage Matrix](#32-feature-coverage-matrix)
- [33. Final Implementation Contract](#33-final-implementation-contract)

**Part V — Operational Enforcement (Sections 34–38)**

> These sections are heavier than the rest of the document. If reading the plan end-to-end for the first time, you may stop at Section 33 and return to Part V when you are about to ship code. Part V is what makes Part IV binding rather than aspirational. If the document length becomes a readability burden, the team MAY split Part V into a companion `OPERATIONS.md` that Section 30 references — see Section 34.2 quarterly review.

- [34. Guardrail Review and Enforcement Protocol](#34-guardrail-review-and-enforcement-protocol)
- [35. D1 Migration Sequencing Plan](#35-d1-migration-sequencing-plan)
- [36. TypeScript Contract Stubs](#36-typescript-contract-stubs)
- [37. FraudBD Circuit Breaker Test Fixtures](#37-fraudbd-circuit-breaker-test-fixtures)
- [38. In-Flight PR Audit Playbook](#38-in-flight-pr-audit-playbook)

---

## 0. Non-Negotiable Canonical Decisions

Every implementation, prompt, ticket, PR, and agent instruction must follow these decisions.

| Area | Canonical Decision | Why |
|---|---|---|
| Astro output mode | Use `output: 'server'` with `@astrojs/cloudflare`; routes are dynamic by default unless opted into prerendering with `export const prerender = true`. | Astro v6 uses `server` for on-demand rendering; static pages opt in via `prerender = true`. |
| Rendering model | Server-first with selective prerendering: public pages use `prerender = true`; checkout, staff, auth, payment, API, POS, and webhooks are dynamic by default. | Fast SEO pages with safe server-side commerce logic. |
| Cart source of truth | `CartDO` is the only active cart source of truth during a session. KV must not store authoritative cart JSON. CartDO persists a snapshot to the D1 `cart_activity` index via an alarm (5-minute inactivity backoff) so cart state survives Worker restarts. | Cart requires strong consistency and concurrent tab safety; alarm-based D1 persistence prevents data loss on eviction without blocking checkout. |
| Abandoned cart detection | D1 `cart_activity` is the searchable index. CartDO writes to it via alarm (durable) and via the `cart-activity` queue (batched). A cart is **abandoned** when `last_cart_update_at` is older than 24 hours (SQL: `< datetime('now', '-24 hours')`), `abandoned_email_sent_at IS NULL`, and `converted_order_id IS NULL`. Cron queries D1, deduplicates on `customer_email`, and enqueues emails. | Durable Objects and KV cannot be globally queried for old carts. The 24h window plus email dedup prevents spam and false positives. |
| FraudBD | Checkout-time fraud decision is a direct HTTP call with 1.5s timeout and circuit breaker. Queue is used only for post-checkout audit/enrichment. | Queue-based async work cannot block checkout and return a score reliably. |
| COD threshold | “Items” means total unit quantity: `SUM(quantity)`, not distinct line count. COD is allowed only when `total_quantity <= 2` unless staff override is allowed by RBAC. | Prevents risk bypass using one variant with high quantity. |
| Stock reservation rollback | Every DO reservation returns `reservation_id`. If D1 order write fails, checkout immediately releases all reservations. Cleanup cron is only a safety net. | Prevents stock from being locked without an order. |
| POS sales | POS/in-store sales are immediate paid counter sales with a dedicated invoice ledger. POS does not use guest checkout, COD, UddoktaPay, or reservation, but all stock deduction must pass through `VariantInventoryDO.directSale()`. | Keeps counter sales fast while preserving one inventory authority across online and in-store channels. |
| Buy Now direct order | Product pages show `Add to Cart` and `Buy Now` side by side. `Buy Now` opens a direct guest order landing page and must not modify the normal cart. | Supports Bangladesh F-commerce style fast ordering while keeping checkout server-authoritative. |
| External APIs | All third-party APIs must go through provider adapters with secrets, sandbox/prod config, timeout, retry, idempotency, circuit breaker, and audit logging. | Prevents hidden vendor coupling and unsafe direct API calls. |
| Staff-assisted orders | Phone/Messenger/WhatsApp orders use the guest checkout pipeline and prepayment/fraud rules. | Same risk controls as customer checkout. |
| Money | All money is stored as integer paisa. No floating-point money values anywhere. | Prevents rounding bugs. |
| Cost posture | Build for the $5 Workers Paid plan first. Expensive add-ons are optional upgrade paths, not launch requirements. | Keeps launch cost low. |

---

## 1. Executive Summary

Zabir Boutiques is a Cloudflare-native ecommerce and POS platform for the Bangladesh boutique/F-commerce market. It supports public ecommerce, guest checkout, Buy Now direct guest orders, COD-first selling, partial prepayment, online payment, staff-assisted orders, in-store POS receipts, inventory control, fraud review, order lifecycle management, return/refund operations, SEO, image optimization, email notifications, and AI-assisted catalog work.

The platform is designed around four priorities:

1. **No overselling.** Stock mutations must pass through Durable Objects.
2. **No client-side price trust.** The browser never decides price, delivery fee, discount, advance, balance, or stock.
3. **Fast mobile-first pages.** Product, category, marketing, blog, and static legal pages are prerendered and cached.
4. **Low operational cost.** The default build targets Cloudflare Workers Paid at the $5/month minimum, with D1, R2, KV, Durable Objects, Queues, Workers AI, Cron Triggers, and Pages used carefully.

The project uses **Astro 6 + React 19 Islands + Tailwind CSS + Cloudflare adapter**. Server-first rendering with selective prerendering provides speed for public pages. Dynamic on-demand routes handle checkout, cart validation, staff dashboard, POS, payments, webhooks, inventory mutation, authentication, and admin APIs.

---

## 2. Platform and Cost Strategy

### 2.1 Primary Platform

| Layer | Canonical Choice |
|---|---|
| Hosting | Cloudflare Pages + Workers/Pages Functions |
| Framework | Astro 6 |
| Rendering | `output: 'server'` (universal). All routes are dynamic by default. Static pages must explicitly opt in with `export const prerender = true`. `output: 'static'` is FORBIDDEN anywhere in the project. |
| UI | React 19 Islands + Tailwind CSS |
| Database | Cloudflare D1 |
| Object storage | Cloudflare R2 |
| Strong consistency | Durable Objects |
| Async jobs | Cloudflare Queues |
| Scheduled jobs | Cloudflare Cron Triggers |
| Sessions/flags/redirects | Workers KV, only for stale-tolerant data |
| AI | Workers AI first; DeepSeek fallback only when needed |
| Email | Resend default transactional provider; Cloudflare Email Sending optional low-cost provider; Cloudflare Email Routing for inbound |
| Payments | UddoktaPay primary; SSLCommerz fallback |
| Fraud | FraudBD direct checkout call + async audit queue |
| Security | WAF, Turnstile, Zero Trust Access, CSP, CSRF HMAC, RBAC |
| Observability | Workers Analytics Engine, structured logs, audit logs, alerts |

### 2.2 Cost-Effective Launch Mode

The default plan is the **Cloudflare Workers Paid $5/month minimum** account plan. This plan should be treated as the primary hosting budget, not a guarantee that all usage will remain at exactly $5 forever. Usage beyond included monthly allowances can add costs.

Cost rules:

- Keep public pages prerendered and cached to avoid unnecessary Worker invocations.
- Use D1 carefully: server-side queries only, paginated admin views, indexed lookup paths.
- Use R2 for images and backups; avoid large binary storage in D1.
- Use KV only for session blacklist, feature flags, redirects, and read-mostly autocomplete/cache data.
- Avoid Cloudflare Images paid storage at launch unless the client explicitly approves it.
- Generate image variants during staff upload where possible; keep Cloudflare Images/Image Resizing as an optional upgrade.
- Use Workers AI within free/daily budget first; use DeepSeek only for complex content generation with BudgetCounterDO enforcement.
- Email provider is abstracted behind an adapter so the project can start with the lowest-cost reliable provider and switch later.


### 2.3 External API Governance

All third-party APIs must be accessed through a provider adapter layer. Route handlers, UI components, Durable Objects, and queue consumers must not call external APIs directly.

Required adapter path (generic form):

```txt
src/lib/integrations/{provider}/client.ts
src/lib/integrations/{provider}/types.ts
src/lib/integrations/{provider}/errors.ts
src/lib/integrations/{provider}/mock.ts
src/lib/integrations/{provider}/index.ts
```

Provider-specific paths (canonical, do not deviate):

```txt
# Payments
src/lib/integrations/uddoktapay/{client,types,errors,mock,index}.ts
src/lib/integrations/sslcommerz/{client,types,errors,mock,index}.ts

# Email — same adapter pattern as payments
src/lib/integrations/email/resend/{client,types,errors,mock,index}.ts
src/lib/integrations/email/cloudflare_email/{client,types,errors,mock,index}.ts
src/lib/integrations/email/index.ts         # factory that selects provider by EMAIL_PROVIDER env var
src/lib/integrations/email/types.ts         # shared SendEmailRequest / SendResponse types

# Fraud
src/lib/integrations/fraudbd/{client,types,errors,mock,index}.ts

# AI
src/lib/integrations/deepseek/{client,types,errors,mock,index}.ts
src/lib/integrations/workers_ai/{client,types,errors,mock,index}.ts

# Image
src/lib/integrations/imagify/{client,types,errors,mock,index}.ts

# Courier
src/lib/integrations/courier/{pathao,steadfast,redx}/{client,types,errors,mock,index}.ts
```

Every provider adapter must implement:

- Environment-aware base URL: development, staging, production.
- Cloudflare Secret-based credentials.
- Request timeout.
- Retry policy.
- Idempotency key strategy where supported.
- Circuit breaker via `ProviderHealthDO`.
- Structured error mapping.
- PII redaction before logging.
- Sandbox/mock mode for tests.
- Audit event for money, order, fraud, image, or AI-related calls.

Forbidden patterns:

- No raw API keys in code.
- No direct `fetch()` to third-party APIs from random route handlers.
- No third-party API response should be trusted without schema validation.
- No payment/fraud/image/AI provider should block product browsing.
- No PII should be sent to AI providers unless explicitly required and approved.

### 2.4 External API Provider Matrix

| Provider | Purpose | Required Secrets | Caller | Timeout | Retry | Fallback |
|---|---|---|---|---:|---|---|
| FraudBD | Courier/fraud risk check for Bangladesh ecommerce orders | `FRAUDBD_API_KEY`, `FRAUDBD_BASE_URL` | Checkout service + fraud audit queue | 1.5s checkout / 3s background | Checkout: **0 retries** (fallback on failure); `fraud-audit` queue: 1 retry with 2s backoff | Circuit breaker (5 failures / 60s → open 5 min → fallback score 50 → `pending_review`). Full spec in Section 11.2. |
| UddoktaPay | Primary online payment and partial prepayment | `UDDOKTAPAY_BASE_URL`, `UDDOKTAPAY_API_KEY`, `UDDOKTAPAY_WEBHOOK_SECRET` | Payment service + webhook + reconciliation cron | 10s | Verify calls retry; create charge must be idempotent | SSLCommerz fallback or pending payment retry |
| SSLCommerz | Payment fallback provider | `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_BASE_URL`, `SSLCOMMERZ_WEBHOOK_SECRET` | Payment service | 10s | Verify calls retry; create payment idempotent | Manual payment review |
| DeepSeek | Complex AI generation fallback | `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` | AI service queue/staff action | 30s foreground, longer only in queue | Retry only for transient errors | Workers AI or manual staff content |
| Workers AI | Primary low-cost AI tasks | Cloudflare binding | AI service | Platform default | No blind retry on budget failure | D1 FTS/category fallback/manual |
| Imagify | Image optimization, resize/compression, WebP/AVIF support where approved | `IMAGIFY_API_KEY`, `IMAGIFY_BASE_URL` | Image-processing queue | 30s | 2x queue retry | Keep original + queue-generated R2 variants (per Guardrail #26 — browser uploads original only) |
| Cloudflare Email Sending | Optional low-cost transactional email provider when account feature is enabled | Cloudflare email binding/config | Email adapter queue | 10s | 3x queue retry | Resend default provider |
| Resend | Default transactional email provider | `RESEND_API_KEY` | Email adapter queue | 10s | 3x queue retry | Cloudflare Email Sending or staff/manual resend |
| WhatsApp link | Customer support CTA | No secret for simple wa.me link | Frontend link | N/A | N/A | Phone call CTA |
| Courier APIs | Pathao/Steadfast/Redx shipping labels/tracking when approved | provider-specific secrets | Shipping adapter | 10s | Queue retry for labels | Manual label entry |

### 2.5 API Safety Contract

All external API responses must be validated with runtime schemas before use. Recommended pattern: Zod schemas or equivalent TypeScript-safe validators.

Minimum stored audit fields for external calls:

- `provider`
- `operation`
- `request_id`
- `order_id` or `invoice_id` when relevant
- `duration_ms`
- `status`
- `error_code`
- `retry_count`
- `circuit_state`
- `created_at`

Never store full raw response if it contains PII, secrets, payment references that should be redacted, or customer addresses.

### 2.6 Payment API Contract

Payment provider adapters must expose a common interface:

```ts
export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;
  parseWebhook(request: Request): Promise<VerifiedPaymentEvent>;
  refund?(input: RefundInput): Promise<RefundResult>;
}
```

Rules:

- `createPayment` must be idempotent using internal `order_id` and provider reference.
- Webhook payloads must be signature-verified before queue processing.
- Reconciliation cron is the final authority for fixing missed redirects/webhooks.
- Provider success redirect alone must not mark payment as paid.
- Payment status changes must be written to D1 with event idempotency.

### 2.7 AI API Contract

AI provider adapters must expose a common interface:

```ts
export interface AIProvider {
  generateProductDescription(input: ProductDescriptionInput): Promise<AITextResult>;
  generateAltText(input: AltTextInput): Promise<AITextResult>;
  embedText?(input: EmbedTextInput): Promise<EmbeddingResult>;
}
```

Rules:

- Workers AI is primary for low-cost tasks.
- DeepSeek is fallback for complex generation only.
- BudgetCounterDO must approve before paid AI calls.
- Staff must review all AI-generated public text.
- Product/customer PII must not be sent to AI providers.
- Prompt injection attempts must be logged and blocked.

### 2.8 Image Optimization API Contract

Image optimization must support two modes:

1. **Cost mode:** original upload + queue-managed lightweight fallback variants + R2 storage.
2. **API optimization mode:** Imagify adapter from the image-processing queue.

Imagify must not block product creation. If Imagify fails, the system keeps the original image and available generated variants, marks the image as `optimization_pending` or `original_only`, and retries through the queue.

Required output variants:

- `thumbnail` 150px.
- `card` 400px.
- `detail` 800px.
- `zoom` 1600px.
- `og-image` 1200x630.

### 2.9 API Test Requirements

Every external API adapter must have:

- Unit tests with mocked provider responses.
- Schema validation tests for malformed responses.
- Timeout tests.
- Retry tests.
- Circuit breaker tests.
- Sandbox integration tests where the provider supports sandbox.
- Production smoke checklist before launch.

---

## 3. Astro 6 Framework Configuration

### 3.1 Required Config

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Astro v6 uses 'server' for on-demand rendering.
  // Routes are dynamic by default unless opted into prerendering.
  output: 'server',

  adapter: cloudflare(),

  integrations: [react()],

  vite: {
    plugins: [tailwindcss()],
  },
});
```

### 3.2 Dynamic Route Rule

Routes are dynamic by default with `output: 'server'`. Any route that reads cookies, handles authentication, writes to D1/R2/KV/DO, checks live inventory, creates orders, verifies payments, or returns user-specific data does not need any special opt-in — it is dynamic by default.

### 3.3 Static Route Rule

Public-facing routes that benefit from prerendering should opt in with:

```ts
export const prerender = true;
```

- `/`
- `/products/[slug]` when built from product snapshots
- `/categories/[slug]`
- `/collections/[slug]`
- `/blog/[slug]`
- `/about`
- `/privacy`
- `/terms`
- `/return-policy`
- `/size-guide`

Static product pages may call a small live stock API from the client to show fresh availability. Checkout must still validate stock server-side.

### 3.4 Dynamic Route Table

With `output: 'server'` as the universal default, **dynamic routes require NO flag** — they are dynamic automatically. **Static routes must opt in** with `export const prerender = true` at the top of the route file.

| Route | Type | Rendering | Flag | Reason |
|---|---|---|---|---|
| `/` | Page | Static | `prerender = true` | Marketing homepage; rebuilt on catalog change |
| `/products/[slug]` | Page | Static | `prerender = true` | SEO product snapshot; live stock fetched client-side |
| `/categories/[slug]` | Page | Static | `prerender = true` | Category listing snapshot |
| `/collections/[slug]` | Page | Static | `prerender = true` | Collection snapshot |
| `/blog/[slug]` | Page | Static | `prerender = true` | Editorial blog content |
| `/about`, `/privacy`, `/terms`, `/return-policy`, `/size-guide` | Page | Static | `prerender = true` | Legal/info pages rarely change |
| `/api/cart/*` | API | Dynamic | (no flag) | CartDO reads/writes |
| `/cart` | Page | Dynamic | (no flag) | Static shell + client cart island; cart data loaded from API |
| `/checkout` | Page | Dynamic | (no flag) | Reads session/cart and produces server-safe checkout state |
| `/buy-now/[slug]` | Page | Dynamic | (no flag) | Direct guest order landing page with live product, selected variant, and order form |
| `/api/buy-now/session` | API | Dynamic | (no flag) | Creates short-lived direct checkout session without changing normal cart |
| `/api/buy-now/submit` | API | Dynamic | (no flag) | Submits direct guest order through the same secure checkout engine |
| `/api/checkout` | API | Dynamic | (no flag) | Order creation, stock reservation, payment initiation |
| `/api/payments/webhook` | API | Dynamic | (no flag) | HMAC verification and payment events |
| `/api/payments/reconcile` | API/Cron | Dynamic | (no flag) | Payment status checks |
| `/staff/*` | Pages | Dynamic | (no flag) | RBAC, live data, staff-only |
| `/api/staff/*` | API | Dynamic | (no flag) | Authenticated staff writes and reads |
| `/staff/sales/pos` | Page | Dynamic | (no flag) | Counter sales and live variants |
| `/staff/guardrails` | Page | Dynamic | (no flag) | Guardrail Owner dashboard (Section 34.10); read-only cluster map, waivers, GV incidents |
| `/api/staff/invoices/*` | API | Dynamic | (no flag) | POS invoice creation/printing/voiding |
| `/api/search` | API | Dynamic | (no flag) | D1 FTS/query suggestions |
| `/api/stock/[variant_id]` | API | Dynamic | (no flag) | Live DO/D1 stock status |
| `/api/me/*` | API | Dynamic | (no flag) | Personal data access/deletion |

**Forbidden anti-pattern:** setting `export const prerender = false` on any route. With `output: 'server'`, this is redundant noise and signals confusion in the codebase. Dynamic routes must omit the flag entirely.

---

## 4. Cloudflare Service Matrix

| Concern | Service | Canonical Use |
|---|---|---|
| Static hosting | Pages/CDN | Prerendered public pages and hashed assets |
| Dynamic routes | Pages Functions / Workers | Checkout, staff, cart, payment, APIs |
| Relational data | D1 | Products, variants, orders, staff, invoices, audit logs, cart_activity |
| Object storage | R2 | Product images, email templates, logs, backups, generated reports |
| Read-mostly state | KV | Session blacklist, feature flags, redirects, autocomplete prefix cache |
| Strong consistency | Durable Objects | VariantInventoryDO, CartDO, IdempotencyDO, BudgetCounterDO |
| Background work | Queues | Payment events, order emails, image processing, fraud audit, backups |
| Scheduled work | Cron Triggers | Reservation cleanup, payment reconciliation, abandoned cart scan, sitemap, backups |
| Bot protection | Turnstile | Checkout, coupon attempts, login, contact forms |
| Staff perimeter | Zero Trust Access | `/staff/*` and `/api/staff/*` |
| Edge security | WAF + Rate Limiting | Checkout, login, payment, staff, API routes |
| Metrics | Workers Analytics Engine | Business and technical metrics |
| Logs | R2 + structured logs | Redacted operational logs |

---

## 5. Source-of-Truth Ownership

| Data | Authoritative Store | Cache/Index | Notes |
|---|---|---|---|
| Product metadata | D1 | Static snapshots, Cache API | D1 is canonical. Static pages are rebuildable snapshots. |
| Product images | R2 | CDN cache | R2 object key stored in D1. |
| Variant price | D1 | Product snapshot for display only | Checkout always reloads price from D1. |
| Stock availability | VariantInventoryDO + D1 | Live stock API cache for display only | DO serializes reservations; D1 persists inventory. |
| Active cart | CartDO | React context, optional KV badge cache | KV cannot be authoritative. |
| Buy Now direct session | DirectCheckoutSessionDO | D1 order after submission | Does not mutate normal cart; short-lived session only. |
| Abandoned cart index | D1 `cart_activity` | None | Updated by CartDO. |
| Order | D1 | None | D1 is canonical. |
| POS invoice | D1 invoice ledger | None | Separate from online orders. |
| Staff session | HttpOnly cookie + KV session record/blacklist | None | Cookies contain signed session reference only. |
| Idempotency | IdempotencyDO + D1 idempotency_keys | None | DO handles atomic claim; D1 stores durable replay state. |
| Email delivery | D1 email_log | R2 rendered templates | Queue sends; log tracks status. |
| AI budget | BudgetCounterDO | D1 `ai_budget_limits` table | DO enforces counters; D1 is the durable source of truth for configured limits (per migration 0023 / Section 24.2). |
| API provider health | ProviderHealthDO | Analytics/audit logs | Circuit breaker state for FraudBD, UddoktaPay, DeepSeek, Imagify, email, and courier APIs. |
| Audit events | D1 audit_log | R2 log archive | Append-only. |

---

## 6. Data Architecture

### 6.1 Core D1 Tables

The schema must use SQLite-compatible syntax only. Every migration must pass D1 local tests and invalid insert tests.

Required table groups:

1. Catalog
   - `products`
   - `product_variants`
   - `categories`
   - `product_categories`
   - `product_images`
   - `product_tags`
   - `inventory_items`
   - compatibility view: `variants`

2. Cart and checkout
   - `cart_activity`
   - `direct_checkout_activity`
   - `coupons`
   - `coupon_redemptions`
   - `idempotency_keys`
   - `stock_reservations`

3. Orders
   - `orders`
   - `order_items`
   - `order_status_events`
   - `payment_events`
   - `returns`
   - `return_items`
   - `refunds`

4. POS ledger
   - `invoices`
   - `invoice_items`
   - `invoice_payments`
   - `invoice_audit`
   - `daily_invoice_counters`

5. Staff and security
   - `staff_users`
   - `staff_roles`
   - `staff_permissions`
   - `staff_sessions`
   - `audit_log`
   - `csrf_nonces`
   - `otp_secrets` — Owner TOTP 2FA secrets (encrypted at rest, one active row per Owner, supports backup codes). Required by Section 18.1 ("Owner role requires TOTP 2FA") and previously missing.
   - `password_reset_tokens` — Staff password reset tokens (HMAC-SHA256 hashed, 1-hour expiry, one-time use, supports admin-initiated resets via `created_by` column). Required by Section 18.1. Implemented by migration `0035_password_reset_tokens.sql`.
   - `password_reset_rate_limits` — D1-based rate limiting for forgot-password attempts per IP (3 attempts per 15-minute rolling window). Required by Section 18.4.
   - `api_audit_logs` — External API audit trail and `ProviderHealthDO` circuit breaker state transitions. One row per external call (FraudBD, UddoktaPay, SSLCommerz, DeepSeek, Imagify, email, courier). Indexed by `provider`, `operation`, `circuit_state`, `created_at`. Required by Sections 2.4 / 2.5 / 11.2 and previously missing.

6. Operations
   - `email_log`
   - `stock_adjustments`
   - `inventory_reconciliation_runs`
   - `ai_generation_log`
   - `backup_log`
   - `ai_budget_limits` — Persistent configuration for `BudgetCounterDO` (daily/monthly limits per provider, soft-alert threshold, hard-block threshold, Owner override flag). Required by Section 24.2 and previously missing. The DO holds the live counter; this table is the durable source of truth for the configured limits so limits survive DO eviction and can be edited by the Owner without redeploying.

#### Schema Sketches (SQLite syntax)

```sql
-- otp_secrets: Owner TOTP 2FA
CREATE TABLE otp_secrets (
  staff_id TEXT PRIMARY KEY REFERENCES staff_users(staff_id),
  secret_cipher BLOB NOT NULL,           -- AES-GCM encrypted TOTP secret
  backup_codes_hash TEXT NOT NULL,       -- bcrypt hash of comma-separated backup codes
  enabled_at TEXT NOT NULL,
  last_used_at TEXT,
  updated_at TEXT NOT NULL
);

-- api_audit_logs: external API call audit + circuit breaker transitions
CREATE TABLE api_audit_logs (
  audit_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,                -- 'fraudbd' | 'uddoktapay' | 'sslcommerz' | 'deepseek' | 'imagify' | 'resend' | 'courier'
  operation TEXT NOT NULL,               -- 'fraud_check' | 'create_payment' | 'verify_payment' | etc.
  request_id TEXT NOT NULL,
  order_id TEXT,
  invoice_id TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL,                  -- 'success' | 'error' | 'timeout' | 'circuit_open'
  error_code TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  circuit_state TEXT,                    -- 'closed' | 'open' | 'half_open'
  redacted_request_summary TEXT,         -- PII-scrubbed
  redacted_response_summary TEXT,        -- PII-scrubbed
  created_at TEXT NOT NULL
);
CREATE INDEX idx_api_audit_provider_created ON api_audit_logs(provider, created_at);
CREATE INDEX idx_api_audit_circuit_state ON api_audit_logs(provider, circuit_state, created_at);
CREATE INDEX idx_api_audit_order ON api_audit_logs(order_id) WHERE order_id IS NOT NULL;

-- ai_budget_limits: BudgetCounterDO durable config
CREATE TABLE ai_budget_limits (
  provider TEXT PRIMARY KEY,             -- 'workers_ai' | 'deepseek'
  daily_limit_usd_cents INTEGER NOT NULL,    -- integer cents to avoid float money
  monthly_limit_usd_cents INTEGER NOT NULL,
  soft_alert_percent INTEGER NOT NULL DEFAULT 80,  -- 0-100
  hard_block_percent INTEGER NOT NULL DEFAULT 100, -- 0-100
  owner_override BOOLEAN NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by_staff_id TEXT REFERENCES staff_users(staff_id)
);
```

### 6.2 Money Columns

Every money field must be integer paisa.

Examples:

- `price_paisa`
- `subtotal_paisa`
- `delivery_paisa`
- `discount_paisa`
- `total_paisa`
- `advance_paisa`
- `balance_paisa`
- `refund_paisa`
- `vat_paisa`

No `REAL`, `FLOAT`, `DOUBLE`, or decimal string money values are allowed.

### 6.3 Cart Activity Index

`cart_activity` solves abandoned cart detection without making D1 the active cart owner.

Required columns:

- `session_id TEXT PRIMARY KEY`
- `customer_phone TEXT`
- `customer_email TEXT`
- `customer_name TEXT`
- `item_count INTEGER NOT NULL DEFAULT 0`
- `total_quantity INTEGER NOT NULL DEFAULT 0`
- `subtotal_paisa INTEGER NOT NULL DEFAULT 0`
- `last_cart_update_at TEXT NOT NULL`
- `checkout_started_at TEXT`
- `converted_order_id TEXT`
- `abandoned_email_sent_at TEXT` (replaces the legacy `abandoned_1h_sent_at` / `abandoned_24h_sent_at` pair; a single 24h-touch column is the canonical reminder to prevent spam)
- `consent_status TEXT CHECK(consent_status IN ('unknown','allowed','denied'))`
- `last_d1_write_at TEXT` — ISO 8601 UTC; stamped by both alarm-based and queue-based upserts (Section 6.3 race contract)
- `last_d1_write_source TEXT CHECK(last_d1_write_source IN ('alarm','cart_activity_queue','lifecycle_cleanup'))` — who wrote the row most recently; required for ops triage and stale-write rejection
- `last_d1_write_seq INTEGER NOT NULL DEFAULT 0` — monotonic counter; increments per accepted write; used as an audit signature when two rows have identical `last_d1_write_at`
- `updated_at TEXT NOT NULL`

Recommended indexes (SQLite syntax):

```sql
CREATE INDEX idx_cart_activity_abandoned
  ON cart_activity(last_cart_update_at)
  WHERE converted_order_id IS NULL
    AND abandoned_email_sent_at IS NULL;

CREATE INDEX idx_cart_activity_email
  ON cart_activity(customer_email)
  WHERE customer_email IS NOT NULL;
```

#### CartDO → D1 Persistence Contract (resolves sync contradiction)

The data flow has two layers, and they must not be confused:

1. **CartDO is the real-time source of truth during a session.** Every cart mutation updates in-DO state synchronously. Checkout reads from CartDO, not from D1.
2. **D1 `cart_activity` is a searchable projection.** It is populated by two cooperating mechanisms:
   - **Alarm-based durable persistence (primary):** On every mutation, CartDO arms an alarm with a 5-minute backoff. If no further mutation arrives within 5 minutes, the alarm fires and CartDO upserts its current state to D1 `cart_activity`. If a new mutation arrives, the alarm is rescheduled (debounced). This guarantees that an inactive cart is durably persisted within ~5 minutes of its last change, even if the Worker is restarted, the DO is evicted, or the queue consumer is delayed.
   - **`cart-activity` queue (batching optimization):** After each mutation, CartDO also publishes a lightweight message to the `cart-activity` queue. The queue consumer batches these and upserts D1. This keeps checkout fast by avoiding a synchronous D1 write on every mutation, and it produces fresher rows than the alarm alone.

The alarm is the safety net for durability (no cart can be lost on Worker restart); the queue is the latency optimization (D1 rows stay fresh without blocking the request). Checkout must never trust `cart_activity` for active cart content — it must always read from CartDO.

##### CartDO Alarm Lifecycle (mandatory)

The alarm contract below is the implementation surface for the 5-min / 30-day rules and MUST be enforced exactly. Any drift between this prose and the implementation is a P1 finding.

| Lifecycle event | Required DO behavior | Rationale |
|---|---|---|
| **`addItem` / `removeItem` / `changeQuantity` / `clearCart` succeeds** | Arm `setAlarm(now + 5 * 60 * 1000)`. If an alarm is already armed, `setAlarm` is idempotent and replaces it (debounce). Also stamp `state.soft_alarm_active = true`. | Guarantees persistence within 5 minutes of last mutation, even on Worker restart or DO eviction. |
| **Cart created (first `addItem` ever for this session)** | Additionally `setAlarm(now + 30 * 24 * 60 * 60 * 1000)` (30-day hard cleanup). This second alarm is the door for `deleteAll()`. Store both `5min_alarm_at` and `30day_alarm_at` in DO storage so the alarm() handler can branch. | Avoids stale DOs living forever if the cart is never mutated after eviction. |
| **`getCart()` (read-only access) on a rehydrated DO** | If `state.last_cart_write_at` exists and `state.items.length > 0` and `ctx.storage.getAlarm() === null`, the read path MUST arm `setAlarm(now + 5 * 60 * 1000)`. Read-only access cannot lazily arm alarms via the mutation path; without this fix, an evicted DO that is only ever read never durably persists the cart. | Closes the eviction-vs-read gap. Without this, eviction between mutations can leak state to DO storage until the 30-day alarm. |
| **Alarm fires after 5 minutes of inactivity** | Upsert D1 `cart_activity` with `last_d1_write_source = 'alarm'`, `last_d1_write_at = now()`. Then re-arm `setAlarm(now + 5 * 60 * 1000)` **only if** `state.last_mutation_at > now() — 5min` (i.e. a mutation arrived in between, debounce period). Otherwise DO remains alarm-idle until next mutation. | Maintains the "alarm fires after inactivity" semantics while allowing legitimate back-to-back mutations to keep extending the window. |
| **Alarm fires after 30 days of total inactivity** | Final D1 `cart_activity` write with `last_d1_write_source = 'lifecycle_cleanup'`. Then `deleteAll()` and `ctx.storage.deleteAlarm()`. After `deleteAll()`, the DO instance may be rehydrated later as an empty container; this is acceptable because the persistent state of value is already in D1. | Prevents indefinite DO storage retention for one-time sessions. |
| **Alarm fires but `state.items.length === 0`** | Skip the D1 upsert (an empty cart has no projection value) and arm `setAlarm(now + 30 * 24 * 60 * 60 * 1000)` for the 30-day cleanup path. | Prevents orphan alarm firings for completed/cleared carts. |
| **DO is evicted between mutations, then rehydrated** | `ctx.storage.getAlarm()` returns `null` (alarm state is per-DO lifecycle, not persisted with storage). The next mutation OR read MUST re-arm the 5-min alarm as above. This is why every mutation path calls `setAlarm()` unconditionally and `getCart()` re-arms when needed. | Worker restart and DO eviction must not silently disable persistence. |

##### Queue vs Alarm Write Race (consistency contract)

Both writers target the same `cart_activity.session_id` PRIMARY KEY. To prevent stale-vs-fresh drifting of D1 reads, the writers MUST stamp and check the following columns on every upsert:

| Column | Writer | Value |
|---|---|---|
| `last_d1_write_at` | alarm upsert / queue upsert | ISO 8601 UTC of the write attempt |
| `last_d1_write_source` | alarm upsert / queue upsert | `'alarm'` or `'cart_activity_queue'` |
| `last_d1_write_seq` | alarm upsert / queue upsert | Monotonic counter incremented atomically per write |

The upsert SQL is the SAME for both writers and uses last-write-wins by `last_d1_write_at` with monotonic guard:

```sql
-- shared upsert used by alarm and queue consumers
UPDATE cart_activity
SET last_cart_update_at        = :ts,
    item_count                 = :item_count,
    total_quantity             = :total_quantity,
    subtotal_paisa             = :subtotal_paisa,
    last_d1_write_at           = :ts,
    last_d1_write_source       = :source,
    last_d1_write_seq          = COALESCE((SELECT MAX(last_d1_write_seq)
                                            FROM cart_activity
                                            WHERE session_id = :session_id), 0) + 1,
    updated_at                 = :ts
WHERE session_id = :session_id
  AND (:ts >= COALESCE(last_d1_write_at, ''));
```

Rules:

1. **Alarm and queue writers MAY run concurrently.** The monotonic `last_d1_write_seq` ensures each write is observable in the audit log even if the row contents tie.
2. **A stale write (lower `last_d1_write_at`) MUST NOT overwrite a fresher one.** The conditional `WHERE … AND :ts >= COALESCE(last_d1_write_at, '')` ensures this. A stale write that is rejected by the guard is logged to `audit_log` with `event_type = 'cart_activity_stale_write_dropped'`.
3. **Checkout MUST NOT read `cart_activity` for active cart content.** It always reads from CartDO per the persistence contract above. The guard is a defense-in-depth measure; the canonical source remains the DO.
4. **Queue is preferred for latency. Alarm is preferred for durability.** If the queue is delayed (> 60 seconds since dispatch), the alarm writer at the 5-minute mark is the source of truth. The `last_d1_write_source` column lets ops answer "who wrote this row" without ambiguity.
5. **Concurrency safety.** The SQL above is a single-statement upsert; D1 enforces row-level locking on update, so concurrent writers serialize on the row. There is no deadlock path because both writers use the same SQL and the same condition.

Acceptance criteria for this contract:

- A test fixture (`tests/cart_persistence.test.ts`) covers: alarm fire persists state, queue consumer persists state, concurrent alarm + queue upserts produce monotonic `last_d1_write_seq`, stale write is rejected, evicted DO + read-only path re-arms alarm.
- A D-05 detection rule asserts every CartDO mutation path calls `setAlarm(now + 5 * 60 * 1000)` (extended in Section 38.2).
- A new D-26a detection rule asserts `getCart()` re-arms the alarm on a rehydrated DO if `state.items.length > 0` and no alarm is currently armed.
- A new D-26b detection rule asserts `cart_activity` schema contains `last_d1_write_at`, `last_d1_write_source`, `last_d1_write_seq` columns.

### 6.4 KV Usage Map

KV is eventually consistent and must only store stale-tolerant data.

| Namespace | Key Pattern | Value | TTL | Authoritative? |
|---|---|---|---|---|
| `SESSION` | `session:{hash}` | Staff session metadata / revocation | 8h | No, cookie + D1/staff validation wins |
| `FEATURE_FLAGS` | `flag:{name}` | JSON config | None | Operational config only |
| `REDIRECTS` | `redirect:{old_path}` | Target URL | None | Yes for redirects, stale acceptable |
| `AUTOCOMPLETE` | `search:prefix:{prefix}` | Top suggestions | 24h | No, D1 FTS wins |
| `RATE_HINTS` | `rl_hint:{ip}:{route}` | Soft rate counter | 60s | No, strict rate uses DO or Cloudflare rules |
| `CONSENT` | `consent:{session_id}` | Cookie/analytics consent | 1 year | No, user can refresh |

Forbidden KV use:

- No authoritative cart JSON.
- No authoritative stock.
- No payment state.
- No order state.
- No staff permission source of truth.

### 6.5 R2 Buckets

| Bucket | Purpose |
|---|---|
| `zabir-product-images` | Product images and generated variants |
| `zabir-email-templates` | Rendered email HTML templates |
| `zabir-logs` | Redacted structured logs |
| `zabir-backups` | D1 SQL exports and metadata |
| `zabir-reports` | Generated reports and CSV exports |

R2 object naming:

```txt
products/{product_id}/original/{image_id}.{ext}
products/{product_id}/variants/{image_id}-{size}.{ext}
emails/{template_name}/{version}.html
backups/d1/{env}/{yyyy}/{mm}/{dd}/{timestamp}.sql
logs/workers/{env}/{yyyy}/{mm}/{dd}/{hour}.jsonl
```

### 6.6 Durable Objects

| DO | Object ID | Responsibility |
|---|---|---|
| `VariantInventoryDO` | `variant:{variant_id}` | Serialize stock reservation/release/confirm operations |
| `CartDO` | `cart:{session_id}` | Active cart state, optimistic UI reconciliation, cart_activity updates |
| `DirectCheckoutSessionDO` | `buy:{session_id}` | Short-lived Buy Now session, selected variant/quantity, landing order form state, self-cleanup alarm |
| `IdempotencyDO` | `idem:{idempotency_key}` | Atomic checkout/payment operation claiming |
| `BudgetCounterDO` | `budget:{service}:{period}` | AI/email/expensive operation budget enforcement |
| `ProviderHealthDO` | `provider:{name}` | Circuit breaker and health state for external APIs |

Each DO must expose clear command methods and return deterministic error codes.

### 6.7 Queues

| Queue | Producer | Consumer | Retry | DLQ/Failure Action |
|---|---|---|---|---|
| `payment-webhooks` | Payment webhook endpoint | Verify event and update order | 5x exponential | Alert + manual reconciliation |
| `order-emails` | Order/status/cart events | Send transactional email | 3x backoff | Staff notification + email_log failure |
| `image-processing` | Staff upload | Generate/compress variants or verify upload | 3x backoff | Mark image as original-only |
| `fraud-audit` | Checkout completion | Post-checkout FraudBD enrichment | 2x | Keep order review flag |
| `cart-activity` | CartDO mutation | Batch update D1 `cart_activity` / `direct_checkout_activity` | 3x | Keep DO cart state; retry later |
| `d1-backup` | Cron | Export D1 to R2 | 2x | Critical alert |
| `sitemap-generation` | Cron/catalog change | Generate sitemap to R2 | 2x | Alert; keep sitemap |


### 6.8 Durable Object Expiry and Alarm Cleanup

Short-lived Durable Objects must clean themselves up explicitly. Durable Objects do not expire automatically like KV keys.

Required alarm rules:

| Durable Object | Expiry | Alarm Behavior |
|---|---:|---|
| `DirectCheckoutSessionDO` | 30 minutes | `setAlarm(expires_at)` on create; if no order exists, call `deleteAll()` and clear alarm metadata |
| `IdempotencyDO` | 24 hours after completed response | `setAlarm(expires_at)`; retain replay response until expiry, then delete storage |
| `ProviderHealthDO` | Provider-specific | Keep circuit state while active; clear stale healthy state on scheduled alarm |
| `CartDO` | 5-minute inactivity alarm for D1 persistence (see Section 6.3 / 9.1); 30-day total inactivity policy for full cleanup | Two-stage alarm: (a) 5-min inactivity → upsert D1 `cart_activity` and re-arm; (b) 30-day inactivity → final `cart_activity` write then `deleteAll()` |
| `stock_reservations` cleanup | N/A — D1 row, not a DO | Hourly cron per Section 12.3, NOT a DO alarm. The `VariantInventoryDO` itself does not expire; only its reservation records do. |

Implementation rule:

```ts
// Pseudocode only
await this.ctx.storage.setAlarm(Date.now() + ttlMs);

async alarm() {
  const state = await this.ctx.storage.get('state');
  if (state?.order_id) return;
  await this.ctx.storage.deleteAll();
}
```

Cron sweeps may exist as a safety net, but the primary cleanup mechanism for short-lived DO state is the Durable Object Alarm API. The hourly reservation cleanup cron (Section 12.3) is a D1 sweep, not a DO alarm — it operates on `stock_reservations` rows, calling `VariantInventoryDO.release()` for each expired row.

---

## 7. UI/UX Design System

### 7.1 Design Principles

- Mobile-first for Bangladesh users.
- Fast loading on low-end Android and unstable mobile networks.
- Clear product cards with price, availability, color/size, and CTA.
- Checkout must be short, readable, and trust-building.
- Staff dashboard must be simple enough for non-technical shop staff.
- POS must be fast: product search, quantity, discount, payment method, receipt print.

### 7.2 Tailwind and Tokens

Tailwind CSS is the only styling system. Use design tokens for:

- Color: primary, accent, danger, success, warning, surface, border, muted text.
- Typography: heading, body, mono.
- Spacing: 4px base scale.
- Radius: small/medium/large.
- Shadow: card, dropdown, modal.
- Breakpoints: 360px mobile baseline, 768px tablet, 1024px desktop.

Custom CSS is allowed only for:

- CSS variables.
- Astro-scoped component styles that Tailwind cannot express cleanly.
- Print CSS for POS receipts and shipping labels.

### 7.3 Accessibility

WCAG 2.1 AA is mandatory.

Required controls:

- Visible form labels.
- Keyboard navigation for all interactive elements.
- Focus trap in modals/drawers.
- Skip links.
- Product image alt text required before publish.
- Error messages connected using `aria-describedby`.
- Color contrast minimum 4.5:1 for normal text.
- Respect `prefers-reduced-motion`.
- Staff dashboard also follows accessibility rules.

---

## 8. Component Architecture

### 8.1 Astro Islands

Public pages must ship minimal JavaScript.

| Component | Hydration | Target |
|---|---|---|
| Add to Cart button | `client:idle` | Under 5KB gzip |
| Cart Drawer | `client:idle` | Under 10KB gzip |
| Product Gallery | `client:idle` | Under 8KB gzip |
| Live Stock Badge | `client:visible` or `client:idle` | Under 4KB gzip |
| Checkout Form | `client:load` only on checkout | Under 15KB gzip |
| Search Autocomplete | `client:idle` | Under 8KB gzip |
| Recommendations | `client:visible` | Under 6KB gzip |
| Staff Dashboard | `client:load`, route-split | Under 50KB gzip per route |

Public pages should not exceed five hydrated islands without approval.

### 8.2 Component Groups

- Primitives: `Button`, `Input`, `Select`, `Badge`, `Modal`, `Toast`, `Spinner`.
- Product: `ProductCard`, `ProductGallery`, `VariantSelector`, `PriceDisplay`, `StockBadge`.
- Cart: `CartItem`, `CartDrawer`, `CartSummary`, `CouponInput`.
- Checkout: `CheckoutForm`, `DeliveryAddress`, `PaymentSelector`, `OrderSummary`, `BuyNowLandingForm`, `DirectOrderSummary`.
- Staff: `OrderTable`, `OrderDetail`, `ProductEditor`, `CouponManager`, `ReturnHandler`.
- POS: `POSCartBuilder`, `InvoicePreview`, `PaymentSplitForm`, `ThermalPrintButton`.
- Layout: `Header`, `Footer`, `MobileMenu`, `Breadcrumb`, `StaffShell`.

### 8.3 State Management

- Active cart: CartDO + local React context for optimistic UI.
- Staff session: HttpOnly cookie + session fetch on mount.
- Server state: fetched by dynamic routes or APIs; not duplicated in global client stores.
- No Redux/Zustand unless approved later for staff dashboard complexity.

---

## 9. Cart Architecture

### 9.1 CartDO Responsibilities

CartDO is responsible for:

- Add item.
- Remove item.
- Change quantity.
- Clear cart.
- Get cart.
- Merge anonymous cart after staff/user identification if needed.
- Validate variant existence using D1 snapshot refresh path.
- Publish lightweight `cart-activity` queue message after mutation instead of blocking on D1 writes (batching optimization).
- **Alarm-based D1 persistence (mandatory):** On every mutation, CartDO arms `setAlarm(now + 5 minutes)`. Each subsequent mutation reschedules the alarm (debounced). When the alarm fires with no further mutations, CartDO upserts its current state to D1 `cart_activity`. This is the durability guarantee: even if the Worker is restarted, the DO is evicted, or the `cart-activity` queue consumer is delayed, an inactive cart is persisted within ~5 minutes of its last change. This resolves the previous contradiction where cart state could be lost on Worker restart.
- Return cart version number to prevent stale client overwrite.

CartDO is the **only** real-time source of truth during a session. D1 `cart_activity` is a searchable projection used by the abandoned-cart cron, analytics, and staff reporting — never by checkout for active cart contents.

### 9.2 Cart Conflict Handling

Every cart mutation includes:

- `session_id`
- `cart_version`
- mutation command
- idempotency key for repeated client retries

If client version is stale, CartDO returns current cart with `409 CART_VERSION_CONFLICT`. Client must refresh local context.

#### `cart_version` Increment Contract (mandatory)

`cart_version` is a monotonic integer that lets the client detect concurrent stale writes. The increment rule below is the canonical implementation contract — drift between prose and code is a P1 finding.

| Method | Pre-condition check | On success: `cart_version` | On failure: `cart_version` |
|---|---|---|---|
| `addItem` | Reject if `items[].variant_id === variant_id` already exists (caller must use `changeQuantity` to update) | `current_version + 1` | unchanged |
| `removeItem` | Reject if `items[].variant_id` not present | `current_version + 1` | unchanged |
| `changeQuantity` | Reject if `variant_id` not present; reject if `quantity <= 0`; resolve `quantity === 0` as a soft delete (calls `removeItem` semantics internally, version still increments by 1) | `current_version + 1` | unchanged |
| `clearCart` | Always succeeds when items exist; no-op if cart already empty | `current_version + 1` if items cleared, otherwise unchanged | unchanged |
| `mergeCart` (anonymous → customer) | Reject if `source_session_id === target_session_id`; reject if `source.items.length === 0` | `target_current_version + 1 + (number of new items added)` | unchanged on conflict |
| `applyCoupon` / `removeCoupon` | Reject if coupon invalid; reject if already applied with same code | `current_version + 1` | unchanged |
| `getCart` | Always succeeds | unchanged | unchanged |
| `updateCustomerContact` (post-checkout-start) | Validate phone format E.164 `+880...`; reject duplicate customer collision (rare; logged as audit event) | `current_version + 1` | unchanged |
| `alarm()` (5-min or 30-day fire) | N/A — alarm handler MUST NOT increment `cart_version`. Only `state.last_d1_write_at` and projector columns change. | unchanged | unchanged |
| Replay of an idempotent retry | Match `idempotency_key` against recently-seen key window (≤ 60 seconds) | unchanged | unchanged; replay returns last successful response |

Rules and acceptance criteria for this contract:

1. The version is incremented **after** the state mutation succeeds, never before. If a mutation fails partway through (e.g. validation error, storage write failure), the version MUST NOT advance.
2. The version is incremented **inside the DO's input lock**, so concurrent requests against the same session sequentially observe monotonically increasing versions.
3. Idempotent replays (same `idempotency_key`) **never** increment the version; the cached prior response is returned. This is enforced by an in-memory LRU keyed on `idempotency_key` per DO instance.
4. When a `CART_VERSION_CONFLICT` is returned, the response MUST include the current `state.cart_version` so the client can resubmit with the latest version. The error shape is `{ error: 'CART_VERSION_CONFLICT', state: CartState }`.
5. The version counter is initialized to `1` on a new cart (the first `addItem` after a `CART_NOT_FOUND`). A pre-increment `0` does not exist.
6. `cart_version` MUST be a TypeScript `number` (max safe integer — far beyond any realistic cart session lifetime) and serialized as a JSON integer.
7. Test fixtures in `tests/cart_version.test.ts` MUST cover each row of the table above.

### 9.3 Cart Data Kept in DO

- `items[]`: variant_id, quantity, added_at, updated_at.
- `last_updated_at`.
- `cart_version`.
- `coupon_code` if applied.
- `customer_contact` only after checkout starts.

CartDO must not store payment secrets or staff-only data.


---

## 10. Buy Now Direct Guest Order Landing Flow

Buy Now is a conversion-focused direct order path for customers who want to order quickly without using the normal cart page. This is especially important for Bangladesh F-commerce behavior, where many customers prefer a one-page offer, product explanation, and order form.

### 10.1 UX Placement

On every eligible product detail page, show two primary actions side by side:

```txt
[Add to Cart] [Buy Now]
```

Rules:

- `Add to Cart` adds the selected variant and quantity to the normal CartDO cart.
- `Buy Now` creates a separate direct checkout session and opens the Buy Now landing page.
- `Buy Now` must not clear, overwrite, or mutate the customer's existing normal cart.
- If no required variant/size/color is selected, the button must show a clear validation message.
- On mobile, buttons should be sticky near the bottom for easier thumb access.

### 10.2 Route Strategy

| Route | Type | Rendering | Purpose |
|---|---|---|---|
| `/buy-now/[slug]` | Page | Dynamic | Conversion-focused product landing + direct order form |
| `/api/buy-now/session` | API | Dynamic | Creates short-lived DirectCheckoutSessionDO state |
| `/api/buy-now/submit` | API | Dynamic | Validates form and submits through secure checkout engine |

Buy Now landing pages are dynamic because they need live selected variant, stock, delivery charge, COD/prepayment rule, direct session state, and server-generated order summary.

### 10.3 Buy Now Click Flow

1. Customer selects variant, size/color if applicable, and quantity on product page.
2. Customer clicks `Buy Now`.
3. Browser sends selected `product_id`, `variant_id`, and `quantity` to `/api/buy-now/session`.
4. Server validates product status, variant status, quantity limit, and availability hint.
5. Server creates a short-lived `DirectCheckoutSessionDO` object with a 30-minute alarm-based cleanup timer.
6. Server returns redirect URL: `/buy-now/{slug}?sid={secure_session_id}`.
7. Landing page loads session state server-side.
8. Customer fills guest order form.
9. Submit calls `/api/buy-now/submit`.
10. Submit uses the same secure checkout engine: server pricing, coupon validation, COD rule, FraudBD, stock reservation, D1 order write, rollback, payment initiation, email queue.

### 10.4 Landing Page Structure

The Buy Now landing page should use a product-offer style layout:

```txt
1. Strong offer headline
2. Product hero image or gallery
3. Price / offer price / combo price
4. Stock or urgency message, if accurate
5. Product benefits
6. Product gallery
7. Size chart / variant selector
8. Trust points
9. Delivery charge explanation
10. Guest order form
11. Shipping zone selection
12. Order summary
13. Payment method: COD / partial prepay / online payment
14. Confirm order button
15. WhatsApp / phone support CTA
```

Important rule: urgency text must be truthful. Do not show fake scarcity or fake countdown timers.

### 10.5 Guest Order Form Fields

Required fields:

- Customer name.
- Phone number.
- Delivery address.
- Shipping zone: inside Dhaka / outside Dhaka or configured zones.
- Required variant attributes: size, color, combo choice, etc.

Optional fields:

- Customer note.
- Email for order updates.
- Alternative phone.

The form must be optimized for mobile and Bangla users.

### 10.6 DirectCheckoutSessionDO State

DirectCheckoutSessionDO stores temporary order intent only.

Allowed state:

- `session_id`
- `product_id`
- `variant_id`
- `quantity`
- `selected_options`
- `created_at`
- `expires_at`
- `landing_version`
- `source_page`
- `utm_params`
- `form_draft` if user starts filling fields
- `origin` (request Origin header captured at session creation)
- `user_agent_hash` (SHA-256 of User-Agent, used for session fixation mitigation)
- `customer_session_link` (optional, set only if user is logged in; never the cart session)

Forbidden state:

- Payment secrets.
- Final price as authority.
- Final delivery fee as authority.
- Final discount as authority.
- Permanent order data.
- **Any reference to a `CartDO` object ID.** DirectCheckoutSessionDO has ZERO interaction with CartDO.

Prices shown on the landing page are display-only. Final submit must reload authoritative price and stock from D1/VariantInventoryDO.

#### Cart Isolation Contract (mandatory)

DirectCheckoutSessionDO and CartDO are **completely isolated**. There is no shared state, no shared ID, no shared mutation path. The rules below are mandatory:

| Concern | Rule |
|---|---|
| Object ID space | DirectCheckoutSessionDO uses `buy:{session_id}`. CartDO uses `cart:{session_id}`. The `session_id` values are NEVER reused across the two namespaces. |
| `session_id` generation | `session_id = HMAC(secret, timestamp_ms + crypto.getRandomValues(32 bytes))`. The HMAC prevents brute-force enumeration; the timestamp + random ensures uniqueness without a centralized counter. |
| Session fixation mitigation | On every request to `/buy-now/[slug]` and `/api/buy-now/submit`, the server MUST verify `request.headers.get('Origin') === session.origin` AND `sha256(request.headers.get('User-Agent')) === session.user_agent_hash`. Mismatch → 403 + delete the DirectCheckoutSessionDO. |
| Logged-in user using Buy Now | If the customer has a logged-in customer session, the DirectCheckoutSessionDO stores `customer_session_link` for analytics ONLY. The customer's normal `CartDO` (keyed by their customer session) **remains completely unchanged** — no items added, removed, or cleared. Buy Now does not touch CartDO under any circumstances. |
| Lifetime | 30-minute alarm from creation. On alarm fire: if no `order_id` is set, `deleteAll()`. |
| Post-order cleanup | The DirectCheckoutSessionDO is **deleted immediately** after the order is successfully created (after D1 order write + reservation confirmation). This prevents session replay and frees DO storage. The alarm is cancelled on successful order creation. |
| Concurrent Buy Now tabs | A customer may open multiple Buy Now tabs for different products. Each tab gets its own `session_id` and its own DirectCheckoutSessionDO. They do not interfere with each other or with the customer's CartDO. |

The intent of this strict isolation is to ensure that a customer who uses Buy Now for a single-item impulse purchase does not accidentally lose or alter their carefully-built cart from earlier browsing. The two flows are independent entry points into the same secure checkout engine (Section 10.8).

### 10.7 Direct Order Submit Rules

`/api/buy-now/submit` must call the same checkout service used by normal checkout. It must not implement a separate weak order creation path.

Required checks:

- Idempotency key.
- Turnstile if risk threshold requires it.
- Phone normalization to `+880`.
- Server-side price load.
- Server-side delivery fee calculation.
- Coupon validation if coupon is enabled on the landing page.
- COD total quantity rule using `SUM(quantity)`.
- FraudBD direct checkout check.
- VariantInventoryDO reservation.
- Immediate reservation release on failure.
- D1 atomic order creation.
- Payment initiation if needed.
- Email queue.

### 10.8 Relationship with Cart and Checkout

Buy Now is not a cart replacement. It is an alternate entry into the secure checkout engine.

| Flow | Cart Mutation | Page | Order Engine |
|---|---|---|---|
| Add to Cart | Yes, CartDO | `/cart` → `/checkout` | Standard checkout engine |
| Buy Now | No normal cart mutation | `/buy-now/[slug]` | Same checkout engine |
| Staff-assisted | No customer cart required | Staff dashboard | Same checkout engine |
| POS | No checkout/cart | POS screen | POS invoice engine |

### 10.9 SEO and Indexing

Buy Now landing pages can be used as campaign pages, but default behavior should be controlled:

- Product detail pages remain canonical SEO pages.
- Buy Now pages should use canonical URL pointing to the main product page unless they are intentional campaign landing pages.
- If page includes campaign-only offer text, set `noindex` unless marketing team wants it indexed.
- Do not duplicate product SEO content without canonical tags.

### 10.10 Analytics

Track:

- `buy_now_clicked`
- `buy_now_session_created`
- `buy_now_landing_viewed`
- `buy_now_form_started`
- `buy_now_order_submitted`
- `buy_now_payment_started`
- `buy_now_order_created`
- `buy_now_abandoned`

Store summary in D1 `direct_checkout_activity` for conversion analysis.

---

## 11. Checkout and Payment Flow

Checkout is server-authoritative, idempotent, and race-condition-aware.

### 11.1 Guest Checkout Canonical Flow

1. Validate `Idempotency-Key`. Claim operation through IdempotencyDO. If existing successful response exists, return it.
2. Verify Turnstile token for guest checkout when risk score requires it.
3. Normalize phone to E.164 Bangladesh format `+8801XXXXXXXXX`.
4. Load active cart from CartDO using `session_id`.
5. Parse only `variant_id` and `quantity`. Ignore all browser-supplied prices/totals.
6. Load authoritative variant, product, price, and status from D1.
7. Reject inactive, unpublished, deleted, or unavailable variants.
8. Compute subtotal, delivery fee, discount, **VAT (if configured)**, total, advance, and balance server-side. VAT is computed as `vat_paisa = round(subtotal_paisa * vat_rate / 100)` where `vat_rate` is read from a Cloudflare secret / KV feature flag (`VAT_RATE_PERCENT`, default `0` for launch). VAT is stored as integer paisa in `orders.vat_paisa` per Section 6.2 and itemized in `order_items.vat_paisa`. POS applies the same VAT rule per Section 15.2. The browser must NEVER supply VAT — it is always recomputed server-side from the configured rate. **See Section 11.1.1 for the launch MVP scope and Bangladesh-specific limitations of the current VAT calculation.**
9. Apply coupon atomically in D1 if provided. Enforce active date, usage limit, min order, max discount.
10. Compute `total_quantity = SUM(quantity)`.
11. Apply COD rule: COD allowed only when `total_quantity <= 2`, unless staff override applies. If not allowed, return `402 PREPAYMENT_REQUIRED`.
12. Run FraudBD as a direct HTTP call with 1.5s timeout and circuit breaker. Skip for POS. If unavailable, allow only with `pending_review` flag unless feature flag says hard-block.
13. If FraudBD score is high, reject before stock reservation.
14. Reserve stock through VariantInventoryDO for each variant. Each reservation returns `reservation_id`.
15. If any variant reservation fails, release all successful prior reservations and return `409 INSUFFICIENT_STOCK`.
16. Create D1 order using atomic D1 batch: `orders`, `order_items`, `stock_reservations`, `order_status_events`, `payment_events` placeholder if needed.
17. If D1 order creation fails, immediately release all DO reservations and mark IdempotencyDO state as failed/released.
18. Complete IdempotencyDO with order_id and serialized response.
19. Enqueue order confirmation email.
20. Enqueue fraud-audit message for post-checkout enrichment.
21. If online payment or partial prepay is required, initiate UddoktaPay hosted payment and store transaction metadata.
22. Return order response or payment redirect payload.

### 11.1.1 VAT (Bangladesh Launch) — MVP Scope and Limitations

The launch VAT formula in step 8 (`vat_paisa = round(subtotal_paisa * vat_rate / 100)` with `vat_rate = VAT_RATE_PERCENT`, default `0`) is intentionally simplified. It MUST be read as the **MVP projection of a real-world VAT computation**, not as the legally-correct Bangladesh VAT calculation. This sub-section records the known gaps so they cannot silently leak into compliance or reporting work.

#### Launch Behavior (MVP)

| Aspect | Launch (MVP) behavior | Where it lives |
|---|---|---|
| Rate source | Single global rate from Cloudflare secret `VAT_RATE_PERCENT` (e.g. `0`, `5`, `10`, `15`) | `wrangler.jsonc` env / secret |
| Tax base | `subtotal_paisa` (sum of line items only) | Step 8 of Section 11.1 |
| Delivery fee VAT | Not taxed in MVP | Step 8 fast-path skips delivery |
| Discount interaction | VAT is computed AFTER discount (i.e. `vat_paisa = round(discounted_subtotal_paisa * vat_rate / 100)`). If launch instead chose to compute VAT before discount, an amendment is required and discount tax-credit semantics must be re-validated with finance. | Step 8 |
| Per-category / per-product VAT class | Not supported. All products use the same global rate. | Schema does not carry `product_vat_class` |
| Supplier / source-based reduced rates | Not supported | N/A |
| Mixed-rate carts (some items at 5%, others at 15%) | Not supported — single-rate cart | N/A |
| Refunds and credit notes | VAT is reversed proportionally on full refunds; partial refunds manually handled by staff | Section 13.2 |
| POS VAT | Same single-rate formula applied to POS subtotal | Section 15.2 |
| Display | Receipt / invoice / cart UI display VAT as a single line item | Components per Section 8.2 |
| Audit / accounting export | Owner digest + finance export include `subtotal_paisa`, `discount_paisa`, `delivery_paisa`, `vat_paisa`, `total_paisa` columns for every order/invoice | Section 25 + Section 27.2 |

#### Known Limitations vs. Bangladesh VAT and Supplementary Duty Act, 2012

The launch MVP does **not** model:

1. **Standard + supplementary duty.** Real BD VAT (15% standard, 10% reduced, 5% lower, 0% zero-rated) overlaps with supplementary duty on certain goods (cosmetics, electronics, tobacco, vehicles). The launch treats VAT as a single rate.
2. **Service VAT vs. trading VAT.** Retail boutique goods are typically "trading VAT"; services and digital goods have different rules. The launch is goods-only because boutique retail does not include services.
3. **Withholding / advance tax / TDS on certain import or wholesale operations.** Out of scope for boutique retail.
4. **Reverse charge mechanisms.** Not applicable at retail, deferred from MVP.
5. **Per-product declaration of VAT class.** A product can be "VAT-exempt" (e.g. basic food) or "supplementary-duty-liable" (e.g. cosmetics). MVP has no concept of this — the schema needs a `product_vat_class` column and the checkout must branch on it. Track this as a follow-up.
6. **Turnover thresholds.** Bangladesh VAT has small-trader registration thresholds and reduced obligations below them. Launch assumes the boutique is fully VAT-registered; if not, VAT should be 0 across the board — owner sets `VAT_RATE_PERCENT=0`.
7. **Half-yearly / yearly VAT return filings (Mushak forms).** Not in MVP scope; the launch simply records per-order VAT for owner-side reconciliation.
8. **Currency of VAT register.** Paid in BDT. `orders.vat_paisa` is integer paisa. No foreign-currency conversion handled in MVP.

#### Acceptance Criteria

- The Section 11.1 step 8 implementation MUST read `VAT_RATE_PERCENT` from the env at the time of order creation — **never** accept VAT from the client body, query string, or cart contents. Drift between prose and code is a P2 finding (D-19, D-20).
- Owner digest (Section 25) MUST include a periodic VAT total (`SUM(vat_paisa)` over the prior period) so the owner can reconcile against their Mushak filing. Until this digest exists, launching with `VAT_RATE_PERCENT > 0` is forbidden.
- If `VAT_RATE_PERCENT > 0`, owners MUST sign off on the launch MVP via a Staff acknowledgement in `audit_log` (event_type = `vat_rate_active_acknowledgement`) before orders are created. The Owner dashboard surfaces this in the same page as the rate.
- A Scheduled post-launch task (file a ticket) MUST track the per-category VAT class feature: schema migration to add `products.vat_class`, checkout branch, guide text update. The task is bound to a deferred feature in Section 7 of the V7.1 release notes (when written).

---

### 11.2 FraudBD Policy

#### Scoring

| Score | Action |
|---|---|
| 0-40 | Auto-approve |
| 41-70 | Create with `pending_review`; staff must confirm before fulfillment |
| 71-100 | Reject before reservation/order creation |
| Timeout | Allow with `pending_review` if circuit breaker open; alert if timeout rate above threshold |

#### Circuit Breaker Specification (mandatory)

The FraudBD circuit breaker is implemented in `ProviderHealthDO` (`provider:fraudbd`) and persists state transitions to the `api_audit_logs` table. The exact rules below MUST be implemented to prevent undefined checkout behavior.

| Parameter | Value | Rationale |
|---|---|---|
| Failure threshold | **5 failures in any 60-second window** | Catches sustained provider issues without tripping on a single transient blip |
| Open-state duration | **5 minutes** | Long enough for provider recovery, short enough to retry without manual intervention |
| Open-state fallback score | **`50` (neutral)** | Forces `pending_review` per the scoring table — safe default that does not block checkout |
| Half-open probe | First request after open expiry is allowed through; success closes, failure re-opens | Standard circuit breaker pattern |
| Failure definition | HTTP 5xx, network timeout (≥1.5s during checkout), or invalid/empty response schema | 4xx (e.g. bad request) is NOT a failure — it's a client error |

#### Checkout Behavior When Circuit Is Open

If the FraudBD circuit is **open** during checkout:

1. The checkout flow MUST NOT block. It MUST NOT wait for the circuit to close.
2. Use fallback score = `50` (neutral).
3. Order is created with `fraud_score = 50`, `fraud_source = 'circuit_open_fallback'`, and status `pending_review`.
4. Enqueue the order to the `fraud-audit` queue for async enrichment — when the circuit later closes, the queue consumer re-checks FraudBD and may downgrade `pending_review` to `confirmed` or escalate to `cancelled`.
5. Checkout returns success to the customer; no checkout-visible error.
6. A P2 alert fires (FraudBD circuit open during checkout) so on-call can investigate.

#### Safe Retry Rules

| Context | Timeout | Max retries | Backoff |
|---|---|---|---|
| **Checkout (synchronous)** | 1.5s | **0 retries** | N/A — failure trips the circuit; fallback score is used | 
| **`fraud-audit` queue (asynchronous)** | 3s | **1 retry** | 2s exponential backoff |

Synchronous checkout retries were previously underspecified and caused checkout to appear hung. The rule is now explicit: **zero retries during checkout** — a single failure is enough to trigger the fallback path. Retries happen only in the async `fraud-audit` queue, where latency is not customer-facing.

The queue named `fraud-audit` is not a checkout blocker. It records post-checkout analysis, improves fraud logs, can request staff review, and serves as the retry surface for orders that hit the open-circuit fallback.

### 11.3 Reservation Rollback Contract

VariantInventoryDO must support:

- `reserve({variant_id, quantity, checkout_id})`
- `release({reservation_id, reason})`
- `confirm({reservation_id, order_id})`
- `directSale({variant_id, quantity, invoice_id, staff_id, channel: 'pos'})` — atomic stock deduction for POS counter sales (no reservation lifecycle).
- `reverseDirectSale({variant_id, quantity, invoice_id, reason})` — compensating transaction for POS failures. Atomically restores the sold units back to available stock, records a `stock_adjustments` row with `reason = 'pos_reversal'`, links the `invoice_id`, and emits a P1 audit event. This is the ONLY way to undo a successful `directSale()`; staff must not manually edit inventory to compensate.
- `getAvailability({variant_id})`

#### Method Signatures (TypeScript)

```ts
interface VariantInventoryDO {
  reserve(input: { variant_id: string; quantity: number; checkout_id: string }):
    Promise<{ reservation_id: string } | { error: 'INSUFFICIENT_STOCK' }>;

  release(input: { reservation_id: string; reason: string }):
    Promise<{ released: boolean; already_released?: boolean }>;

  confirm(input: { reservation_id: string; order_id: string }):
    Promise<{ confirmed: boolean }>;

  directSale(input: {
    variant_id: string;
    quantity: number;
    invoice_id: string;
    staff_id: string;
    channel: 'pos';
  }): Promise<{ success: true } | { error: 'INSUFFICIENT_STOCK' | 'CONFLICT' }>;

  reverseDirectSale(input: {
    variant_id: string;
    quantity: number;
    invoice_id: string;
    reason: string; // e.g. 'd1_invoice_write_failed', 'same_day_void'
  }): Promise<{ reversed: boolean; audit_event_id: string }>;

  getAvailability(input: { variant_id: string }):
    Promise<{ stock: number; reserved: number; sold: number; available: number }>;
}
```

#### Checkout Rollback Triggers

Checkout must release reservations immediately on:

- D1 write failure.
- Payment initiation failure before order is valid.
- Multi-variant partial failure.
- Idempotency collision failure.
- Worker exception caught after reservation.

#### POS Compensating Transaction Contract

POS uses `directSale()` instead of the reservation lifecycle because counter sales are immediately paid. This creates a different failure surface: if `directSale()` succeeds but the subsequent D1 invoice write fails, stock has already been deducted with no invoice to attach it to. The contract is:

1. POS flow calls `VariantInventoryDO.directSale({variant_id, quantity, invoice_id, staff_id, channel: 'pos'})`.
2. **If `directSale()` returns `error`**: stop the POS flow, return error to POS UI, no compensation needed.
3. **If `directSale()` returns `success`**: proceed to write the D1 invoice ledger (`invoices`, `invoice_items`, `invoice_payments`, `invoice_audit`) atomically.
4. **If the D1 invoice write fails after `directSale()` succeeded**: the POS flow MUST immediately:
   a. Call `VariantInventoryDO.reverseDirectSale({variant_id, quantity, invoice_id, reason: 'd1_invoice_write_failed'})`.
   b. Verify the reversal returned `{ reversed: true, audit_event_id }`.
   c. Log a **P1 audit event** in `audit_log` with `severity = 'P1'`, `event_type = 'pos_compensating_transaction'`, `invoice_id`, `variant_id`, `quantity`, `reason`, `staff_id`, and `reversal_audit_event_id`.
   d. Return a clear error to the POS UI: `"Stock sale could not be recorded. Sale reversed. Please retry. Reference: {invoice_id}"`.
   e. Alert on-call (P1) — this path indicates either D1 unavailability or a code bug and must be investigated immediately.
5. **If `reverseDirectSale()` itself fails** (DO unavailable, network partition): this is a P0 incident. The POS flow must:
   a. Log a P0 audit event with the full context.
   b. Page on-call immediately.
   c. Return error to POS UI.
   d. The `inventory_reconciliation_runs` daily cron will detect the mismatch (DO has deducted, D1 has no invoice) and produce an owner digest; manual correction is required.

Cleanup cron releases only expired reservations that were missed by normal flows. The cleanup cron does NOT touch `directSale` state — POS sales are final once `directSale()` succeeds, and only `reverseDirectSale()` (or same-day void per Section 15.4) can undo them.

### 11.4 Payment Methods

| Method | Use Case | Advance | Balance |
|---|---|---|---|
| `cod` | Low-risk small orders | 0 | full total |
| `partial_prepay` | COD-risk orders | 50% of total | remainder COD |
| `uddoktapay` | Full online payment | full total | 0 |
| `in_store` | POS counter sale | full paid at counter | 0 |

### 11.5 Payment Webhook Flow

1. Receive webhook at `/api/payments/webhook`.
2. Verify HMAC signature before any processing.
3. Store event id in D1 `payment_events` idempotently.
4. Enqueue to `payment-webhooks` queue.
5. Return 200 quickly to provider.
6. Queue consumer verifies provider status server-to-server.
7. Update order payment status.
8. For paid/partial paid orders, update order status as allowed by state machine.
9. Enqueue payment confirmation email.

### 11.5.1 Webhook vs Reconciliation Conflict Handling (mandatory)

Both webhook-driven updates (Section 11.5) and the reconciliation cron (Section 11.6) write to `payment_events` and may update `orders.payment_status` and `orders.status`. The contract below is the canonical source of truth for who wins on conflict. Drift between this prose and implementation is a P1 finding.

| Source | Trust phase | Canonical for | Latency |
|---|---|---|---|
| **Webhook (provider live event)** | Real-time during checkout redirect flow | Initial payment confirmation; rapid customer redirect UX | < 1 second from provider event |
| **Reconciliation cron (server-to-server verify)** | Background, every 15 minutes | Catch-up for missed webhooks; final authority on disputed/duplicate events | 15 minutes worst-case lag |
| **Manual staff mark-paid via `/staff/orders/{id}/force-paid`** | Operator action | A documented override; audit row required | Within minutes |

#### Conflict Resolution Rules

1. **Event ordering is by `payment_events.created_at` (ISO 8601 UTC), not by delivery order.** Two events with the same logical status (e.g. both `paid`) are deduplicated by the `payment_events.event_id` idempotency check (Section 11.5 step 3). When contradictory events arrive (e.g. `paid` then later `refunded`), each is stored; reconciliation resolves the latest authoritative state.

2. **Webhook is canonical for the **payment_status flag** transitions it covers.** A webhook that says `paid` advances the order from `pending → confirmed`. A webhook that says `refunded` advances `confirmed → refunded` (after the Section 13.2 return/refund flow).

3. **Reconciliation is canonical for catch-up, never for reversal.** If the webhook queue saw `paid` for `order_X` at T=10:00, then a stale reconciliation at T=10:30 calls the provider and the provider's status response is ambiguous (network glitch mid-poll), reconciliation MUST NOT mark `order_X` as unpaid. Reconciliation only writes forward (`null/pending → paid`), never backward (`paid → pending/unpaid`), unless a documented refund/dispute event from the provider is present in `payment_events` for `order_X` and is more recent than the `paid` event.

4. **Ordering proof.** Every change to `orders.payment_status` MUST be accompanied by a `payment_events` row whose `created_at` is newer than the previous `payment_events` row for that order. The update SQL is:

   ```sql
   -- Both webhook consumer and reconciliation cron use this exact UPDATE shape.
   -- It guarantees monotonic provider-state progression regardless of arrival order.
   UPDATE orders
   SET payment_status = :new_status,
       status = :new_order_status,
       payment_confirmed_at = COALESCE(payment_confirmed_at, :now_iso),
       payment_provider_reference = :provider_reference,
       updated_at = :now_iso
   WHERE order_id = :order_id
     AND EXISTS (
       SELECT 1 FROM payment_events
       WHERE payment_events.order_id = :order_id
         AND payment_events.event_id = :event_id
         AND payment_events.created_at <= :now_iso
     );
   ```

   The `EXISTS` guard ensures the update only applies when the underlying event we are responding to has already been persisted. Webhook path: the event is persisted in step 3 of Section 11.5 before the consumer update; reconciliation path: the cron inserts the synthetic event row before calling the provider verify.

5. **Webhook queue consumer does NOT call provider's "verify" endpoint** in the happy path. Verification (step 6 in Section 11.5) is a redundancy: it confirms the webhook's payload is consistent with what provider's status API will later return. The result of the verify is **advisory**; the webhook's claim is the source of truth. If the verify disagrees with the webhook claim, an audit row `payment_webhook_verify_mismatch` is written; staff triage triggers.

6. **Reconciliation never runs more than 1 minute behind.** A stale check is worse than a missed one. The cron schedule is `*/15 * * * *` per Section 11.6, but the implementation MUST additionally stamp `last_reconciled_at` on every order processed. If the cron hits a worker unavailable and falls behind, the alarm in Section 25.3 fires.

7. **Refunds and disputes use the same append-only model.** Webhook events that say `refunded`, `chargeback`, `disputed`, or `cancelled` are stored with their own event_id. Reconciliation does NOT auto-process these — they require staff review per the Section 13.2 return flow. The order's status moves forward only after staff approval.

#### Acceptance Criteria

- Test fixtures in `tests/payment_conflict.test.ts` MUST cover: webhook pays first, reconciliation confirms (no-op); reconciliation pays first, webhook repeats (idempotent); webhook pays, manual force-paid is rejected (already paid); webhook says `paid` followed 2 hours later by `refunded` — both events stored, order status reaches `refunded` only after staff approval; reconciliation sees a stale provider response that disagrees with the recent webhook — webhook wins.
- Both webhook consumer and reconciliation cron MUST use the Section 11.5.1 UPDATE SQL exactly. A drift between the two paths is a P2 finding.
- The D-31 webhook handler HMAC verification rule extends to the reconciliation cron path: every provider call from the cron MUST include the same webhook secret/signature system (provider APIs that require auth headers).
- `payment_events` schema MUST include `index idx_payment_events_order_created (order_id, created_at)` for efficient "newest event for an order" queries. If absent in the current schema, file a follow-up migration to add it; until the migration lands, the conflict policy in this section binds regardless.

---

### 11.6 Payment Reconciliation

Cron every 15 minutes:

- Query pending payment orders older than 30 minutes.
- Call UddoktaPay/SSLCommerz status API.
- Update D1 if provider confirms payment.
- Cancel and release reservation if no payment after configured expiry.
- Alert if provider confirms payment but local event was missed.

---

## 12. Inventory and Stock Control

### 12.1 Inventory Model

Inventory is tracked at variant level.

Formula:

```txt
available = stock - reserved - sold
```

Definitions:

- `stock`: total received stock.
- `reserved`: units held by active checkout reservation.
- `sold`: units confirmed sold.
- `available`: computed value exposed to display/API.

### 12.2 VariantInventoryDO Rules

- One DO object per variant.
- Reservation commands are processed sequentially.
- DO checks current available stock before reserve.
- DO stores reservation IDs with expiry timestamp.
- DO updates D1 after successful reservation/release/confirm through a controlled gateway.
- Any D1 mismatch triggers reconciliation alert.

### 12.3 Reservation Lifecycle

| Event | Action |
|---|---|
| Reserve success | Increment reserved and create reservation record |
| Order D1 write failure | Immediate release |
| Payment timeout | Cancel order and release |
| Staff cancel before confirmation | Release |
| Staff confirms order | Move reserved to sold |
| Reservation expires | Cleanup cron releases |
| Return approved | Restock or mark returned inventory based on condition |

#### Reservation Cleanup Cron Specification (mandatory)

The cleanup cron is a **safety net**, not the primary rollback mechanism (per Guardrail #12). Its job is to release reservations that the normal checkout flow failed to release — e.g. Worker restart mid-flight, network partition after reservation but before order write, or queue consumer crash.

| Parameter | Value |
|---|---|
| Schedule | **Hourly** (Cloudflare Cron Trigger: `0 * * * *`) |
| Select window | `created_at < NOW() - INTERVAL 15 minutes` |
| Select filter | `release_requested_at IS NULL` (not already queued for release by another path) |
| Action per row | Call `VariantInventoryDO.release({reservation_id, reason: 'cleanup_cron_expired'})` |
| Failure handling | Log to `audit_log` (`event_type = 'reservation_cleanup_failure'`); retry next hour |
| Concurrency | Single Worker invocation per cron tick (Cloudflare Cron Triggers are single-instance by default) |

SQL pseudocode (SQLite syntax, run inside the cron Worker):

```sql
-- 1. Select expired, not-yet-released reservations.
SELECT reservation_id, variant_id, order_id, quantity
FROM stock_reservations
WHERE created_at < datetime('now', '-15 minutes')
  AND release_requested_at IS NULL
  AND status = 'active';

-- 2. For each row returned, call VariantInventoryDO.release() and stamp the row.
--    The stamp prevents the next hourly cron from re-releasing the same reservation
--    (race prevention between cron ticks).
UPDATE stock_reservations
SET release_requested_at = datetime('now'),
    status = 'release_requested',
    updated_at = datetime('now')
WHERE reservation_id = :reservation_id
  AND release_requested_at IS NULL;
```

#### Race Prevention Contract

Race conditions on reservation release are prevented by a D1 unique constraint:

```sql
-- Ensures one order can only have ONE active reservation across its lifetime.
-- Prevents double-reservation if checkout retries after a partial failure.
CREATE UNIQUE INDEX idx_stock_reservations_order_active
  ON stock_reservations(order_id)
  WHERE status = 'active';
```

The partial unique index `idx_stock_reservations_order_active` on `(order_id) WHERE status = 'active'` (created by migration `0024_stock_reservations_unique_constraint.sql`) means:

- An order can only have one active reservation at a time. A retry that tries to reserve a second time for the same `order_id` will fail at the D1 constraint check (the partial unique index on `(order_id) WHERE status = 'active'` rejects the second active row) — checkout must release the prior reservation first or use a new `checkout_id`.
- The `release_requested_at` stamp prevents double-release between concurrent cron ticks.
- If `VariantInventoryDO.release()` succeeds at the DO level but the D1 stamp fails, the next cron run sees the DO has already released (reserved count is 0) and the row will be marked stale; reconciliation cron flags it for owner review.

The 15-minute expiry window is intentionally short to keep stock from being locked during failed checkouts, but long enough that a slow-but-legitimate checkout (customer on a bad mobile network) is not falsely expired. The 1-hour cron cadence means the worst-case stale reservation lifetime is ~1h15m.

### 12.4 Reconciliation

Daily cron:

- Compare D1 order aggregates with inventory counts.
- Flag mismatch above 2 units.
- Produce owner digest.
- Create `inventory_reconciliation_runs` record.
- Never auto-correct without staff approval unless mismatch is only expired reservation cleanup.

#### POS Compensating-Transaction Carve-Out (mandatory)

The "mismatch above 2 units" threshold would silently miss a single-unit POS sale where `VariantInventoryDO.reverseDirectSale()` failed (a P0 incident per Section 11.3 step 5). To close this gap:

- The reconciliation cron MUST additionally query `audit_log` for any `event_type = 'pos_compensating_transaction'` rows from the last 24 hours where the corresponding `reverseDirectSale` outcome is unknown or failed.
- For each such row, the cron MUST compare the DO-level available stock against the D1 invoice ledger. ANY mismatch (even 1 unit) linked to a `pos_compensating_transaction` audit event is flagged as a P0 finding in the owner digest, regardless of the 2-unit general threshold.
- This carve-out is necessary because a single failed POS reversal is a P0 incident (stock has been deducted at the DO level with no invoice to attach it to), while a 1-unit drift in the general inventory is typically within acceptable noise.

Without this carve-out, the worst-case POS P0 (1-unit sale, failed reversal) would not be detected until manual investigation — defeating the purpose of the daily reconciliation.

### 12.5 Flash Sale Strategy

- Pre-cache product and category pages.
- Live stock API reads from DO or strongly consistent path.
- For more than 100 concurrent checkouts on same variant, enable virtual queue in VariantInventoryDO.
- If CPU or queue pressure increases, disable non-essential features: recommendations, AI generation, heavy analytics.
- Essential features remain: stock accuracy, checkout, payment, order creation.

---

## 13. Order Lifecycle

### 13.1 Order State Machine

| State | Allowed Transitions | Trigger | Side Effects |
|---|---|---|---|
| `created` | `confirmed`, `pending_review`, `cancelled` | Checkout/order creation | Reservation exists |
| `pending_review` | `confirmed`, `cancelled` | Fraud/staff review | No fulfillment until confirmed |
| `confirmed` | `processing`, `cancelled` | Staff confirms | Move reserved to sold |
| `processing` | `shipped`, `cancelled` | Staff starts fulfillment | Send processing/shipping prep notification if enabled |
| `shipped` | `delivered`, `returned` | Courier handoff/confirmation | Tracking shown to customer |
| `delivered` | `returned` | Courier/customer confirmation | COD balance recorded if applicable |
| `cancelled` | terminal | Staff/customer/payment timeout | Release stock/refund if needed |
| `returned` | `refunded`, `restocked` | Return approval | Restock based on condition |
| `refunded` | terminal | Refund complete | Update finance log |

Invalid transitions must be rejected and logged as security/bug events.

### 13.2 Return and Refund Flow

- Customer contacts support by phone, Messenger, WhatsApp, or staff channel.
- Staff creates return request with order_id, items, reason, condition, photos if needed.
- Manager/Owner approves or rejects.
- If approved, item is restocked only if condition allows resale.
- UddoktaPay refund is initiated for prepaid amount.
- COD-only orders require no payment refund unless store policy says otherwise.
- Return window default: 7 days after delivery, configurable by feature flag.

---

## 14. Staff Workflows and RBAC

### 14.1 Roles

| Permission | Owner | Manager | Staff | Viewer |
|---|---|---|---|---|
| orders.view | Yes | Yes | Yes | Yes |
| orders.create | Yes | Yes | Yes | No |
| orders.confirm | Yes | Yes | Yes | No |
| orders.cancel | Yes | Yes | Own orders | No |
| orders.refund | Yes | Yes | No | No |
| returns.approve | Yes | Yes | No | No |
| products.create | Yes | Yes | Yes | No |
| products.update | Yes | Yes | Yes | No |
| products.delete | Yes | No | No | No |
| coupons.create | Yes | No | No | No |
| coupons.deactivate | Yes | No | No | No |
| invoices.create | Yes | Yes | Yes | No |
| invoices.void | Yes | Yes | No | No |
| staff.manage | Yes | No | No | No |
| reports.view | Yes | Yes | No | Yes |

### 14.2 Staff-Assisted Orders

Channels:

- Phone
- Messenger
- WhatsApp
- In-store non-POS assisted delivery order

These use the guest checkout pipeline with staff identity attached. Fraud, COD threshold, partial prepay, reservation, and idempotency rules apply.

### 14.3 Staff Override

A Manager or Owner may override COD prepayment rules only if:

- Customer is known/trusted.
- Reason is entered.
- Override is recorded in `audit_log`.
- Order is marked `staff_override = true`.

Staff role cannot override unless explicitly granted later.

---

## 15. POS and In-Store Sales

### 15.1 POS Scope

POS is a dedicated counter-sale system. It is separate from online orders.

Canonical rule:

- POS does not use COD.
- POS does not use UddoktaPay initiation.
- POS does not use guest checkout reservations.
- POS must not write inventory directly to D1.
- POS must call `VariantInventoryDO.directSale()` to serialize stock deduction across online and in-store channels.
- POS writes invoice ledger tables only after DO stock deduction succeeds.
- **POS Compensating Transaction Contract (mandatory):** If `VariantInventoryDO.directSale()` succeeds but the D1 invoice write fails, the POS flow MUST immediately call `VariantInventoryDO.reverseDirectSale({variant_id, quantity, invoice_id, reason: 'd1_invoice_write_failed'})`, log a **P1 audit event** in `audit_log` (`event_type = 'pos_compensating_transaction'`), and return a clear error to the POS UI directing the cashier to retry. The full method signature and failure branches are defined in Section 11.3. The cleanup cron does NOT clean up POS sales — only `reverseDirectSale()` (or the same-day void flow in Section 15.4) can undo a `directSale()`.

### 15.2 POS UI

Route: `/staff/sales/pos`

Features:

- Search published variants.
- Add item to POS cart.
- Set quantity.
- Apply discount.
- Add VAT if configured.
- Choose payment method: cash, card, bKash, Nagad, Rocket, bank transfer.
- Support split payments if needed.
- Optional customer name/phone.
- Issue receipt.
- Print 80mm thermal receipt.

### 15.3 POS Receipt

Route: `/api/staff/invoices/{id}/print`

Receipt must include:

- Store name and address.
- Receipt number: `ZB-INV-YYYYMMDD-NNNN`.
- Date/time.
- Cashier.
- Customer details if provided.
- Line items with SKU.
- Subtotal, discount, VAT, total.
- Payment methods and references.
- Amount paid and change due.
- BIN and TIN from Cloudflare secrets: `POS_BIN`, `POS_TIN`.
- Void stamp if invoice is voided.
- Legal footer warning if BIN/TIN missing.

### 15.4 POS Void

- Same-day void only by Manager or Owner.
- Restores stock atomically.
- Writes invoice_audit row.
- Does not delete invoice.

---

## 16. Shipping Labels

Route: `/api/staff/orders/{id}/label`

Features:

- Self-contained HTML/SVG label.
- QR code with order ID and tracking URL.
- 210mm x 99mm label layout.
- Optional `?format=thermal` for 4x6 thermal printers.
- Courier templates for Pathao, Steadfast, Redx.
- RBAC: `orders.view` required.

Shipping labels are separate from POS thermal receipts.

---

## 17. Email and Notifications

### 17.1 Provider Strategy

The project uses an email adapter so providers can change without rewriting business logic. **The email adapter follows the exact same adapter pattern as payments** — there is no separate "email service" abstraction. The same file layout, the same interface contract, the same circuit breaker (`ProviderHealthDO`), the same audit logging into `api_audit_logs`, the same sandbox/mock mode.

#### Adapter Path

```txt
src/lib/integrations/email/
├── types.ts                  # SendEmailRequest, SendResponse, EmailProviderError
├── index.ts                  # factory: getEmailProvider() selects by EMAIL_PROVIDER env var
├── resend/
│   ├── client.ts             # Resend HTTP client
│   ├── types.ts
│   ├── errors.ts
│   ├── mock.ts
│   └── index.ts              # implements EmailProvider
└── cloudflare_email/
    ├── client.ts             # Cloudflare Email Sending binding client
    ├── types.ts
    ├── errors.ts
    ├── mock.ts
    └── index.ts              # implements EmailProvider
```

#### Provider Interface (mandatory)

Every email adapter MUST implement this interface. It mirrors the `PaymentProvider` interface pattern in Section 2.6.

```ts
// src/lib/integrations/email/types.ts
export interface SendEmailRequest {
  to: string[];                          // RFC 5322 recipients
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
  from_name: string;                     // sender display name (from-address is provider-bound)
  subject: string;
  html: string;                          // rendered template HTML
  text?: string;                         // plain-text fallback
  tags?: string[];                       // for provider-side categorization (e.g. 'order', 'abandoned_cart')
  custom_args?: Record<string, string>;  // provider-specific metadata (order_id, invoice_id, etc.)
  message_id: string;                    // internal idempotency key, written to email_log.message_id
}

export interface SendResponse {
  accepted: boolean;
  provider_message_id?: string;          // provider's own message id (for delivery tracking)
  provider: 'resend' | 'cloudflare_email';
  status: 'sent' | 'queued' | 'failed';
  error_code?: string;
  error_message?: string;                // redacted, no PII
}

export interface EmailProvider {
  sendEmail(request: SendEmailRequest): Promise<SendResponse>;
}
```

#### Provider Selection

The active provider is selected by the `EMAIL_PROVIDER` environment variable (Cloudflare Secret / Pages env var):

| `EMAIL_PROVIDER` value | Resolved adapter | Notes |
|---|---|---|
| `resend` (default) | `src/lib/integrations/email/resend/index.ts` | Production default; stable, well-documented API |
| `cloudflare_email` | `src/lib/integrations/email/cloudflare_email/index.ts` | Optional low-cost provider; requires account-level enablement and testing before switching |
| unset / empty | Falls back to `resend` | Safe default — never throws on missing env var |

Switching providers does NOT require a code change or redeploy of business logic: set `EMAIL_PROVIDER=cloudflare_email` in the Cloudflare dashboard and the next request picks it up. Tests use the `mock.ts` adapter in each provider folder.

Provider order (preference, when both are configured):

1. Resend as the default stable transactional email provider.
2. Cloudflare Email Sending as optional low-cost provider when the account feature is enabled and tested.
3. Cloudflare Email Routing for inbound customer/support email only.
4. Manual staff notification fallback for failed transactional email.

#### Integration with `ProviderHealthDO` and `api_audit_logs`

Every `sendEmail()` call goes through `ProviderHealthDO` (`provider:email`) and writes a row to `api_audit_logs` with `provider = 'email'`, `operation = 'send_email'`, `request_id = message_id`, `duration_ms`, `status`, `circuit_state`, and a PII-redacted summary. Circuit breaker rules follow the same pattern as FraudBD (Section 11.2): 5 failures / 60s → open 5 min → queue retries instead of blocking the caller. The `order-emails` queue consumer handles retries with 3x backoff per Section 6.7.

### 17.2 Email Types

| Email | Trigger | Queue | Limit |
|---|---|---|---|
| Order confirmation | Order creation | `order-emails` | 1/order |
| Payment confirmation | Payment success | `order-emails` | 1/payment event |
| Shipping notification | Status `shipped` | `order-emails` | 1/status change |
| Delivery confirmation | Status `delivered` | `order-emails` | 1/status change |
| Password reset | Staff reset request | `order-emails` | 3/hour/email |
| Abandoned cart reminder | D1 `cart_activity` eligible (24h inactive, consent allowed, not converted, not yet reminded) | `order-emails` | 1/cart, deduplicated to 1/customer_email per 24h wave |
| Return confirmation | Return approved | `order-emails` | 1/return |
| Low stock digest | Daily cron | `order-emails` | 1/day/owner |

### 17.3 Abandoned Cart Flow

#### Definition

A cart is **abandoned** when ALL of the following are true:

- `last_cart_update_at` is older than 24 hours (SQL: `< datetime('now', '-24 hours')`, evaluated in UTC).
- `abandoned_email_sent_at IS NULL` (no reminder sent yet).
- `converted_order_id IS NULL` (no order was ever created from this cart).
- `consent_status = 'allowed'` (customer explicitly consented to marketing email).
- `customer_email IS NOT NULL` (we have somewhere to send the reminder).

The legacy `abandoned_1h_sent_at` / `abandoned_24h_sent_at` two-touch model is replaced by a single 24h touch (`abandoned_email_sent_at`) to prevent reminder spam and reduce false positives.

#### Data Flow

1. CartDO writes to D1 `cart_activity` via (a) alarm-based persistence after 5 minutes of inactivity and (b) the `cart-activity` queue for batched fresher writes.
2. Customer phone/email is captured only after checkout begins or the customer enters contact info on the cart page.
3. Consent must be `allowed` before any marketing-style reminder is sent.
4. Cron runs every 15 minutes (Cloudflare Cron Trigger).
5. Cron queries eligible abandoned carts.
6. Cron enqueues reminder emails through the `order-emails` queue, deduplicated on `customer_email` so the same customer is not emailed twice even if they have multiple abandoned sessions.
7. Email consumer sends via the email provider adapter.
8. D1 updates `abandoned_email_sent_at` on successful enqueue.
9. If an order is created at any point, `converted_order_id` is set on `cart_activity` and no further reminders are sent for that session.

#### Cron SQL Pseudocode

```sql
-- 1. Select eligible abandoned carts, deduplicated per customer_email.
--    The ROW_NUMBER() window picks the most recently updated cart per email
--    so a customer with 3 stale carts only gets ONE reminder.
WITH eligible AS (
  SELECT
    session_id,
    customer_email,
    customer_name,
    customer_phone,
    subtotal_paisa,
    total_quantity,
    last_cart_update_at,
    ROW_NUMBER() OVER (
      PARTITION BY customer_email
      ORDER BY last_cart_update_at DESC
    ) AS rn
  FROM cart_activity
  WHERE last_cart_update_at < datetime('now', '-24 hours')
    AND abandoned_email_sent_at IS NULL
    AND converted_order_id IS NULL
    AND consent_status = 'allowed'
    AND customer_email IS NOT NULL
)
SELECT * FROM eligible WHERE rn = 1;

-- 2. For each row returned:
--    a. Enqueue reminder email to `order-emails` queue.
--    b. Immediately stamp abandoned_email_sent_at to prevent re-pickup
--       on the next cron run if the queue consumer is slow.
UPDATE cart_activity
SET abandoned_email_sent_at = datetime('now'),
    updated_at = datetime('now')
WHERE session_id = :session_id;
```

#### Race Prevention

- The `UPDATE ... SET abandoned_email_sent_at = datetime('now') WHERE session_id = :session_id AND abandoned_email_sent_at IS NULL` is an atomic compare-and-set in D1. If two cron runs race, only one will affect the row count; the other returns 0 rows updated and skips the enqueue.
- The `customer_email` dedup (`ROW_NUMBER() ... WHERE rn = 1`) ensures one reminder per customer per 24h wave even if they have multiple abandoned sessions.
- **Email consumer re-check guard (mandatory):** the `order-emails` queue consumer MUST re-run `SELECT converted_order_id FROM cart_activity WHERE session_id = :session_id` immediately before sending. If `converted_order_id IS NOT NULL`, the consumer MUST skip the send and log a `cart_converted_before_reminder` audit event. This closes the race window between cron enqueue and consumer send (typically 1–60 seconds) during which the customer may complete checkout. Without this guard, a customer who converts between enqueue and send would receive a "you left something in your cart" email for an order they just placed — a known e-commerce UX failure.
- If a customer places an order between the SELECT and the UPDATE, the next cron run sees `converted_order_id IS NOT NULL` and skips them; the `abandoned_email_sent_at` stamp is harmless (no email is sent for converted carts).

#### Timezone and UTC Reliance

All `datetime('now')` calls in the SQL above rely on SQLite's default behavior of returning UTC. This is a D1/SQLite invariant, not a general SQL invariant — if this code is ever ported to PostgreSQL or MySQL, the timezone handling must be re-validated (Postgres `now()` returns `TIMESTAMP WITH TIME ZONE` in the session timezone; MySQL `NOW()` returns the session timezone). The cron schedule itself (every 15 minutes) is timezone-agnostic because it operates on UTC-stored timestamps. The 24-hour "abandoned" threshold is also evaluated in UTC, which is the correct behavior for a Bangladesh-targeted store (UTC is unambiguous across DST transitions and is what Cloudflare Cron Triggers use).

---

## 18. Security Architecture

### 18.1 Authentication

- Staff login uses HttpOnly, Secure, SameSite=Strict cookies.
- Session hash stored server-side.
- Idle timeout: 30 minutes.
- Absolute timeout: 8 hours.
- Max concurrent sessions: 2 per staff user.
- Owner role requires TOTP 2FA.
- Password minimum: 10 characters, uppercase, number, special character.
- **Password reset (email-based):**
  - Self-service via `/staff/forgot-password` (email input + Turnstile bot protection).
  - Admin-initiated via `POST /api/staff/users/[id]/reset-password` (requires `staff.manage` + step-up auth).
  - Reset token: 32 random bytes → 64 hex chars, HMAC-SHA256 hashed before storage.
  - Token expiry: 1 hour (`password_reset_tokens.expires_at`).
  - One-time use: `used_at` column prevents replay.
  - Enumeration-safe: forgot-password always returns 200 even if email not found.
  - Rate limited: 3 attempts per IP per 15-minute rolling window.
  - On successful reset: all active sessions revoked (force re-login everywhere).
  - Every step logged to tamper-evident `audit_log` chain.

### 18.2 Staff Protection

- `/staff/*` and `/api/staff/*` protected by Cloudflare Zero Trust Access.
- RBAC middleware checks every staff API request.
- All staff data access to PII is logged in append-only audit_log.

### 18.3 CSRF

- Double-submit cookie pattern.
- HMAC-signed nonce.
- Header nonce required for unsafe methods.
- Rotate CSRF signing key monthly.

### 18.4 Rate Limiting

| Route | Limit |
|---|---|
| Checkout | 20/min/IP |
| Login | 5/min/IP and 10/min/email |
| Forgot password | 3/15min/IP |
| Coupon apply | 5/min/session; lock after repeated failure |
| General API | 60/min/IP |
| Product pages | 100/min/IP with bot challenge if suspicious |
| Payment webhook | Provider allowlist + signature verification |

### 18.5 Turnstile

- Checkout: invisible/managed based on risk.
- Staff login: managed mode.
- Coupon application: invisible after repeated failed attempts.
- Contact forms: managed mode.

### 18.6 CSP

CSP is deployment-time binding. The values below are the **launch-projection CSP** that the implementation MUST emit; the binding source of truth is the `Content-Security-Policy` header generated by `src/middleware/csp.ts` (or equivalent) and reflected in `wrangler.jsonc`. If a provider domain changes, only the middleware updates — this section is updated by the ARB amendment process (Section 34.8).

#### Launch-Projection CSP

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
  https://*.r2.cloudflarestorage.com
  ;
frame-src 'self' https://challenges.cloudflare.com
  https://securepay.sslcommerz.com
  https://uddoktapay.com
  ;
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self' https://uddoktapay.com https://securepay.sslcommerz.com;
media-src 'self' https://cdn.zabirboutiques.com;
worker-src 'self';
manifest-src 'self';
```

#### Domain Allowlist Rationale (provider-by-provider)

| Domain / pattern | Used by | Why this exact domain |
|---|---|---|
| `'self'` | Same-origin Workers/Assets | Base |
| `https://challenges.cloudflare.com` | Cloudflare Turnstile | Per Section 18.5 / 4.2 |
| `https://cdn.zabirboutiques.com` | Public product images and assets via Cloudflare CDN | Custom CDN in front of R2 |
| `https://*.r2.dev` | Direct-image fallback for R2 public bucket | R2 dev-domain pattern |
| `https://api.uddoktapay.com` | UddoktaPay create-charge + verify API (primary payment) | Per Section 2.4 |
| `https://uddoktapay.com` | UddoktaPay hosted payment page (iframe + redirect) | Hosted page domain |
| `https://securepay.sslcommerz.com` | SSLCommerz fallback payment gateway | Per Section 2.4 |
| `https://api.fraudbd.com` | FraudBD checkout-time call + audit queue | Per Section 2.4 / 11.2 |
| `https://api.resend.com` | Resend email provider (default) | Per Section 17.1 |
| `https://api.deepseek.com` | DeepSeek fallback AI provider | Per Section 2.7 / 24.2 |
| `https://*.imagify.com` | Imagify image-optimization adapter | Per Section 2.4 / 23.2 |
| `https://api.pathao.com` | Pathao courier when approved (optional) | Per Section 2.4 |
| `https://portal.packzy.com` | Steadfast courier (default Bangladesh path) | Per Section 2.4 |
| `https://api.redx.com.bd` | Redx courier (optional Bangladesh) | Per Section 2.4 |
| `https://*.r2.cloudflarestorage.com` | R2 direct uploads (signed URL flow + ops tooling) | Per Section 6.5 |

#### Per-Environment Variance

- **Production** uses the launch CSP above unchanged.
- **Staging** MAY have stricter scopes (e.g. omit courier domains that are not used in staging). The middleware reads the active provider list from `EMAIL_PROVIDER`, `PAYMENT_PROVIDER`, and the courier enablement feature flags (Section 6.4) and emits only the domains actually in use. The CI drift rule D-33 (Section 38.2) MUST verify that any direct `fetch()` to a third-party domain is also present in the middleware's connect-src allowlist.
- **Development** uses `'unsafe-eval'` and `'unsafe-inline'` for tooling only.

#### Custom-Policy Activations

- **Payment iframe pages (UddoktaPay / SSLCommerz).** When the customer is redirected to a hosted payment surface, the CSP `frame-src` MUST allow the provider's iframe domain. The redirect target page itself is served by the provider and does not inherit our CSP.
- **Cloudflare Email Sending binding.** When enabled (`EMAIL_PROVIDER=cloudflare_email`), CSP does not change — the binding happens server-side via fetch from Worker, not from the browser. The CSP stays aligned to the Resend defaults even if the active adapter is Cloudflare Email.
- **Bangla fonts** (Section 7.2). When a Bangla web font is shipped (e.g. Noto Sans Bengali), `font-src` extends to the font CDN. Until then, system fonts are used (Section 21) and `font-src 'self'` suffices.

#### Acceptance Criteria

- D-41: any `fetch('https://...')` in `src/` that targets a domain NOT in the launch CSP's `connect-src` is a P1 finding (the fetch will be blocked in production). Detection: `rg "fetch\('https://" src/` excluding `src/lib/integrations/**` AND `src/lib/contracts/**` (which contain domain constants).
- D-42: any iframe `src=` attribute pointing at a third-party domain NOT in the launch CSP's `frame-src` is a P1 finding.
- The middleware `src/middleware/csp.ts` MUST be unit-tested with the launch CSP and a sample launch CSP minus one provider; the test asserts the diff.
- The CSP header is `Content-Security-Policy` (no `Report-Only` mode at launch). Reporting mode is enabled post-launch once the team has a CSP report endpoint ready (Section 26 deferred).
- `frame-ancestors` is set to `'none'` to prevent clickjacking on staff routes. The middleware also sets `X-Frame-Options: DENY` as a fallback for older browsers.

#### CSP for `/staff/*` and `/api/staff/*`

The staff surface uses a tighter CSP by default:

```txt
default-src 'self';
script-src 'self' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' https://cdn.zabirboutiques.com data: blob:;
connect-src 'self' https://api.uddoktapay.com https://uddoktapay.com https://api.fraudbd.com;
frame-src 'self' https://challenges.cloudflare.com;
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
media-src 'none';
worker-src 'self';
frame-ancestors 'none';
```

This omits email / AI / image / courier / courier-provider domains because the staff app does not need to call them from the browser — those calls happen via the server adapter layer. If the staff app uses an AI alternate-text generator in the product editor, the CSP middleware MUST extend `connect-src` dynamically when the AI feature is used; this is controlled by `src/middleware/csp.ts` per-section.

---

### 18.7 Secrets

All secrets live in Cloudflare Secrets:

- Payment API keys.
- FraudBD key.
- Email provider key.
- DeepSeek key.
- POS_BIN and POS_TIN.
- CSRF signing secret.
- Webhook secrets.

Never commit `.env` secrets to Git.

---

## 19. Caching and CDN

### 19.1 Cache Strategy

| Content | Strategy | TTL | Purge |
|---|---|---|---|
| Product page | Static + Cache API/SWR | 1h, stale 1d | Product update, stock zero transition |
| Category page | Static + SWR | 30m, stale 2h | Category/product mapping update |
| Homepage | Static + SWR | 10m, stale 1h | Featured product update |
| Product listing API | Cache API | 5m | Catalog change |
| Checkout/API orders | No cache | 0 | Never cache |
| R2 images | CDN cache | 7d+ | Image update |
| Static JS/CSS | Immutable | 1y | Content hash deploy |
| Sitemap | R2 static | 24h | Daily cron/catalog change |

### 19.2 Cache Tags

Use cache tags:

- `product-{id}`
- `category-{id}`
- `homepage`
- `sitemap`
- `static-assets`

Stock changes purge product cache only when availability changes in a user-visible way, such as available to sold out or sold out to available.

---

## 20. SEO Architecture

### 20.1 URL Rules

- Product: `/products/{slug}`.
- Category: `/categories/{slug}`.
- Blog: `/blog/{slug}`.
- No product IDs in public URLs.
- **Canonical Latin slug policy (launch):** `{slug}` MUST be lowercase ASCII alphanumeric + hyphen only (`^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$` — 1–100 chars, no leading/trailing hyphen, no double hyphen). Bangla script characters and other Unicode ranges MUST NOT appear in URLs at launch; the canonical Bangla name is stored in a separate `product_name_bn` column and rendered server-side from the Latin slug.
- **Bangla alternate slug policy (post-launch):** when `/products/{latin_slug}?lang=bn` is requested, the page may render the Bangla product name, but the URL `/products/{latin_slug}` stays canonical. Marketing campaigns MAY use Bangla-containing URLs (e.g. `/campaigns/ঈদ-কালেকশন`) by registering a redirect from the Bangla path to the canonical Latin slug. See Section 20.5.
- **Slug uniqueness:** products, categories, blog posts, and campaigns occupy disjoint namespaces so a slug collision cannot accidentally route a customer to the wrong entity. After V7, the slug namespaces are validated at insert time; a duplicate raises a D-46 finding and the staff UI MUST elicit a disambiguating prompt.
- **Slug derivation:** when a product is created, the slug is generated server-side from the name using the canonical rules above. Staff MAY override; the override MUST pass the regex.
- **Disambiguation:** if two variants of a product share a name (e.g. "Saree" V1 and "Saree" V2), the override slug may include a `-v2` suffix. The exact disambiguation policy is in Section 23.x.
- Product canonical always points to `/products/{slug}`.

### 20.2 Structured Data

| Page | Schema |
|---|---|
| Product | Product + Offer (Bangla `name` and `description` go in `alternateName` / `description` fields using `lang="bn"` per schema.org conventions) |
| Category | ItemList |
| Homepage | Organization + WebSite |
| Breadcrumbs | BreadcrumbList |
| Order tracking | Limited Order structured data only when safe |

### 20.3 Meta and Social

- Title under 60 characters.
- Description under 160 characters.
- Unique product description.
- OG image from R2 generated 1200x630 variant.
- WhatsApp/Facebook-friendly OG tags.

### 20.4 Sitemap and Robots

- Sitemap generated daily via Cron and uploaded to R2.
- Max 50,000 URLs per sitemap.
- robots.txt allows products/categories/blog.
- robots.txt blocks `/api/*`, `/staff/*`, checkout APIs, and internal routes.

### 20.5 Bangla Localization v1 (Slug, Canonicalization, Search)

This sub-section binds the launch localization policy. It exists because Bangladesh customers frequently search, copy, and share product URLs in Bangla, even when the canonical product URL is in Latin script. The policy below preserves the Latin-URL architecture of Section 20.1 while supporting reasonable Bangla usage without breaking the SEO invariants.

#### 20.5.1 Slug and URL Canonicalization

- **Latin slug is canonical at launch.** All public URLs (`/products/{slug}`, `/categories/{slug}`, `/blog/{slug}`) use the ASCII regex from Section 20.1. Bangla characters never appear in canonical URLs.
- **Bangla alternate path is a query string at launch**, not a path segment. The customer can request `/products/{latin_slug}?lang=bn` and the page renders Bangla strings; the canonical URL stays Latin. Marketing campaigns MAY pre-render the query-string variant as a stable landing URL, but the canonical `<link rel="canonical">` always points to the Latin path.
- **Post-launch: Bangla path aliases.** Marketing may register a specific Bangla-containing path in KV (`REDIRECTS` namespace from Section 6.4) that 301-redirects to the canonical Latin URL. The redirect is unconditional (no language negotiation). The redirected page serves the canonical Latin path with the same content; we do not serve two distinct HTML documents.
- **`<html lang>` semantics.** Pages render with `<html lang="bn">` when `lang=bn` is requested and the locale module has Bangla translations; otherwise `<html lang="en">`. Astro components read from `src/lib/i18n/` rather than hardcoding English.
- **Order form is Bangla-first.** Per Section 10.5, the Buy Now landing form and checkout form MUST detect browser preference (`navigator.language`) and render Bangla labels first when supported. Phone normalization (Section 11.1 step 3) is unchanged: always `+880`.

#### 20.5.2 Product Data Schema (Bangla)

- `products.name` — canonical English/Latin name; preserved at launch.
- `products.name_bn` — **optional** Bangla name; nullable. When present, used as `alternateName` in schema.org JSON-LD and rendered in `<span lang="bn">` on Bangla-mode pages.
- `products.description_bn` — **optional** Bangla description; nullable. When present, used as `description` in JSON-LD under `lang="bn"`.
- `product_variants.label_bn` — optional Bangla variant label (e.g. for size/color).
- Slug derivation does NOT use `name_bn` at launch — only `name`. This keeps the URL regex simple.

A migration is required to add the Bangla columns; until that migration ships, Bangla data lives in JSON-encoded side-channels and is read-only (Section 22 search uses `name` only, see 20.5.3).

#### 20.5.3 Search (Unicode-Aware)

Search at launch uses **D1 FTS5** with Unicode-aware tokenizer rules. The Bangla-script coverage in this section is mandatory for any launch where at least 20% of catalog content has `name_bn` populated.

- **Tokenizer.** D1 FTS5 MUST use the `unicode61` tokenizer with `tokenchars='_৳'` (the `৳` is the Bangladesh Taka symbol; preserved as part of search tokens). The `remove_diacritics` flag is `1`. Search MUST NOT lose meaningful Bangla characters at index time.
- **Index columns.** The `products_fts` virtual table includes:
  - `name` (Latin)
  - `description` (Latin)
  - `sku`
  - `tags`
  - `name_bn` (nullable, lowercased via `lower()` function)
  - `description_bn` (nullable)
- **Query construction.** Customer queries are normalized: lowercased, NFC Unicode-normalized, then tokenized using the same `unicode61` rules. Bangla query terms tokenize correctly because the same tokenizer is used on both insert and query.
- **Stopwords.** Section 7.2's stopword list MAY include common Bangla stopwords (`এই`, `একটি`, `এবং`, `অথবা`). Treated as a v1.1 enhancement; ship the empty stopword list at launch.
- **Cross-script matching.** No cross-script matching at launch — searching "saree" does NOT match "শাড়ি". The Staff UI MAY offer a manual mapping file (e.g. treat `saree → শাড়ি`), but it is not a launch requirement.
- **Typo tolerance.** Section 22.1's FTS5 launch does not include typo tolerance; this is reserved for Section 22.3 (managed search) trigger criteria. Bangla typo tolerance is not addressed at launch.
- **Autocomplete (KV prefix cache).** KV keys are Latin-prefixed at launch. The Bangla-side autocomplete is post-launch because building a Bangla-trie in KV is non-trivial.

#### 20.5.4 Staff Data Entry for Bangla

- The product editor (`src/components/staff/ProductEditor.*`) accepts `name_bn` and `description_bn` as optional fields.
- AI helpers (Section 24) MAY generate `name_bn` from `name` via Workers AI / DeepSeek in v1.1. At launch, staff enter Bangla manually or paste from a translation tool.
- Pasting Bangla text MUST validate UTF-8 NFC normalization; malformed text returns a banner, not a silent corruption.
- Empty `name_bn` MUST be permitted (lat-loc products skip Bangla entirely). The validator MUST NOT block product publish because Bangla is missing.

#### 20.5.5 Acceptance Criteria and Tests

- Tests in `tests/i18n.test.ts` MUST cover:
  - Slug regex rejects Bangla characters (`'product-ক' MUST NOT match`).
  - `/products/{latin_slug}?lang=bn` renders Bangla strings when `name_bn` is present; falls back to `name` when absent.
  - `<html lang>` attribute matches the active locale.
  - D1 FTS5 index includes `name_bn`; a search query in Bangla matches products whose `name_bn` contains the term.
  - Slug derivation deterministic: two runs with the same input produce the same slug.
  - URL canonical link points to the Latin path even when the Bangla variant is rendered.
- D-46 drift rule asserts that public route URLs do NOT contain non-ASCII characters in their path segments. Detection: `rg "[^\x00-\x7F]" src/pages/[a-z]*/` (excluding `pages/api/`).
- D-45 drift rule asserts that any new locale code follows the package's `Locale` enum (`'en' | 'bn'` at launch). Adding a new locale requires a Section 34.8 amendment.
- D-47 drift rule asserts that no synonyms.txt / colloquial mapping file has been added without ARB sign-off (cross-script search is post-launch).

---

---

## 21. Performance Budgets

| Metric | Target | CI Fail Threshold |
|---|---:|---:|
| LCP | <2.5s | >3.0s |
| INP | <200ms | >300ms |
| CLS | <0.1 | >0.15 |
| TTFB public static | <300ms | >800ms |
| TTFB dynamic checkout | <800ms | >1200ms |
| Total page weight | <500KB | >700KB |
| JS per public island | <30KB gzip | >50KB gzip |
| Public islands/page | <=5 | >7 |
| Checkout Worker CPU | <30ms | >50ms |

Optimization rules:

- Use responsive images.
- Lazy-load below-fold images.
- Use system font for body.
- Use web font for headings only if it does not hurt LCP.
- Avoid `client:load` except checkout and staff dashboard.
- Do not ship staff dashboard JS to public pages.

---

## 22. Search Architecture

### 22.1 Phase 1: D1 FTS5

Launch search uses D1 FTS5 with Unicode-aware tokenization:

- Indexed columns (`products_fts` virtual table):
  - `name` (Latin canonical)
  - `description` (Latin canonical)
  - `category`
  - `tags`
  - `sku`
  - `name_bn` (nullable; uses `lower()` function and `unicode61` tokenizer)
  - `description_bn` (nullable; uses `lower()` function and `unicode61` tokenizer)
- Tokenizer binding:
  - `unicode61` (default), with `remove_diacritics=1` and `tokenchars='_৳'` so the Taka symbol survives index/query tokenization.
  - Same tokenizer MUST be used for index inserts and customer queries (asymmetric tokenization silently drops Bangla characters).
- Query normalization pipeline (Step 1 of every search request):
  1. Lowercase ASCII via `lower()`.
  2. NFC normalize Unicode (combine marks, fixes broken Bangla joins).
  3. Apply `unicode61` tokenization with the same `tokenchars` config.
  4. Trim empty tokens.
  5. Construct `MATCH` expression with quotes around multi-token terms.
- Cross-script matching (e.g. "saree" → "শাড়ি") is **post-launch**; not implemented in Phase 1. See Section 20.5.3 for rationale and D-47 drift rule.
- Stopword list (Section 7.2) intentionally empty in Phase 1; common Bangla stopwords are a v1.1 enhancement.

Autocomplete:

- KV prefix cache updated on product changes (Section 22.4 below clarifies KV is Latin-only at launch).
- Top 8 suggestions.
- Fallback to D1 if KV missing.

#### 22.1.1 Index Maintenance Contract

- The product publish/update CRON-equivalent function (Section 14 staff publish flow) MUST UPSERT into `products_fts` after every successful product write. Forgetting this MUST trigger a drift rule (D-48).
- Product deletion (soft or hard) MUST DELETE the corresponding FTS row within the same transaction. Cross-table drift is unacceptable.
- Bulk reindex operation is exposed as `POST /staff/admin/reindex-search` with admin-only access; idempotent; logs to `audit_log`.

#### 22.1.2 Bangla Content Bootstrap Gate

- The Bangla columns (`name_bn`, `description_bn`) are nullable at launch — but if a product has `name_bn` populated, it MUST also be present in `products_fts`. The D-49 drift rule asserts this.
- An empty product catalog without ANY `name_bn` content is acceptable at launch; the FTS5 Bangla path stays dormant until real Bangla data exists.
- The image search index for staff dashboard uses the same `products_fts` and inherits the Bangla rules.

#### 22.1.3 Acceptance Criteria and Tests

- `tests/search/sqlite-fts.test.ts` MUST cover:
  - Latin search: `WHERE name MATCH 'saree'` returns expected matches with BM25 ranking, scoring tokenization.
  - Bangla search: `WHERE name_bn MATCH 'শাড়ি'` returns expected matches when at least one product has `name_bn` populated.
  - Stop terms: matches with stopwords do not crash and return empty results.
  - NFC input: a Bangla query with broken NFD marks tokenizes into the same token as the canonical form.
  - Taka token survival: a SKU ending in `৳100` tokenizes as a single unit.
  - Cross-script failure: searching the Latin query against `name_bn` returns 0 results. (This asserts Phase 1 deliberately does not cross-script-match.)
- The script `scripts/drift/search-tokenizer-drift.ts` MUST run in CI and report D-48 (non-synchronized FTS updates) violations.
- The script `scripts/drift/i18n-drift.ts` (referenced in Section 38) MUST include D-46, D-47, D-48, D-49 violations and exit non-zero on any active rule failure.

### 22.2 Phase 2: Workers AI Semantic Search

Post-launch:

- Generate embeddings with Workers AI.
- Store vector metadata cheaply where practical.
- Use semantic matching for terms like “wedding dress” → “bridal saree”.
- BudgetCounterDO controls AI cost.

### 22.3 Phase 3: Managed Search

Trigger when:

- Catalog exceeds 10,000 products.
- Search p95 latency exceeds 200ms.
- Typo tolerance becomes a business requirement.

Options: Typesense, Meilisearch, Algolia. This is not launch scope.

---

## 23. Image Pipeline

### 23.1 Launch Cost Mode

To stay cost-effective, launch uses R2 + generated variants without requiring Cloudflare Images paid storage.

Flow:

1. Staff selects image in dashboard.
2. Browser creates a lightweight preview only; it must not generate production variants.
3. Browser uploads the original image to R2 using a signed upload URL.
4. Upload creates an `image-processing` queue message.
5. Queue consumer calls the Imagify adapter when API optimization mode is enabled.
6. Queue consumer generates or receives required variants and stores them in R2.
7. D1 stores image records, optimization status, and active variant URLs.
8. Product publish must not be blocked by Imagify failure; fallback status is `original_only` or `optimization_pending`.
9. Public pages use responsive `srcset` from available variants.

### 23.2 Optional Upgrade Mode

If approved later:

- Cloudflare Images/Image Resizing can generate variants on demand.
- Imagify can optimize, resize, compress, and generate WebP/AVIF variants if API cost is approved.

### 23.3 Required Variants

| Variant | Width/Size | Use |
|---|---:|---|
| thumbnail | 150px | Cart/admin |
| card | 400px | Product grid |
| detail | 800px | Product page |
| zoom | 1600px | Product zoom |
| og-image | 1200x630 | Social preview |

### 23.4 Alt Text

Alt text is required before product publish. AI can suggest alt text, but staff must review.

---

## 24. AI Integration

### 24.1 AI Features

| Feature | Primary | Fallback | Human Review |
|---|---|---|---|
| Product descriptions | Workers AI | DeepSeek | Required before publish |
| Product recommendations | Workers AI/logic | Category fallback | Not required |
| Semantic search | Workers AI embeddings | D1 FTS5 | Not required |
| Alt text suggestions | Workers AI | Staff manual | Required |
| Content moderation | Rule-based + AI | Staff review | Required for AI text |

### 24.2 Budget Enforcement

BudgetCounterDO tracks:

- Daily generation count.
- Monthly generation count.
- Provider cost bucket (USD).
- User/staff triggering generation.

#### Limit Hierarchy (resolves the count-vs-USD ambiguity)

Two kinds of limits apply simultaneously: **count-based** (calls per period) and **USD-based** (cost per period). Both are evaluated on every `canUseDeepSeek()` / `canUseWorkersAI()` call. The call is allowed only if BOTH limits have headroom. Whichever is hit first blocks the call.

| Limit type | DeepSeek | Workers AI | Notes |
|---|---|---|---|
| Daily call count | 50 / day | 200 / day | Anti-abuse; prevents runaway loops |
| Monthly call count | 1,000 / month | 5,000 / month | Anti-abuse; budget planning |
| Daily USD cost | **$5.00 / day** (UTC) | $1.00 / day | Real cost control |
| Monthly USD cost | $100 / month | $20 / month | Real cost control |
| Soft alert threshold | 80% of any limit | 80% of any limit | P3 alert to owner digest |
| Hard block threshold | 100% of any limit | 100% of any limit | Block + show "Budget limit reached" |
| Owner override | `ai_budget_limits.owner_override = 1` allows overage with P2 alert per call | Same | Owner-only escape hatch |

**Worked example:** if 50 DeepSeek calls cost $3.00, the call count limit hits first (50/50) and blocks the 51st call even though $2.00 of USD budget remains. Conversely, if 30 DeepSeek calls cost $5.00 (e.g. long generations), the USD limit hits first and blocks the 31st call even though 20 calls of count budget remain. The system blocks on whichever limit is exhausted first.

The original "50 product description generations/day" and "1,000 generations/month" limits from earlier drafts are preserved as the **count-based** limits. The $5.00/day UTC limit from the V7 update is the **USD-based** limit. Both apply (AND logic). This resolves the previous ambiguity where the two limit types appeared to compete.

#### BudgetCounterDO Interface (mandatory)

```ts
interface BudgetCounterDO {
  /**
   * Record actual usage after a successful AI call.
   * Idempotent on (provider, request_id) — duplicate calls do not double-count.
   * Updates the in-DO counter AND writes a row to ai_generation_log.
   */
  recordUsage(input: {
    provider: 'workers_ai' | 'deepseek';
    tokens: number;
    cost_usd: number;            // dollars, kept as float for AI cost only (NOT money - money is paisa)
    request_id: string;          // idempotency key
    staff_id: string;
    operation: string;           // 'product_description' | 'alt_text' | 'embedding' | etc.
  }): Promise<{ recorded: boolean; new_daily_total_usd: number }>;

  /**
   * Check whether a DeepSeek call may proceed.
   * Reads config from D1 ai_budget_limits on first call per period, then caches in-DO.
   * Returns false if the daily USD budget is exhausted.
   */
  canUseDeepSeek(): Promise<boolean>;

  // Equivalents for other providers exist but are not called on the hot path:
  canUseWorkersAI(): Promise<boolean>;
  canUseImagify(): Promise<boolean>;
}
```

#### DeepSeek Daily Budget (canonical)

| Parameter | Value |
|---|---|
| Daily limit | **$5.00 USD / day** (UTC day) |
| Soft alert | 80% ($4.00) — P3 alert to owner digest |
| Hard block | 100% ($5.00) — block + show "Budget limit reached" |
| Owner override | `ai_budget_limits.owner_override = 1` allows overage with P2 alert per call |
| Period | UTC midnight to UTC midnight |
| Persistence | Config in D1 `ai_budget_limits`; live counter in `BudgetCounterDO` (`budget:deepseek:YYYY-MM-DD`) |

#### Staff Action Flow (canonical)

Every staff-initiated AI action that uses DeepSeek MUST follow this flow:

```ts
// 1. Pre-flight check
const budget = env.BUDGET_COUNTER_DO.get(env.BUDGET_COUNTER_DO.idFromName('deepseek:' + today_utc));
const allowed = await budget.canUseDeepSeek();
if (!allowed) {
  // 2a. Block and show user-facing message
  return json({ error: 'BUDGET_LIMIT_REACHED', message: 'Budget limit reached. Please try again tomorrow or contact the owner.' }, { status: 429 });
}

// 2b. Proceed with DeepSeek call
try {
  const result = await deepSeekAdapter.generateProductDescription(input);

  // 3. Record actual usage (idempotent on request_id)
  await budget.recordUsage({
    provider: 'deepseek',
    tokens: result.tokens_used,
    cost_usd: result.cost_usd,
    request_id: input.request_id,
    staff_id: ctx.staff_id,
    operation: 'product_description',
  });

  return json({ result });
} catch (err) {
  // 4. On failure, do NOT record usage (the call didn't succeed)
  //    but DO log to api_audit_logs for observability.
  await logApiAudit({ provider: 'deepseek', status: 'error', error_code: err.code });
  throw err;
}
```

#### Fallback Behavior

If `BudgetCounterDO.canUseDeepSeek()` itself **times out** (DO unavailable, network partition, Worker restart):

| Behavior | Action |
|---|---|
| Default to **Workers AI** | Treat as if `canUseDeepSeek()` returned `false`. Use Workers AI as the safe fallback provider. |
| Log a P3 alert | `event_type = 'budget_counter_timeout'`, `provider = 'deepseek'`, `staff_id` |
| Show user a soft notice | `"AI budget check unavailable — using fallback model. Quality may differ."` |
| Do NOT block the staff action | A budget check timeout must not prevent the staff from doing their job. Workers AI is the safe path. |

The reasoning: Workers AI is the primary low-cost provider and has its own platform-level budget enforcement via the Cloudflare account. Falling back to Workers AI when BudgetCounterDO is unreachable is strictly safer than either (a) blocking the staff action or (b) allowing unlimited DeepSeek calls without budget enforcement.

#### Money Note

AI cost is tracked in USD as a float (`cost_usd`). This is the **only** place floats are allowed in the system. All other money (products, orders, payments) uses integer paisa per Section 6.2. The reason: AI provider APIs price in fractional USD cents and converting to paisa would lose precision without benefit. The `ai_budget_limits.daily_limit_usd_cents` column stores the limit in integer cents to keep the config drift-safe; the DO converts to float for comparison at runtime.

### 24.3 AI Safety

- Staff reviews all AI-generated public product content.
- User prompts are sanitized.
- Prompt injection patterns are logged.
- AI must not generate policy, legal, medical, or payment claims.
- AI suggestions are drafts, not source of truth.

---

## 25. Observability and Monitoring

### 25.1 Structured Logs

Log fields:

- `timestamp`
- `request_id`
- `route`
- `status_code`
- `duration_ms`
- `worker_cpu_ms`
- `error_type`
- `user_type`
- `channel`
- `payment_method`
- `order_id_hash`

Never log:

- Full phone numbers.
- Full addresses.
- Payment secrets.
- API keys.
- Raw webhook payloads without redaction.

### 25.2 Metrics

| Metric | Type | Alert |
|---|---|---|
| `orders_created` | counter | Drop >50% from hourly baseline |
| `revenue_paisa` | counter | Zero revenue for 30 min in business hours |
| `checkout_attempts` | counter | Failure >20% for 15 min |
| `payment_webhook_latency_ms` | histogram | p99 >5000ms |
| `stock_reservation_failures` | counter | >10/min/variant |
| `d1_query_duration_ms` | histogram | p99 >2000ms |
| `fraud_score_latency_ms` | histogram | p99 >3000ms or timeout >10% |
| `worker_cpu_time_ms` | histogram | p99 >50ms |
| `cache_hit_rate` | gauge | <70% product pages |
| `abandoned_cart_queue_depth` | gauge | Backlog > threshold |
| `email_send_failures` | counter | >5% for 15 min |

### 25.3 Alerts

- Critical: payment webhook failure, checkout broken, D1 unavailable, security breach.
- High: order creation failure, FraudBD timeout spike, Worker error >5%.
- Medium: cache hit drop, reservation expiry backlog, revenue anomaly.
- Low: slow query trends, AI budget usage, daily low-stock digest.

---

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
38. **(New) D1 schema completeness:** the `otp_secrets`, `api_audit_logs`, and `ai_budget_limits` tables MUST exist (Section 6.1). `otp_secrets` is required for Owner TOTP 2FA (Section 18.1; migration `0021_create_otp_secrets.sql`). `api_audit_logs` is required for `ProviderHealthDO` circuit breaker state and external API audit (Sections 2.4, 2.5, 11.2; migration `0022_create_api_audit_logs.sql`). `ai_budget_limits` is required for `BudgetCounterDO` durable config (Section 24.2; migration `0023_create_ai_budget_limits.sql`).
39. **(New) Abandoned cart definition:** a cart is abandoned when `last_cart_update_at` is older than 24 hours (SQL: `< datetime('now', '-24 hours')`), `abandoned_email_sent_at IS NULL`, `converted_order_id IS NULL`, `consent_status = 'allowed'`, and `customer_email IS NOT NULL`. Cron deduplicates on `customer_email` via `ROW_NUMBER()` window. Full SQL pseudocode in Section 17.3.
40. **(New) Buy Now session fixation mitigation:** `DirectCheckoutSessionDO.session_id = HMAC(secret, timestamp + random)`. Every request to `/buy-now/*` and `/api/buy-now/*` MUST verify Origin and User-Agent hash against the stored session values. Mismatch → 403 + delete the DO. The DO is deleted immediately after the order is successfully created. Full contract in Section 10.6.
41. **(New) VAT server-side computation:** checkout Step 8 (Section 11.1) MUST compute VAT server-side as `vat_paisa = round(subtotal_paisa * vat_rate / 100)` where `vat_rate` comes from `VAT_RATE_PERCENT` (default `0` for launch). The browser must never supply VAT.
42. **(New) BudgetCounterDO contract:** DeepSeek has a hard daily limit of $5.00 USD (UTC). Staff actions MUST call `canUseDeepSeek()` before the call and `recordUsage()` after success. If `canUseDeepSeek()` times out, fall back to Workers AI (safe path) — never block the staff action. Full spec in Section 24.2.
43. **(New) Reservation race prevention:** `stock_reservations` has a partial unique index `idx_stock_reservations_order_active` on `(order_id) WHERE status = 'active'` (migration `0024_stock_reservations_unique_constraint.sql`) so one order has at most one active reservation. The `release_requested_at` stamp prevents double-release between concurrent cron ticks. Full spec in Section 12.3.
44. **(New) CartDO eviction-and-read alarm re-arming:** CartDO `getCart()` MUST re-arm `setAlarm(now + 5 * 60 * 1000)` when the DO is rehydrated, `state.items.length > 0`, and no alarm is currently armed. Without this, an evicted DO that is only ever read never durably persists state. Full lifecycle in Section 6.3.
45. **(New) Cart activity queue/alarm write race resolution:** `cart_activity` upsert SQL (used by both alarm writer and queue consumer) MUST stamp `last_d1_write_at`, `last_d1_write_source`, `last_d1_write_seq` and reject stale writes via `WHERE :ts >= COALESCE(last_d1_write_at, '')`. Concurrent writers serialize on row-level locks. Full contract in Section 6.3.
46. **(New) `cart_version` increment rules:** `cart_version` increments only on successful state mutations per the Section 9.2 table — never on `getCart()`, `alarm()`, or idempotent replays. The increment is post-mutation, inside the DO input lock. Tests required in `tests/cart_version.test.ts`.
47. **(New) Bangla localization v1 contract:** public URLs MUST remain Latin-only per Section 20.5.1 (slug regex `^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$`). Bangla is delivered via `?lang=bn` query string or KV-driven 301 redirect to the canonical Latin URL. `<html lang>` updates only when the locale module has localized content; otherwise defaults to `en`. Cross-script search (Latin↔Bangla synonym map) is v1.1 only. Tests in `tests/i18n.test.ts` MUST pass; D-46 / D-47 / D-48 / D-49 / D-50 / D-51 enforced.
48. **(New) Bangladesh VAT launch scope:** MVP computes VAT as `vat_paisa = round(subtotal_paisa * vat_rate / 100)` server-side from `VAT_RATE_PERCENT` (defaulting to `0` for launch) per Section 11.1.1. Eight limitations (mixed supplies, partial-credit notes, input-VAT recovery, multi-rate slabs, advance-trader registration, mufassil extra-JV-VAT, separate contractor TDS, service-complaint process) are explicitly **deferred** and must be acknowledged in `audit_log` via `OWNER_ACK_BD_VAT_MVP` row, with an outstanding Section 34.8 amendment ticket before any production change. Browser-supplied VAT is forbidden (already covered by guardrail #4).
49. **(New) Webhook vs reconciliation conflict resolution:** payment webhooks MUST use the canonical UPSERT in Section 11.5.1 with `transition`-aware source stamping (`webhook`, `reconciliation`, `manual`). Stale rows are rejected via `WHERE last_status_change_at <= COALESCE(:last_change_received_at, '1970-01-01')`. This binds Section 11.5.1 across all payment gateways (UddoktaPay, SSLCommerz, bKash-adjacent adapters added post-launch). Drift rule D-31 series asserts adherence.
50. **(New) POS compensating transaction matrix:** the POS void flow MUST exercise the test matrix in Section 37.7 (POS-01 through POS-11). POS-06 (concurrent `directSale` + `reverseDirectSale` race) raises a P0 if the variant's `available` count drifts more than 1 unit — escalation must trigger before staff logout. `reverseDirectSale(reason='same_day_void')` is mandatory for same-day voids (already covered by guardrail #16, but the test matrix pins the regression check).

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
- [ ] `stock_reservations` has the partial unique index `idx_stock_reservations_order_active` on `(order_id) WHERE status = 'active'` (migration file `migrations/0024_stock_reservations_unique_constraint.sql`).
- [ ] Reservation cleanup cron runs hourly, selects `created_at < NOW() - 15 min AND release_requested_at IS NULL`.
- [ ] Abandoned cart has D1 queryable index (`cart_activity`).
- [ ] Abandoned cart definition: `last_cart_update_at` older than 24h (SQL `< datetime('now', '-24 hours')`), `abandoned_email_sent_at IS NULL`, `converted_order_id IS NULL`, `consent_status = 'allowed'`, deduplicated on `customer_email`.
- [ ] POS uses invoice ledger, not online orders.
- [ ] POS stock deduction uses `VariantInventoryDO.directSale()`.
- [ ] POS D1 invoice write failure calls `VariantInventoryDO.reverseDirectSale()` + logs P1 audit event with `severity='P1'`, `event_type='pos_compensating_transaction'`, `reversal_audit_event_id`.
- [ ] POS compensating transaction test matrix POS-01..POS-11 (Section 37.7) all pass, including POS-04 (D1 fail → reversal success), POS-05 (idempotency), POS-06 (reversal fails → P0 → on-call paged), POS-07 (cron carve-out catches 1-unit drift), POS-09 (multi-variant partial failure compensation), POS-10 (cron does NOT touch directSale state).
- [ ] Browser uploads original image only; variants are queue/API generated.
- [ ] Short-lived Durable Objects use alarm cleanup.
- [ ] CartDO publishes `cart-activity` queue messages instead of synchronous D1 writes.
- [ ] CartDO has a 5-minute inactivity alarm that persists state to D1 `cart_activity` (durability path).
- [ ] CartDO `getCart()` re-arms the 5-minute alarm on a rehydrated DO when `state.items.length > 0` and no alarm is currently armed (Section 6.3 eviction-and-read lifecycle).
- [ ] CartDO `cart_activity` upsert SQL stamps `last_d1_write_at`, `last_d1_write_source`, `last_d1_write_seq` and the WHERE clause uses `:ts >= COALESCE(last_d1_write_at, '')` to reject stale writes (Section 6.3 race contract).
- [ ] CartDO `cart_version` increments per the Section 9.2 table: after state mutation, by `+1` (or `+1 + new_items` for `mergeCart`); NOT incremented on idempotent replays, on `getCart()`, or on `alarm()`.
- [ ] CartDO implements `applyCoupon`, `removeCoupon`, `updateCustomerContact`, `mergeCart` per Section 36.6 contract stubs.
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
- [ ] Bangla localization follows v1 scope: URLs are Latin-only matching `^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$`; Bangla requested via `?lang=bn`; `<html lang="bn">` only on translated pages. Cross-script search synonyms are post-launch (D-46, D-47).
- [ ] D1 FTS5 search uses `unicode61` tokenizer with `tokenchars='_৳'`. Search query is lowercased and NFC-normalized. Insert and query tokenizer settings are identical (D-51).
- [ ] Product publish/update writes are transactional and keep `products_fts` in sync (D-48). nullable `name_bn` presence on `products` is mirrored in `products_fts` (D-49).
- [ ] Webhook vs reconciliation uses Section 11.5.1 canonical UPSERT SQL with `last_status_change_at <= COALESCE(...)` check to reject stale state (D-31 series).
- [ ] Bangladesh VAT launch scope is computed server-side from `VAT_RATE_PERCENT` (default 0); deferred limitations are acknowledged in `audit_log` via `OWNER_ACK_BD_VAT_MVP` row (Guardrail 48).

### Agent Awareness of Operational Sections

AI coding agents working on this repo MUST also be aware of the operational sections that turn these rules into living practice:

- **Section 34** — Guardrail Review & Enforcement Protocol. If a PR cannot satisfy a guardrail, the agent MUST flag this in the PR description and request a waiver (Section 34.7) rather than silently violating the rule.
- **Section 35** — D1 Migration Sequencing. Any schema-touching PR MUST reference the canonical migration filename (e.g. "implements migration `0024_stock_reservations_unique_constraint.sql`") and include both forward and rollback SQL plus a test fixture. Plan-only number references such as "Migration 0027" are forbidden — always cite the filename.
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
| D1 schema and constraints | Included and clarified. Adds `otp_secrets`, `api_audit_logs`, `ai_budget_limits` tables (Section 6.1) and the partial unique index `idx_stock_reservations_order_active` on `stock_reservations(order_id) WHERE status = 'active'` (Section 12.3; migration files 0021, 0022, 0023, 0024). |
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
| Staff password reset (email-based) | Included — self-service forgot-password + admin-initiated reset. HMAC-hashed tokens, 1-hour expiry, session revocation. `password_reset_tokens` D1 table (Section 6.1, 18.1). Migration `0035_password_reset_tokens.sql`. |
| External API audit trail | Included via `api_audit_logs` D1 table (Section 6.1, 2.5) |
| AI budget durable config | Included via `ai_budget_limits` D1 table (Section 6.1, 24.2) |
| Server-side VAT computation | Included in checkout Step 8 (Section 11.1), driven by `VAT_RATE_PERCENT` (default 0) |
| Email adapter contract | Included, mirrors payment adapter pattern (Section 2.3, 17.1) |
| Guardrail enforcement protocol | Included — roles, cadence, pre-release audit, waivers, amendments, incident response (Section 34) |
| D1 migration sequencing | Included — 5 numbered migrations (`0021_create_otp_secrets.sql`, `0022_create_api_audit_logs.sql`, `0023_create_ai_budget_limits.sql`, `0024_stock_reservations_unique_constraint.sql`, `0025_cart_activity_v7_cleanup.sql`) with forward SQL, rollback SQL, test fixtures, pre-flight checks, CI gate, apply procedure, failure recovery (Section 35) |
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
| 21 | Public route URLs are Latin-only | `rg "[^\x00-\x7F]" src/pages/[a-z]*/` excluding `pages/api/` | Zero non-ASCII characters in public URL paths (D-46) |
| 22 | No unauthorized synonyms or colloquial files | `rg "synonyms\.\(txt\|json\)\|cross.*script.*map" src/lib/search/` | Zero files matching search colloquialisms without ARB ticket (D-47) |
| 23 | Bangladesh VAT MVP owner acknowledgement is present in `audit_log` | D1 query: `SELECT COUNT(*) FROM audit_log WHERE event_type = 'OWNER_ACK_BD_VAT_MVP'` | Row exists with valid owner signature (Guardrail 48) |
| 24 | Payment webhook UPSERT uses canonical SQL with `transition`-aware timestamp checking | `rg "last_status_change_at <= COALESCE" src/lib/integrations/` | 100% adherence to status race-prevention query in Section 11.5.1 (Guardrail 49) |
| 25 | POS void integration tests pass the Section 37.7 compensating matrix | Execution of `vitest run tests/pos-matrix.test.ts` | All POS-01 through POS-11 assertions PASS (Guardrail 50) |

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

This section defines the concrete migration plan for the three new tables added in Section 6.1 (`otp_secrets`, `api_audit_logs`, `ai_budget_limits`) plus the reservation race-prevention constraint from Section 12.3. Each migration is numbered, scoped, and sequenced against the milestone plan in Section 29. Rollback paths are explicit because a failed D1 migration with no rollback is a P0 incident. The canonical numbering (0021–0025) is shared with the repo under `db/migrations/`; prosem numbers that diverge from filenames (e.g. "Migration 0024" for `otp_secrets`) MUST be treated as legacy drift and corrected to the filename.

### 35.1 Migration Numbering and Layout

| Property | Convention |
|---|---|
| File location | `migrations/{NNNN}_{short_slug}.sql` (e.g. `migrations/0021_create_otp_secrets.sql`) |
| Rollback file | `migrations/rollback/{NNNN}_{short_slug}.rollback.sql` (mandatory for every migration) |
| Numbering | Zero-padded 4-digit, monotonically increasing, never reused |
| Test fixture | `migrations/tests/{NNNN}_{short_slug}.test.ts` — runs against D1 local in CI before merge |
| Status field | Every migration row is recorded in `_migrations` table: `(id, applied_at, sha256, rollback_sha256)` |

Editing an applied migration is FORBIDDEN per Section 26.3. A change to an applied migration requires a new forward migration that supersedes it.

### 35.2 Migration Sequence

**Repository mapping (June 2026):** The migration numbers below are canonical and match the actual filenames under `db/migrations/`. The numbered sequence is `0021`–`0034` as of June 2026; ongoing migrations continue from `0035`. Subsequent repo migrations `0025`–`0034` (cart_activity cleanup, VAT column, reservation rebuild, customer phone OTP, staff step-up, courier handoff, payments unique, direct checkout activity, guest_carts/sessions/provider_health) are introduced in their own sections but follow the same numbering, layout, and rollout rules. Authoritative file-to-concept mapping lives in `tests/red-team-gaps.test.ts` and `tests/migration-fixtures.test.ts`.

The five migrations below MUST land in this order. Dependencies are explicit; a later migration cannot be applied until all its dependencies are applied.

#### Migration 0021 — `create_otp_secrets`

| Property | Value |
|---|---|
| Depends on | (none — first new table) |
| Required by milestone | M6 (Security) — must ship before Owner TOTP 2FA UI |
| Estimated effort | 0.5 day |
| Risk | Low — additive table, no existing data touched |

**Forward SQL:**

```sql
-- migrations/0021_create_otp_secrets.sql
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
-- migrations/rollback/0021_create_otp_secrets.rollback.sql
DROP INDEX IF EXISTS idx_otp_secrets_enabled;
DROP TABLE IF EXISTS otp_secrets;
```

**Test fixture assertions:**

- Inserting a row with a non-existent `staff_id` fails (FK violation).
- Inserting a row with `secret_cipher = NULL` fails (NOT NULL violation).
- Deleting a `staff_users` row cascades to delete the matching `otp_secrets` row.
- Rollback restores the schema to pre-migration state.

#### Migration 0022 — `create_api_audit_logs`

| Property | Value |
|---|---|
| Depends on | (none — independent table) |
| Required by milestone | M7 (Observability) and M10 (FraudBD) — must ship before FraudBD circuit breaker goes live |
| Estimated effort | 0.5 day |
| Risk | Low — additive table; high write volume once FraudBD integration ships, so indexes must be right |

**Forward SQL:**

```sql
-- migrations/0022_create_api_audit_logs.sql
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
-- migrations/rollback/0022_create_api_audit_logs.rollback.sql
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

#### Migration 0023 — `create_ai_budget_limits`

| Property | Value |
|---|---|
| Depends on | (none — independent table) |
| Required by milestone | M12 (AI) — must ship before BudgetCounterDO goes live |
| Estimated effort | 0.5 day |
| Risk | Low — additive table; seeded with one row per provider |

**Forward SQL:**

```sql
-- migrations/0023_create_ai_budget_limits.sql
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
-- migrations/rollback/0023_create_ai_budget_limits.rollback.sql
DROP TABLE IF EXISTS ai_budget_limits;
```

**Test fixture assertions:**

- Insert with `daily_limit_usd_cents = NULL` fails (NOT NULL).
- Insert with `provider = 'deepseek'` (duplicate PK) fails on second insert.
- Seed data is present after migration: `SELECT COUNT(*) FROM ai_budget_limits` returns 2.
- `BudgetCounterDO` can read the `deepseek` row and `daily_limit_usd_cents = 500` (= $5.00).
- Rollback removes the table and all seeded data.

#### Migration 0024 — `stock_reservations_unique_constraint`

| Property | Value |
|---|---|
| Depends on | All prior `stock_reservations` migrations (already in production) |
| Required by milestone | M4 (Inventory) — must ship before cleanup cron goes live to prevent double-release races |
| Estimated effort | 1 day (includes data backfill to resolve any existing duplicates) |
| Risk | **Medium** — adding a UNIQUE constraint to an existing table with live data can fail if duplicates exist. Requires a pre-flight data scan. |

**Pre-flight check (run before the migration in staging AND production):**

```sql
-- migrations/preflight/0024_check_duplicates.sql
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
-- migrations/0024_stock_reservations_unique_constraint.sql
-- Add release_requested_at column if it does not already exist.
ALTER TABLE stock_reservations ADD COLUMN release_requested_at TEXT;

-- Add the partial unique index: one active reservation per order.
CREATE UNIQUE INDEX idx_stock_reservations_order_active
  ON stock_reservations(order_id)
  WHERE status = 'active';
```

**Rollback SQL:**

```sql
-- migrations/rollback/0024_stock_reservations_unique_constraint.rollback.sql
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

#### Migration 0025 — `cart_activity_v7_cleanup` (legacy drop + race-contract columns)

| Property | Value |
|---|---|
| Depends on | All prior `cart_activity` migrations |
| Required by milestone | M9 (Email) — must ship before the abandoned-cart cron goes live, so the cron query does not reference non-existent columns |
| Estimated effort | 0.5 day |
| Risk | Low — drops columns that are no longer referenced by any V7 code path. Pre-flight check ensures the columns exist before dropping. |

**Why this migration exists:** two purposes, merged into a single forward migration because both target `cart_activity` and both are V7-launch-blocking.

1. **Drop legacy abandoned-cart columns:** pre-V7 production may have `abandoned_1h_sent_at` and `abandoned_24h_sent_at` columns on `cart_activity` from earlier drafts. V7 replaced these with a single `abandoned_email_sent_at` column (Section 6.3). Without this migration, the Section 34.4 check #4 ("legacy columns absent") would fail forever in any environment that carried the old columns forward.
2. **Add queue/alarm race-contract columns:** Section 6.3 establishes `last_d1_write_at`, `last_d1_write_source`, and `last_d1_write_seq` as the contract columns for cartDO queue/alarm race resolution. These are added in this same migration so the cart persistence contract and the cart cleanup ship together.

**Why these are merged:** separating them risks a half-migrated `cart_activity` table (e.g. legacy columns gone but race columns missing) that would fail the Section 6.3 invariants. ARB approved the merge at the V7 sequencing review; subsequent migrations MAY be merged the same way when they touch the same table.

**Pre-flight check (run before the migration):**

```sql
-- migrations/preflight/0025_check_legacy_columns.sql
-- Returns the legacy columns that currently exist on cart_activity.
-- The migration's forward SQL only drops columns that appear here.
PRAGMA table_info(cart_activity);
-- Inspect the result for rows where name IN ('abandoned_1h_sent_at', 'abandoned_24h_sent_at').
```

**Forward SQL (conditional, run per-column based on pre-flight):**

```sql
-- migrations/0025_drop_legacy_abandoned_cart_columns.sql
-- (1) Add the single 24h-touch abandoned-email column (replaces legacy pair)
ALTER TABLE cart_activity ADD COLUMN abandoned_email_sent_at TEXT;

-- (2) Add queue/alarm race-contract columns (Section 6.3 "Queue vs Alarm Write Race")
ALTER TABLE cart_activity ADD COLUMN last_d1_write_at TEXT;
ALTER TABLE cart_activity ADD COLUMN last_d1_write_source TEXT
  CHECK(last_d1_write_source IN ('alarm','cart_activity_queue','lifecycle_cleanup'));
ALTER TABLE cart_activity ADD COLUMN last_d1_write_seq INTEGER NOT NULL DEFAULT 0;

-- (3) Rebuild indexes against the new column set
DROP INDEX IF EXISTS idx_cart_activity_abandoned;
CREATE INDEX IF NOT EXISTS idx_cart_activity_abandoned
  ON cart_activity(last_cart_update_at)
  WHERE converted_order_id IS NULL
    AND abandoned_email_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cart_activity_email
  ON cart_activity(customer_email)
  WHERE customer_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cart_activity_write_source
  ON cart_activity(last_d1_write_source, last_d1_write_at);

-- (4) Drop legacy columns last, after indexes no longer reference them
ALTER TABLE cart_activity DROP COLUMN abandoned_1h_sent_at;
ALTER TABLE cart_activity DROP COLUMN abandoned_24h_sent_at;
```

**Rollback SQL:**

```sql
-- migrations/rollback/0025_drop_legacy_abandoned_cart_columns.rollback.sql
-- ROLLBACK_EXCEPTION: re-adding the legacy columns does NOT restore their data.
-- The columns were unused in V7 code paths; re-adding them as nullable TEXT columns
-- is sufficient for schema parity if a rollback is needed.
ALTER TABLE cart_activity ADD COLUMN abandoned_1h_sent_at TEXT;
ALTER TABLE cart_activity ADD COLUMN abandoned_24h_sent_at TEXT;
DROP INDEX IF EXISTS idx_cart_activity_email;
DROP INDEX IF EXISTS idx_cart_activity_write_source;
DROP INDEX IF EXISTS idx_cart_activity_abandoned;
CREATE INDEX IF NOT EXISTS idx_cart_activity_abandoned
  ON cart_activity(last_cart_update_at, abandoned_1h_sent_at, abandoned_24h_sent_at)
  WHERE converted_order_id IS NULL;
-- ROLLBACK_EXCEPTION: abandoned_email_sent_at, last_d1_write_at, last_d1_write_source,
-- last_d1_write_seq, idx_cart_activity_email, idx_cart_activity_write_source are NOT dropped.
-- Reason: blocking CartDO queue/alarm upserts would fail without these columns,
-- and dropping them mid-operations would invalidate any in-flight worker reads.
```

**Test fixture assertions:**

- After forward SQL: `PRAGMA table_info(cart_activity)` includes `abandoned_email_sent_at`, `last_d1_write_at`, `last_d1_write_source`, `last_d1_write_seq`.
- After forward SQL: `PRAGMA table_info(cart_activity)` does NOT include `abandoned_1h_sent_at` or `abandoned_24h_sent_at`.
- The new `idx_cart_activity_write_source` index is present.
- The abandoned-cart cron query (Section 17.3) runs successfully after forward SQL.
- The Section 6.3 upsert SQL (with race-contract columns and stale-write guard) runs successfully against the post-migration schema.
- The check constraint on `last_d1_write_source` rejects attempts to insert any value outside `'alarm' | 'cart_activity_queue' | 'lifecycle_cleanup'`.

#### Migration 0035 — `password_reset_tokens`

**File:** `db/migrations/0035_password_reset_tokens.sql`

**Purpose:** Creates two tables for staff password reset:
1. `password_reset_tokens` — HMAC-SHA256 hashed reset tokens with 1-hour expiry, one-time use (`used_at`), support for admin-initiated resets (`created_by` references the admin who triggered it), and admin revocation (`revoked_at` + `revoked_by`).
2. `password_reset_rate_limits` — Per-IP rate limiting for forgot-password attempts (3 attempts per rolling 15-minute window).

**Forward SQL:**
```sql
CREATE TABLE password_reset_tokens (
  id         TEXT PRIMARY KEY,
  staff_id   TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT
);
CREATE INDEX idx_pwd_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX idx_pwd_reset_tokens_staff ON password_reset_tokens(staff_id);

CREATE TABLE password_reset_rate_limits (
  ip_address    TEXT NOT NULL,
  attempted_at  TEXT NOT NULL
);
CREATE INDEX idx_pwd_reset_rate_ip ON password_reset_rate_limits(ip_address);
```

**Rollback SQL (`db/migrations/rollback/0035_rollback_password_reset_tokens.sql`):**
```sql
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS password_reset_rate_limits;
```

**Test fixture assertions:**
- After forward SQL: `PRAGMA table_info(password_reset_tokens)` includes all 9 columns.
- After forward SQL: Both `idx_pwd_reset_tokens_hash` and `idx_pwd_reset_tokens_staff` indexes exist.
- After forward SQL: `password_reset_rate_limits` table exists with `ip_address` and `attempted_at` columns.
- Token INSERT and lookup by `token_hash` works correctly.
- Foreign key constraint: inserting a `staff_id` that doesn't exist in `staff_users` is rejected.

### 35.3 Sequencing and Milestone Mapping

| Migration | File | Ships in milestone | Phase (Section 29) | Blocking | Notes |
|---|---|---|---|---|---|
| 0021 `create_otp_secrets` | `migrations/0021_create_otp_secrets.sql` | M6 Security | Phase 2 | Owner TOTP 2FA UI | Ship early in Phase 2 so 2FA is opt-in before public launch |
| 0022 `create_api_audit_logs` | `migrations/0022_create_api_audit_logs.sql` | M7 Observability | Phase 2 | FraudBD circuit breaker (M10) | Must be in place before FraudBD ships so breaker transitions are persisted from day 1 |
| 0023 `create_ai_budget_limits` | `migrations/0023_create_ai_budget_limits.sql` | M12 AI | Phase 3 | BudgetCounterDO | Seed data is part of the migration — do not seed via a separate script |
| 0024 `stock_reservations_unique_constraint` | `migrations/0024_stock_reservations_unique_constraint.sql` | M4 Inventory | Phase 1 | Cleanup cron (same milestone) | Pre-flight duplicate check is mandatory before applying |
| 0025 `cart_activity_v7_cleanup` | `migrations/0025_cart_activity_v7_cleanup.sql` | M9 Email | Phase 2 | Abandoned-cart cron + CartDO queue/alarm race contract | Merged migration: drops legacy columns AND adds race-contract columns. Pre-flight check for legacy column existence; ARB-approved merge documented in Section 35.2. |
| 0035 `password_reset_tokens` | `migrations/0035_password_reset_tokens.sql` | M6 Security | Phase 2 | Staff password reset UI | Creates `password_reset_tokens` (HMAC-hashed tokens, 1-hour expiry, one-time use, admin-initiated support) and `password_reset_rate_limits` (3/IP/15min) tables. |

### 35.4 Migration CI Gate

Every migration PR must pass the following CI checks before merge, in addition to the standard pipeline in Section 26.2:

1. **Forward SQL runs cleanly** against a fresh D1 local instance.
2. **Rollback SQL runs cleanly** against a D1 local instance that has just had the forward SQL applied. After rollback, the schema must match the pre-migration schema (asserted by a schema-diff script).
   - **Exception (additive-column rollback):** SQLite does not support `DROP COLUMN` before version 3.35, and even on supported versions leaving an additive column in place after rollback is harmless. A migration MAY document this exception by adding a comment in the rollback file: `-- ROLLBACK_EXCEPTION: column {name} left in place; harmless and idempotent.` The schema-diff script MUST honor this comment and not flag the residual column as a rollback failure. Migration `0024_stock_reservations_unique_constraint.sql` uses this exception for the `release_requested_at` column.
3. **Test fixture passes** — all assertions in `migrations/tests/{NNNN}_*.test.ts` pass.
4. **Invalid-insert tests** — for every NOT NULL, FK, CHECK, and UNIQUE constraint, an insert that violates it must fail. This is the "constraint test" referenced in Guardrail #32.
5. **Pre-flight checks pass** (where defined) — for migrations like 0027 that have a pre-flight script, the script must return zero rows against staging data.
6. **Migration is numbered correctly** — `NNNN` is exactly one greater than the highest existing migration number. No gaps, no reuse. The numbering policy is: a single monotonically increasing sequence starting at `0001`. There are no alternate numberings (e.g. V6-subset, V7-subset). Migration numbers listed in prose elsewhere in this document and in PR descriptions MUST always match the canonical filename. A regex pre-PR gate `^\d{4}_[a-z][a-z0-9_]*\.sql$` enforces the format.
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
| 5. Run pre-flight checks (if defined) | e.g. `migrations/preflight/0024_check_duplicates.sql` against staging | GO for the cluster | 1h |
| 6. **24-hour soak** (mandatory for risky migrations) | Staging runs with the new schema under realistic load for 24 hours | Release Captain | 24h |
| 7. ARB sign-off | ARB reviews staging results, signs off on production apply | ARB | N/A |
| 8. Backup production D1 | `d1-backup` queue message enqueued; wait for completion confirmation | Release Captain | Until backup verified |
| 9. Apply to production | `wrangler d1 migrations apply zabir-prod-db --remote` during the agreed deploy window | Release Captain + ARB reviewer on call | N/A |
| 10. Post-deploy verification | Smoke tests + the migration's test fixture run against production | Release Captain | 30 min |
| 11. Update release sign-off record | Section 34.5 record updated with migration list | Release Captain | N/A |

The 24-hour soak (step 6) is skipped only for migrations explicitly marked "low risk, additive only" by the ARB — migrations 0021, 0022, 0023 qualify; 0024 and 0025 do NOT.

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
   * Apply or clear a coupon code. CartDO stores the coupon code; checkout
   * validates the coupon rule with D1 (Section 11.1 step 9). Version rules
   * per Section 9.2.
   */
  applyCoupon(input: {
    session_id: string;
    cart_version: number;
    coupon_code: string;
    idempotency_key: string;
  }): Promise<{ state: CartState } | { error: 'CART_VERSION_CONFLICT' | 'INVALID_COUPON'; state: CartState }>;

  removeCoupon(input: {
    session_id: string;
    cart_version: number;
    idempotency_key: string;
  }): Promise<{ state: CartState } | { error: 'CART_VERSION_CONFLICT'; state: CartState }>;

  /**
   * Update customer contact after checkout starts (Section 11.1 step 3
   * normalizes phone to E.164 +880... format). Version rules per Section 9.2.
   */
  updateCustomerContact(input: {
    session_id: string;
    cart_version: number;
    customer_contact: { phone?: string; email?: string; name?: string };
    idempotency_key: string;
  }): Promise<{ state: CartState } | { error: 'CART_VERSION_CONFLICT' | 'INVALID_PHONE'; state: CartState }>;

  /**
   * Merge an anonymous cart into a logged-in customer's cart.
   * Used when a customer logs in mid-session.
   * Returns the merged state, or a conflict if the target cart version
   * has moved on since the merge was initiated (caller should retry).
   *
   * Version increment per Section 9.2: `target_version + 1 + (number of new items added)`.
   * Idempotent on (source_session_id, target_session_id): repeat calls within
   * 60 seconds return the same merged state without incrementing the version.
   */
  mergeCart(input: {
    source_session_id: string;
    target_session_id: string;
    target_cart_version: number;
    idempotency_key: string;
  }): Promise<
    | { state: CartState }
    | { error: 'CART_VERSION_CONFLICT'; state: CartState }
    | { error: 'SAME_SESSION' | 'SOURCE_EMPTY' }
  >;

  /**
   * Alarm handler. Three branches (full lifecycle, see Section 6.3):
   *   - 5-min inactivity: upsert D1 cart_activity, re-arm if more mutations arrive.
   *   - 30-day inactivity: final cart_activity write, then deleteAll().
   *   - Empty-cart alarm fire: skip D1 upsert, re-arm 30-day cleanup.
   *
   * MUST NOT increment cart_version. only last_d1_write_at/source/seq change.
   */
  alarm(): Promise<void>;
}

/**
 * Internal CartDO state shape. NOT part of the public contract — exposed here
 * only for clarity, since version increment + alarm lifecycle both depend on it.
 */
export interface CartDOInternalState extends CartState {
  /** ISO 8601 UTC; updated on every mutation. Distinct from cart_version. */
  last_mutation_at: string;
  /** ISO 8601 UTC; updated on every mutation. Use for queue/alarm scheduling. */
  last_cart_write_at: string;
  /** Set true once a `setAlarm` has been armed and not yet fired/cancelled. */
  soft_alarm_active: boolean;
  /** ISO 8601 UTC of the 30-day cleanup alarm, if armed. */
  thirty_day_alarm_at?: string;
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

Companion test matrices for related domains live in Section 37.7 (POS compensating transactions, POS-01..POS-11) and other future sections (e.g. cart persistence tests for the queue/alarm race contract in Section 6.3, Buy Now session-fixation tests).

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

### 37.7 POS Compensating Transaction Test Matrix (mandatory)

Section 11.3 defines the POS `directSale()` + `reverseDirectSale()` compensating-transaction contract. This section defines the exact CI test matrix that proves the implementation conforms. Every test below is mandatory and MUST pass on every PR that touches `src/durable-objects/variant-inventory-do.ts`, `src/api/staff/invoices/create.ts` (or equivalent POS handler), `src/durable-objects/cart-do.ts` interaction, or `src/lib/contracts/variant-inventory-do.ts`. Tests live in `tests/pos-compensating-transaction/`.

#### Test Matrix

| Test ID | Scenario | Initial state | Action | Expected outcome | Guardrail |
|---|---|---|---|---|---|
| POS-01 | Happy path: `directSale` success + D1 invoice write success | DO has 10 units available | POS calls `directSale({variant_id, quantity: 2, invoice_id, staff_id, channel: 'pos'})` then D1 invoice write | DO available -= 2; sold += 2; D1 `invoices`, `invoice_items`, `invoice_payments`, `invoice_audit` rows written; no audit event of type `pos_compensating_transaction`; receipt printable | 16 |
| POS-02 | `directSale` returns `INSUFFICIENT_STOCK` | DO has 1 unit available | POS calls `directSale({quantity: 5})` | POS flow stops before D1 write; error returned to POS UI; DO available unchanged; D1 has no invoice; no compensating transaction audit | 16 |
| POS-03 | `directSale` returns `CONFLICT` | DO has a pending operation against the same `variant_id` | POS calls `directSale` while another DO call is in flight | Returns `{ error: 'CONFLICT', message: ... }`; D1 has no invoice; no compensating transaction audit | 16 |
| POS-04 | `directSale` success + D1 invoice write FAILS — `reverseDirectSale` succeeds | DO has 5 units; POS flow proceeds to D1 write | D1 write raises an error or times out | POS flow calls `reverseDirectSale({variant_id, quantity: 2, invoice_id, reason: 'd1_invoice_write_failed'})`; DO available restored to 5; `stock_adjustments` row with `reason='pos_reversal'`; `audit_log` row with `severity='P1'`, `event_type='pos_compensating_transaction'`; error returned to POS UI with reference to `invoice_id` | 16, 26 |
| POS-05 | `reverseDirectSale` idempotency on `(invoice_id, variant_id, quantity)` triple | POS-04 already ran once | POS retries `reverseDirectSale` with the same triple | Returns `{ reversed: false, audit_event_id: <original>, message: 'already_reversed' }`; DO available NOT double-incremented; no second audit event | 16 |
| POS-06 | `reverseDirectSale` itself fails (DO unavailable, network partition) | POS-04 conditions met | DO is unavailable during `reverseDirectSale` call | `audit_log` row with `severity='P0'`, `event_type='pos_compensating_transaction_do_failure'`; on-call paged; POS UI receives error; **inventory_reconciliation_runs** cron downstream detects mismatch (D1 has no invoice but DO has deducted + reversal failed); daily owner digest flags this as a P0 inventory reconcile finding | 16, 11.3 |
| POS-07 | Daily reconciliation cron carve-out detects 1-unit drift after `reverseDirectSale` failure | Reconciliation runs after POS-06 | Cron compares DO available vs D1 invoice ledger; queries `audit_log` for `event_type='pos_compensating_transaction'` rows in the last 24h | Cron flags the row as a P0 inventory finding **regardless** of the 2-unit general threshold (Section 12.4 carve-out); owner digest email contains the row with full context | 16, 12.4 |
| POS-08 | Same-day POS void flow invokes `reverseDirectSale` with `reason='same_day_void'` | POS invoice created earlier in the day via POS-01; manager approves same-day void | POS UI calls same-day-void flow | `reverseDirectSale` restores units; `stock_adjustments` reason=`'pos_reversal'`, `invoice_audit` row created; invoice NOT deleted but marked voided; receipt note shows void stamp (Section 15.4) | 16, 15.4 |
| POS-09 | POS multi-line sale: 3 variants, one `directSale` succeeds, next returns `INSUFFICIENT_STOCK` | DO has 5 units of A, 1 unit of B, 5 units of C; order is for 2A + 2B + 1C | POS calls `directSale(A,2)` → success, then `directSale(B,2)` → INSUFFICIENT_STOCK | POS flow halts on B; calls `reverseDirectSale({variant_id: A, quantity: 2, invoice_id: <same>, reason: 'pos_partial_failure'})`; both DO available stocks restored; one P1 audit event covers the partial failure; POS UI shows error; D1 has no invoice | 16 |
| POS-10 | Reservation cleanup cron does NOT touch `directSale` state | POS sale completed hours earlier; reservation cleanup cron runs | Cron sweeps `stock_reservations` for expired rows | POS sale row in D1 is untouched; DO `sold` counter unchanged; no compensation triggered | 12, 16 |
| POS-11 | `directSale`'s CI gate — `output: 'static'` / `prerender = false` audit | Repo state | Drift audit runs | Drift script flags any `output: 'static'`, `output: 'hybrid'`, or `prerender = false` introduced by a POS-touching PR | 30, 1, 2 |

#### Test File Structure

```txt
tests/pos-compensating-transaction/
├── fixtures/
│   ├── do-storage-mock.ts       # In-memory DurableObjectStorage mock with eviction support
│   ├── clock-mock.ts            # Controllable clock for time-based tests
│   ├── env-mock.ts              # D1 mock with audit_log + invoice ledger tables
│   └── staff-permissions-mock.ts  # Manager vs Staff role per Section 14
├── pos-01-happy-path.test.ts
├── pos-02-insufficient-stock.test.ts
├── pos-03-conflict.test.ts
├── pos-04-d1-fail-reverse-success.test.ts
├── pos-05-reverse-idempotent.test.ts
├── pos-06-reverse-fails.test.ts
├── pos-07-reconciliation-carveout.test.ts
├── pos-08-same-day-void.test.ts
├── pos-09-partial-multi-variant.test.ts
├── pos-10-cleanup-cron-no-touch.test.ts
├── pos-11-drift-audit.test.ts
└── README.md                    # Explains how to run the suite locally
```

#### Sample Test (POS-04)

```ts
// tests/pos-compensating-transaction/pos-04-d1-fail-reverse-success.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { VariantInventoryDOImpl } from '@/durable-objects/variant-inventory-do';
import { EnvMock } from './fixtures/env-mock';

describe('POS-04: directSale success + D1 invoice write failure + reverseDirectSale succeeds', () => {
  let env: EnvMock;
  let inventory: VariantInventoryDOImpl;

  beforeEach(() => {
    env = new EnvMock();
    env.d1.seedStock({ variant_id: 'var_1', available: 5, reserved: 0, sold: 0 });
    // Force the next D1 write to throw.
    env.d1.failNextInvoiceWriteWith(new Error('D1 unavailable'));
    inventory = new VariantInventoryDOImpl(env.stub('variant:var_1'));
  });

  it('restores available stock after reverseDirectSale', async () => {
    const sale = await inventory.directSale({
      variant_id: 'var_1',
      quantity: 2,
      invoice_id: 'inv_test',
      staff_id: 'staff_pos_1',
      channel: 'pos',
    });
    expect(sale.success).toBe(true);

    // Trigger the POS flow: D1 invoice write fails.
    const posResult = await env.simulatePosFlow({ inventory, invoice_id: 'inv_test' });
    expect(posResult.ok).toBe(false);

    const after = await inventory.getAvailability({ variant_id: 'var_1' });
    expect(after.available).toBe(5);  // 2 sold units restored to available
    expect(after.sold).toBe(0);
  });

  it('writes a P1 compensating-transaction audit event', async () => {
    await env.simulatePosFlow({ inventory, invoice_id: 'inv_test' });

    const auditRows = await env.d1.query(
      `SELECT * FROM audit_log WHERE event_type = 'pos_compensating_transaction'`
    );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].severity).toBe('P1');
    expect(auditRows[0].invoice_id).toBe('inv_test');
    expect(auditRows[0].reversal_audit_event_id).toBeDefined();
  });

  it('writes a stock_adjustments row with reason=pos_reversal', async () => {
    await env.simulatePosFlow({ inventory, invoice_id: 'inv_test' });

    const adjRows = await env.d1.query(
      `SELECT * FROM stock_adjustments WHERE invoice_id = 'inv_test'`
    );
    expect(adjRows.length).toBe(1);
    expect(adjRows[0].reason).toBe('pos_reversal');
    expect(adjRows[0].quantity).toBe(2);
  });
});
```

#### CI Integration

The 11-test suite runs in CI on every PR and on every release branch. The CI job is `pos-compensating-transaction-tests.yml`:

```yaml
# .github/workflows/pos-compensating-transaction-tests.yml
name: POS Compensating Transaction Tests
on:
  pull_request:
    paths:
      - 'src/durable-objects/variant-inventory-do.ts'
      - 'src/api/staff/invoices/**'
      - 'src/lib/contracts/variant-inventory-do.ts'
      - 'src/lib/contracts/cart-do.ts'
      - 'tests/pos-compensating-transaction/**'
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
      - run: npx vitest run tests/pos-compensating-transaction/
        env:
          NODE_ENV: test
      - name: Upload coverage
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: pos-ct-coverage
          path: coverage/pos-compensating-transaction/
```

A failing test blocks the PR. The Release Captain cannot override this gate; a waiver from the ARB (Section 34.7) is the only path to ship with a failing POS test.

#### Coverage Target

The 11 tests MUST collectively achieve:

- **100% line coverage** of `directSale` and `reverseDirectSale` methods on `VariantInventoryDO`.
- **100% branch coverage** of the `if (result.success === false)` and the `try { d1Write } catch { compensate }` paths in the POS flow handler.
- **≥ 95% line coverage** of `src/lib/contracts/variant-inventory-do.ts` (the contract stub).

Coverage is enforced by the CI job; a drop below these targets fails the build.

#### Test Data Hygiene (POS-specific)

- Tests MUST NOT make real HTTP calls or touch external APIs.
- Tests MUST NOT touch real D1 — all D1 access goes through `EnvMock.d1` (in-memory).
- Tests MUST NOT depend on wall-clock time — all time-based logic uses `ClockMock`.
- Tests MUST clean up between cases.
- Tests MUST run in any timezone; all timestamps are UTC ISO 8601.

A POS test that violates these hygiene rules is a P2 finding and is disabled until fixed.

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
| D-04 | Reference to `abandoned_1h_sent_at` or `abandoned_24h_sent_at` in code or migration | `rg "abandoned_1h_sent_at\|abandoned_24h_sent_at"` | Replace with `abandoned_email_sent_at` (single 24h touch). Apply migration `0025_cart_activity_v7_cleanup.sql` if columns are still present. |
| D-05 | CartDO mutation that does NOT arm the 5-minute alarm | Code review of `src/durable-objects/cart-do.ts` — every mutation method must call `setAlarm(now + 5*60*1000)` AND increment `cart_version` after state mutation succeeds (Section 9.2 contract) | Add the alarm call; add a unit test asserting the alarm is armed and version increment matches the Section 9.2 table. |
| D-05a | CartDO `getCart()` does NOT re-arm alarm on a rehydrated DO when items exist | Code review of `src/durable-objects/cart-do.ts` — `getCart()` MUST call `setAlarm(now + 5*60*1000)` iff `state.items.length > 0` AND `ctx.storage.getAlarm() === null` (Section 6.3 eviction-and-read lifecycle) | Add the re-arm branch. Add a test that simulates an evicted DO and asserts the alarm is armed on the first read after rehydration. |
| D-05b | CartDO `alarm()` handler increments `cart_version` | Code review of `src/durable-objects/cart-do.ts` — `alarm()` MUST NOT modify `cart_version`; only `last_d1_write_at/source/seq` projector columns change (Section 6.3 / 9.2) | Remove any version increment from the alarm handler. Add a test asserting `cart_version` is unchanged after `alarm()` fires. |
| D-05c | CartDO missing `applyCoupon` / `removeCoupon` / `updateCustomerContact` / `mergeCart` methods | `rg "class CartDO" -A 200 src/durable-objects/cart-do.ts` and check for each method name | Add the methods per the Section 36.6 contract stubs. Each MUST increment `cart_version` per Section 9.2. |
| D-06 | CartDO synchronous D1 write inside a mutation method | `rg "env.DB.prepare.*cart_activity" src/durable-objects/cart-do.ts` (mutation methods only) | Replace with a `cart-activity` queue message. The D1 write belongs in the alarm handler or queue consumer. |
| D-06a | Queue/alarm upsert SQL missing `last_d1_write_at`, `last_d1_write_source`, `last_d1_write_seq` columns or missing `last_d1_write_at` guard | `rg "UPDATE cart_activity" src/` and inspect the SQL; the upsert MUST stamp all three columns and use the `(:ts >= COALESCE(last_d1_write_at, ''))` guard (Section 6.3) | Update upsert SQL; add a test asserting a stale write is rejected by the guard. |
| D-06b | `cart_activity` schema missing `last_d1_write_at`, `last_d1_write_source`, `last_d1_write_seq` columns | D1 schema introspection | Apply migration `0025_cart_activity_v7_cleanup.sql` (extended per Section 6.3 race contract). |
| D-07 | `VariantInventoryDO` class missing `reverseDirectSale` method | `rg "class VariantInventoryDO" -A 50 src/durable-objects/` and check for method | Add the method per Section 11.3 / 36.2. Add the `implements VariantInventoryDO` keyword. |
| D-08 | POS flow that does NOT call `reverseDirectSale` on D1 invoice write failure | Code review of `src/api/staff/invoices/create.ts` (or equivalent) | Add the compensating transaction call + P1 audit log per Section 11.3 / 15.1. Mandatory test matrix POS-01..POS-11 in Section 37.7 must all pass. |
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
| D-23 | `stock_reservations` missing the `idx_stock_reservations_order_active` partial unique index | D1 `PRAGMA index_list('stock_reservations')` | Apply migration `0024_stock_reservations_unique_constraint.sql` per Section 35.2. |
| D-24 | `stock_reservations` missing `release_requested_at` column | D1 schema introspection | Apply migration `0024_stock_reservations_unique_constraint.sql` per Section 35.2. |
| D-25 | Missing `otp_secrets`, `api_audit_logs`, or `ai_budget_limits` table | D1 schema introspection | Apply migration `0021_create_otp_secrets.sql` / `0022_create_api_audit_logs.sql` / `0023_create_ai_budget_limits.sql` per Section 35.2. |
| D-26 | `cart-activity` queue not wired up | `wrangler.toml` queues config | Add the queue binding. Confirm `CartDO` publishes to it on every mutation. |
| D-27 | Abandoned cart cron query missing `customer_email` dedup | Code review of `src/cron/abandoned-cart.ts` | Add the `ROW_NUMBER() OVER (PARTITION BY customer_email)` window per Section 17.3. |
| D-28 | Abandoned cart cron missing `consent_status = 'allowed'` filter | Same as D-27 | Add the consent filter. Never send marketing email without consent. |
| D-29 | Money stored as REAL/FLOAT outside AI cost | SQL-side: `rg "(price\|cost\|subtotal\|total\|delivery\|discount\|advance\|balance\|refund\|vat).*\\b(REAL\|FLOAT\|DOUBLE)\\b" migrations/`. TS-side: `rg ":(number\|float).*(_paisa\|_amount\|price\|cost\|subtotal\|total\|delivery\|discount\|advance\|balance\|refund\|vat)" src/` excluding `cost_usd` in BudgetCounterDO (the documented float exception) | Convert to integer paisa. The only float money is `cost_usd` in `BudgetCounterDO.recordUsage()`. The broadened regex catches columns/types without the `_paisa` suffix that earlier drafts missed. |
| D-30 | PII in structured logs | Log scan over staging for the last 7 days | Add PII redaction at the log sink. Treat as P2 finding. |
| D-31 | Webhook handler missing HMAC verification | `rg "webhook" src/api/payments/` and check each handler | Add `verifyHmac()` call before any processing. |
| D-31a | Webhook queued consumer not idempotent on `payment_events.event_id` | `rg "INSERT OR IGNORE\|ON CONFLICT" src/api/payments/webhook-consumer.ts` | Add the `INSERT OR IGNORE` on `payment_events (event_id UNIQUE)` per Section 11.5 step 3. Tests in `tests/payment_conflict.test.ts` must pass. |
| D-31b | Reconciliation cron writes backward (`paid → pending`) | Code review of `src/cron/payment-reconciliation.ts`; check that transitions only advance forward per Section 11.5.1 | Remove backward writes. Tests in `tests/payment_conflict.test.ts` (forward-only reconciliation rule) must pass. |
| D-31c | `payment_events` table missing `(order_id, created_at)` index for "newest event per order" lookup | D1 schema introspection | Apply migration to add `idx_payment_events_order_created`. Tests in `tests/payment_conflict.test.ts` will fail CI without the index. |
| D-32 | Staff route missing Zero Trust or RBAC middleware | Cloudflare Access config audit + `rg "export (async )?function (GET\|POST\|...)" src/pages/staff/` | Add Zero Trust on the Cloudflare side; add RBAC middleware in the route handler. |
| D-33 | External API call without going through a provider adapter | `rg "fetch\('https://" src/` excluding `src/lib/integrations/**` | Move the call into a provider adapter per Section 2.3. |
| D-34 | AI call sending PII to the provider | Code review of AI prompts — search for customer name, phone, address in prompt templates | Strip PII from prompts. Log the violation as a P1 finding. |
| D-35 | Migration without a rollback file | `ls migrations/` and `ls migrations/rollback/` — every `NNNN_*.sql` needs a matching `rollback/NNNN_*.rollback.sql` | Write the rollback file. Block the PR until it exists. |
| D-36 | POS compensating transaction — missing `directSale` or `reverseDirectSale` method on `VariantInventoryDO` | `rg "class VariantInventoryDO" -A 60 src/durable-objects/` and check for both methods | Add per Section 11.3 / 36.2. The CI gate for Section 37.7 (`pos-compensating-transaction-tests.yml`) checks 100% coverage of both methods. |
| D-37 | POS compensating transaction — `reverseDirectSale` not idempotent on `(invoice_id, variant_id, quantity)` | Code review of `src/durable-objects/variant-inventory-do.ts`; check that the DO stores a dedup key | Add the idempotency dedup. Test POS-05 must pass. |
| D-38 | POS flow missing P1 audit event on `reverseDirectSale` invocation | `rg "event_type.*pos_compensating_transaction\|severity.*P1.*pos" src/` | Add the audit row insertion per Section 11.3 step 4c. Test POS-04 must pass. |
| D-39 | Daily reconciliation cron missing the POS carve-out that flags 1-unit drift for `pos_compensating_transaction` audit rows | Code review of `src/cron/inventory-reconciliation.ts`; check for `audit_log` join on `event_type='pos_compensating_transaction'` | Add the carve-out per Section 12.4. Test POS-07 must pass. |
| D-40 | Same-day POS void flow does not invoke `reverseDirectSale` with `reason='same_day_void'` | `rg "same_day_void\|same-day-void" src/api/staff/invoices/` | Per Section 15.4. Test POS-08 must pass. |
| D-41 | Direct `fetch('https://')` to a third-party domain NOT in the launch CSP `connect-src` allowlist | `rg "fetch\('https://" src/` excluding `src/lib/integrations/**`, `src/lib/contracts/**`, tests | Add the domain to `src/middleware/csp.ts` allowlist and emit it under `connect-src` for the relevant response. The drift script cross-references this list. |
| D-42 | Iframe `src=` attribute pointing to a third-party domain NOT in the launch CSP `frame-src` allowlist | `rg "iframe\|<iframe" src/` and inspect each `src=` URL | Add the domain to the middleware frame-src allowlist OR redirect the user to the provider's hosted page instead of iframe-embedding. |
| D-43 | VAT rate (`VAT_RATE_PERCENT`) referenced from a code path that accepts browser-supplied VAT | `rg "vat" src/lib/checkout/` and check request parsing | Strip VAT from any client-supplied data; always recompute server-side. Cross-check with D-19 / D-20. |
| D-44 | Email adapter `/api/email/*` route exposing send capability without RBAC | `rg "/api/email" src/pages/api/` | Wrap in staff RBAC middleware (Section 14) — public API cannot trigger transactional email. |
| D-45 | Translation / Bangla URL handling missing or implemented ad-hoc | `rg "URLSearchParams\|decodeURIComponent" src/lib/i18n/` (or equivalent locale module) | Implement per Section 20.5 (Bangla Localization v1). Tests in `tests/i18n.test.ts` must pass. |
| D-46 | Public route URLs containing non-ASCII characters in path segments (Bangla / Bengali in URLs) | `rg "[^\x00-\x7F]" src/pages/[a-z]*/` excluding `pages/api/` | Per Section 20.5.1. Bangla MUST travel via `?lang=bn` query string or KV-driven 301 redirect to canonical Latin URL, not via path segment. |
| D-47 | Synonyms / colloquial mapping files (e.g. `synonyms.txt`, cross-script JSON maps) added without ARB sign-off | `rg "synonyms\.\(txt\|json\)\|cross.*script.*map" src/lib/search/` | Cross-script matching is post-launch (Section 20.5.3, Section 22.1). ARB must amend Section 34.8 before any synonym file ships. |
| D-48 | Product publish/update endpoint writes `products` but does NOT upsert into `products_fts` (or vice versa) | Static call-graph inspection of `src/api/staff/products/` writes vs. `products_fts` upserts | Tighten Section 22.1.1. Both writes MUST occur within the same transaction. `scripts/drift/search-tokenizer-drift.ts` MUST enforce this. |
| D-49 | Products with `name_bn NOT NULL` absent from `products_fts` Bangla columns | D1 query in `scripts/drift/i18n-drift.ts`: `SELECT p.id FROM products p LEFT JOIN products_fts f ON f.rowid = p.id WHERE p.name_bn IS NOT NULL AND f.name_bn IS NULL` deviation > 0 | Per Section 22.1.2. Bangla presence on `products` MUST mirror Bangla presence on `products_fts`. PIPELINE MUST block. |
| D-50 | `Locale` enum widened (e.g. `'hi'`, `'ur'`) without Section 34.8 amendment and ARB sign-off | `rg "Locale\b" src/lib/i18n/` and inspect type union | New locale codes require ARB amendment and reissue of Section 20.5 + Section 22.1. PIPELINE MUST fail. |
| D-51 | FTS5 tokenizer config differs between index insert path and customer query path | Diff the `tokenize=` / `tokenchars=` config in `scripts/drift/search-tokenizer-drift.ts` between insert and query call sites | Per Section 22.1. Same tokenizer implementation MUST be used. Asymmetric tokenization silently drops Bangla matches. |
| D-52 | Staff dashboard or checkout rendering `<html lang="bn">` for a page where no Bangla strings exist (synthetic Bangla bounce) | Render test in `tests/i18n/render-lang/`: count Bangla-only strings on a `?lang=bn` page; assert > 0 when locale active | Per Section 20.5.1. Bangla-mode pages MUST have at least one localized string otherwise the URL canonicalizes to Latin default. |

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

**Implementation completeness note:** the skeleton below shows the script structure with only 3 of the catalog checks filled in (D-01, D-02, D-04). The production script MUST implement every check present in Section 38.2's drift catalog. A script that ships with only a subset of checks silently skips the rest of the drift patterns — this is worse than not running the audit at all, because it gives false confidence.

To prevent silent drift between the prose catalog (Section 38.2) and the implemented check array, the script MUST:

1. **Parse the catalog from markdown at runtime.** The script reads `Zabir_Boutiques_Master_Plan.md` (or the file the audit is being run against), extracts every `| D-NN |` row from the Section 38.2 table, and parses the drift code, severity, and rg pattern from the prose. The expected check count is `Math.max(severity_counts)`, not a literal.
2. **Refuse to run if the catalog count and the implemented `checks` array disagree.** If `Object.keys(checksById)` length is less than the number of `D-NN` rows in the catalog, the script MUST print the diff (`missing: [D-NN, ...]`) and exit non-zero. This means adding a `D-36` to Section 38.2 forces an implementation match within the same PR — there is no way to ship catalog additions without check implementations.
3. **Carry the rg pattern and severity from the markdown so they don't drift.** Each catalog row's structure (e.g. `| D-NN | <description text> | <detection method> | <fix> |`) MUST include enough information for the script to derive the rg pattern. The example skeleton below demonstrates which fields are extracted from the prose vs. fixed in the script.

If the canonical command path is invoked with `--strict-catalog`, the script additionally verifies that the prose-derived pattern (from the markdown table) compiles against the implementation. Default behavior is `--strict-catalog` enabled.

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

