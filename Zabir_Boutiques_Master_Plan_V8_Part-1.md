# Zabir Boutiques Master Plan V8

**Canonical, Conflict-Free, Cloudflare-Native Architecture**  
**Target market:** Bangladesh F-commerce and boutique retail  
**Primary hosting budget:** Cloudflare Workers Paid plan, minimum $5/month account plan  
**Document status:** Source of truth for developers and AI coding agents  
**Version:** V8 Cloudflare Canonical Plan (supersedes V7)  
**Date:** 2026-08-07  
**Source of changes:** `Zabir_Boutiques_V7_RedTeam_Review.md` (accepted in full). Every change is listed in `V8_CHANGELOG.md`. Migrations are specified in `V8_MIGRATION_PLAN.md`, which is the standalone, authoritative form of Section 35.  
**Assumed team size:** 2–4 engineers plus the Owner. Section 34 is scoped to that team and MUST NOT be expanded beyond it without a written staffing change.

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
| Rendering model | Server-first. Catalog routes (`/`, `/products/[slug]`, `/categories/[slug]`, `/collections/[slug]`, `/blog/[slug]`) are **on-demand rendered** with Cache API + stale-while-revalidate and cache-tag purging. `prerender = true` is reserved for genuinely static legal/info routes (`/about`, `/privacy`, `/terms`, `/return-policy`, `/size-guide`). Checkout, staff, auth, payment, API, POS, and webhooks are dynamic. | Astro requires `getStaticPaths()` for prerendered dynamic routes; a boutique publishing daily stock cannot require a production rebuild to publish a product. Cache API + SWR keeps TTFB and SEO targets while making publish instant. Resolves RT-009. |
| Cart source of truth | `CartDO` is the only active cart source of truth during a session. KV must not store authoritative cart JSON. CartDO storage is **already durable** across Worker restart and DO eviction — no alarm is needed for durability. CartDO runs **exactly one alarm** with a stored `alarm_purpose` (`'persist'` \| `'cleanup'`) whose only job is keeping the D1 `cart_activity` projection fresh and eventually deleting the object. | A Durable Object has exactly one alarm; `setAlarm()` overwrites any pending alarm. Corrects the false durability rationale in V7 (RT-006, C-02). |
| Reservation window | `orders.reservation_expires_at` governs every reservation attached to an order. It MUST be `payment_expiry + 15 minutes` (60 minutes total from order creation), which is strictly longer than the 30-minute payment window in Section 11.6. The cleanup cron MUST NOT release a reservation whose order is alive. | Prevents the oversell path where stock is released while the customer is still paying (RT-001, F-02). |
| Stock entry and exit | Sales only ever increment `sold`. `stock` changes only through `VariantInventoryDO.adjustStock()`. There is no other legal path to change `stock`, in any channel, including returns, goods receipt, stocktake, damage, and correction. | Returns and opening stock were architecturally impossible in V7 (RT-003, F-04). |
| Buy Now session binding | The Buy Now session is bound to an `HttpOnly; Secure; SameSite=Lax` cookie secret, never to `Origin` or `User-Agent`. `sid` MUST NOT appear in any URL. The `Origin` check applies to state-changing POSTs only. | Browsers do not send `Origin` on top-level GET navigation; the V7 rule returned 403 on the first page load of the primary conversion path (RT-005, S-02). |
| AI budget object ID | `BudgetCounterDO` object ID is `budget:{provider}` and nothing else. One object holds both the daily and the monthly bucket. | Three competing ID formats in V7 meant the budget was never actually enforced (C-04, C-05). |
| Payment event idempotency | `payment_events` carries `UNIQUE(provider, provider_event_id)`. A replayed webhook MUST fail the insert, not create a second credit. | Direct double-credit path in V7 (F-01). |
| Migration numbering | Migration numbers are the real next free numbers in `db/migrations/`. The repository is at `0033`; V8 migrations start at `0034`. Every migration file contains **exactly one statement**. There is no "plan number to repo number" mapping. | D1 migrations are not transactional and CI gate 35.4 #6 requires exact monotonic numbering (RT-010, M-01, M-04). |
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

Zabir Boutiques is a Cloudflare-native **ecommerce, POS, and light-operations platform** for the Bangladesh boutique/F-commerce market. It is **not** an ERP today and MUST NOT be described as one: there is no general ledger, no double-entry journal, no cost of goods sold or inventory valuation, no procurement approval chain, and no accounting export. Section 8 of the red-team review classifies each gap; the classification is reproduced verbatim in Section 29.4. A finance module that would earn the ERP label is a Phase 4 candidate and is not in scope for launch — see **DECISION REQUIRED (D-05)** in Section 29.4.

It supports public ecommerce, guest checkout, Buy Now direct guest orders, COD-first selling, partial prepayment, online payment, staff-assisted orders, in-store POS receipts, inventory control, fraud review, order lifecycle management, return/refund operations, SEO, image optimization, email notifications, and AI-assisted catalog work.

The platform is designed around four priorities:

1. **No overselling.** Stock mutations must pass through Durable Objects.
2. **No client-side price trust.** The browser never decides price, delivery fee, discount, advance, balance, or stock.
3. **Fast mobile-first pages.** Catalog pages are on-demand rendered and cached at the edge with Cache API + SWR and tag-based purging. Only static legal/info pages are prerendered.
4. **Low operational cost.** The default build targets Cloudflare Workers Paid at the $5/month minimum, with D1, R2, KV, Durable Objects, Queues, Workers AI, Cron Triggers, and Pages used carefully.

The project uses **Astro 6 + React 19 Islands + Tailwind CSS + Cloudflare adapter**. Server-first rendering with selective prerendering provides speed for public pages. Dynamic on-demand routes handle checkout, cart validation, staff dashboard, POS, payments, webhooks, inventory mutation, authentication, and admin APIs.

---

## 2. Platform and Cost Strategy

### 2.1 Primary Platform

| Layer | Canonical Choice |
|---|---|
| Hosting | Cloudflare Pages + Workers/Pages Functions |
| Framework | Astro 6 |
| Rendering | `output: 'server'` (universal). All routes are dynamic by default. Only static legal/info pages opt in with `export const prerender = true` (Section 3.3). `output: 'static'` is FORBIDDEN anywhere in the project. |
| UI | React 19 Islands + Tailwind CSS |
| Database | Cloudflare D1 |
| Object storage | Cloudflare R2 |
| Strong consistency | Durable Objects |
| Async jobs | Cloudflare Queues |
| Scheduled jobs | Cloudflare Cron Triggers |
| Sessions/flags/redirects | Workers KV, only for stale-tolerant data |
| AI | Workers AI first; DeepSeek fallback only when needed |
| Email | Resend default transactional provider; Cloudflare Email Routing for inbound only. **Cloudflare Email Sending is NOT an approved outbound provider** until its general availability for arbitrary transactional recipients is verified in writing — see **DECISION REQUIRED (D-02)** in Section 17.1 (CF-09). Until then the `cloudflare_email` adapter folder MUST NOT be treated as a working fallback. |
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

#### Cost Model (mandatory, CF-07)

"$5/month" is a design constraint only if it is modelled. The assumptions below are the canonical launch volume. Any design change that moves a per-unit driver by more than 2x MUST update this table in the same PR.

| Driver | Launch assumption | Per-unit cost driver | Control |
|---|---:|---|---|
| Orders/day | 100 | 1 IdempotencyDO (24h retention), 1–4 VariantInventoryDO calls, 1 D1 batch | IdempotencyDO retention reduced from 24h to **2h** after replay window closes |
| Carts/day | 800 | 1 CartDO + 1 alarm wakeup at end of life (single alarm, no re-arm loop) | Guardrail #45: one alarm per DO; `'persist'` MUST NOT re-arm itself |
| Buy Now sessions/day | 400 | 1 DirectCheckoutSessionDO, 30-min alarm | Deleted on order success |
| Page views/day | 20,000 | Cache API hit ratio target ≥ 90% on catalog routes | Cache tags + SWR |
| `/api/stock/[variant_id]` calls/day | ≤ 5,000 | 1 DO read per call | See Section 3.4: the endpoint is cached for 10s at the edge, returns a coarse availability band (`in_stock` \| `low` \| `out`), never an exact count, and is rate-limited per session |
| Queue operations/month | ≤ 1.5M | 7 queues, `cart-activity` dominates | `cart-activity` publishes at most once per 5 seconds per cart (coalesced) |
| Analytics Engine data points/day | ≤ 50,000 | 1 per request sampled at 25% for read paths | Sampling rate is a feature flag |

Exact stock counts MUST NOT be exposed publicly. `/api/stock/[variant_id]` returns a band, not a number — this closes both the inventory-enumeration leak and the DO cost-amplification vector identified in CF-07.

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

Only genuinely static legal/info routes opt in with:

```ts
export const prerender = true;
```

The complete prerendered set is exactly these five routes:

- `/about`
- `/privacy`
- `/terms`
- `/return-policy`
- `/size-guide`

**Catalog routes MUST NOT be prerendered** (RT-009). `/`, `/products/[slug]`, `/categories/[slug]`, `/collections/[slug]`, and `/blog/[slug]` are on-demand rendered. Astro requires `getStaticPaths()` for a prerendered dynamic route; a slug published after the last build would 404, and no cache purge can reveal a page that was never built. Publishing a product MUST NOT require a deploy.

Catalog rendering contract:

- Render on demand from D1, then write the response into the Cache API keyed by URL, with `Cache-Control: public, max-age=0, s-maxage=3600, stale-while-revalidate=86400` for product pages (see Section 19.1 for the full TTL table).
- Attach cache tags (`product-{id}`, `category-{id}`, `homepage`) per Section 19.2.
- On product publish, price change, or availability-band transition, purge the matching tag. The next request re-renders from D1.
- Publish SLA: **≤ 60 seconds** from staff save to the public URL serving the new content. This is testable (Section 37, `catalog-publish-latency.test.ts`).
- Live availability is fetched client-side from `/api/stock/[variant_id]`, which returns a band (`in_stock` | `low` | `out`), never an exact count. Checkout still validates stock server-side.

### 3.4 Dynamic Route Table

With `output: 'server'` as the universal default, **dynamic routes require NO flag** — they are dynamic automatically. **Only the five static legal/info routes opt in** with `export const prerender = true` at the top of the route file.

| Route | Type | Rendering | Flag | Reason |
|---|---|---|---|---|
| `/` | Page | On-demand + Cache API/SWR | (no flag) | Marketing homepage; purged by `homepage` cache tag |
| `/products/[slug]` | Page | On-demand + Cache API/SWR | (no flag) | Publishing must not need a deploy; purged by `product-{id}` tag |
| `/categories/[slug]` | Page | On-demand + Cache API/SWR | (no flag) | Purged by `category-{id}` tag |
| `/collections/[slug]` | Page | On-demand + Cache API/SWR | (no flag) | Purged by `category-{id}` tag |
| `/blog/[slug]` | Page | On-demand + Cache API/SWR | (no flag) | Editorial content, purged on publish |
| `/about`, `/privacy`, `/terms`, `/return-policy`, `/size-guide` | Page | Static | `prerender = true` | Legal/info pages; content lives in the repo, changes only by deploy |
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
| `/api/stock/[variant_id]` | API | Dynamic | (no flag) | Live availability **band** only (`in_stock` \| `low` \| `out`); never an exact count. Edge-cached 10s. Rate limited per session per Section 18.4. |
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
| Product metadata | D1 | Cache API entries, purged by tag | D1 is canonical. Catalog HTML is a cache entry, not a build artifact (Section 3.3). |
| VAT rate | D1 `tax_rates` (effective-dated) | None | Read inside the same read as pricing. NOT KV, NOT a secret (C-09). |
| Courier COD cash | D1 `courier_shipments` + `courier_cod_remittance` | None | Records what the courier collected and what it still owes the shop (F-03). |
| Settled payment amounts | D1 `payment_transactions` | `payment_events` (event log) | `payment_events` is an append-only log of provider events; `payment_transactions` is the ledger of money actually settled per order (F-03). |
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
| AI budget | BudgetCounterDO | D1 `ai_budget_limits` table | DO enforces counters; D1 is the durable source of truth for configured limits (per migration 0026 / Section 24.2). |
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
   - compatibility view: `variants` — **read-only**. SQLite views cannot be written to; any code path that writes to `variants` fails at runtime. It exists because this is an existing production system (migrations are already at `0033`), and older code referenced `variants` before the table was renamed to `product_variants`. New code MUST target `product_variants`. The view is scheduled for deletion once no reference remains (CF-12).

2. Cart and checkout
   - `cart_activity` — MUST carry `cart_version INTEGER NOT NULL DEFAULT 0` (CF-04)
   - `direct_checkout_activity`
   - `coupons`
   - `coupon_redemptions` — MUST carry `UNIQUE(coupon_id, order_id)` (RT-007)
   - `idempotency_keys`
   - `stock_reservations` — MUST carry `checkout_id TEXT` and `expires_at TEXT NOT NULL` (RT-002)

3. Orders
   - `orders` — MUST carry `reservation_expires_at`, `payment_status`, `created_by_staff_id`, `staff_override`, `fraud_score`, `fraud_source`
   - `order_items`
   - `order_status_events`
   - `payment_events` — MUST carry `provider`, `provider_event_id`, and `UNIQUE(provider, provider_event_id)` (F-01)
   - `payment_transactions` — ledger of amounts actually settled per order (F-03)
   - `returns` — MUST carry `restocked_at` (C-06)
   - `return_items`
   - `refunds`
   - `courier_shipments`, `courier_cod_remittance` — COD cash collected by the courier and owed to the shop (F-03)
   - `tax_rates` — effective-dated VAT (C-09, F-06)

4. POS ledger
   - `invoices` — the invoice serial column is `receipt_no` and is `UNIQUE` (RT-008)
   - `invoice_items`
   - `invoice_payments`
   - `invoice_audit`
   - `pos_cash_drawer_sessions` — end-of-day close and Z-report (F-09)
   - `daily_invoice_counters` — **advisory mirror only**. The authoritative serial generator is `InvoiceCounterDO` (Section 15.5). No code may read-modify-write this table to obtain a serial.

5. Staff and security
   - `staff_users`
   - `staff_roles`
   - `staff_permissions`
   - `staff_sessions`
   - `audit_log`
   - `csrf_nonces`
   - `otp_secrets` — Owner TOTP 2FA secrets (encrypted at rest, one active row per Owner, supports backup codes). Required by Section 18.1 ("Owner role requires TOTP 2FA") and previously missing.
   - `api_audit_logs` — External API audit trail and `ProviderHealthDO` circuit breaker state transitions. One row per external call (FraudBD, UddoktaPay, SSLCommerz, DeepSeek, Imagify, email, courier). Indexed by `provider`, `operation`, `circuit_state`, `created_at`. Required by Sections 2.4 / 2.5 / 11.2 and previously missing.

6. Operations
   - `email_log`
   - `stock_adjustments` — written by **every** `adjustStock()` and `reverseDirectSale()` call (RT-003)
   - `suppliers`, `purchase_orders`, `goods_receipts` — the supply-chain path that brings stock into the system (RT-003, Section 8 of the review)
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

#### V8 Schema Additions (SQLite syntax)

Each block below is delivered by exactly one single-statement migration. The migration number is named in `V8_MIGRATION_PLAN.md` and repeated in the changelog schema diff.

```sql
-- tax_rates: effective-dated VAT. Replaces the KV/secret VAT rate (C-09).
-- Historical invoices are recomputable because the rate that applied on a date is stored.
CREATE TABLE tax_rates (
  tax_rate_id TEXT PRIMARY KEY,
  rate_percent INTEGER NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  applies_to TEXT NOT NULL CHECK (applies_to IN ('goods','delivery')),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL
);
```

```sql
-- payment_transactions: ledger of money actually settled per order (F-03).
-- payment_events stays an append-only provider event log; this is the money ledger.
CREATE TABLE payment_transactions (
  transaction_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('capture','refund','cod_collection','cod_remittance')),
  provider TEXT NOT NULL,
  provider_reference TEXT,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  settled_at TEXT NOT NULL,
  recorded_by_staff_id TEXT REFERENCES staff_users(id),
  created_at TEXT NOT NULL
);
```

```sql
-- courier_shipments: one row per handed-off parcel.
CREATE TABLE courier_shipments (
  shipment_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  courier TEXT NOT NULL CHECK (courier IN ('pathao','steadfast','redx','manual')),
  tracking_ref TEXT,
  cod_amount_paisa INTEGER NOT NULL DEFAULT 0 CHECK (cod_amount_paisa >= 0),
  cod_collected_paisa INTEGER NOT NULL DEFAULT 0 CHECK (cod_collected_paisa >= 0),
  handed_off_at TEXT NOT NULL,
  delivered_at TEXT,
  created_at TEXT NOT NULL
);
```

```sql
-- courier_cod_remittance: what the courier has actually paid back to the shop (F-03).
CREATE TABLE courier_cod_remittance (
  remittance_id TEXT PRIMARY KEY,
  courier TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  expected_paisa INTEGER NOT NULL CHECK (expected_paisa >= 0),
  received_paisa INTEGER NOT NULL CHECK (received_paisa >= 0),
  reconciled_by_staff_id TEXT REFERENCES staff_users(id),
  reconciled_at TEXT,
  created_at TEXT NOT NULL
);
```

```sql
-- pos_cash_drawer_sessions: end-of-day close / Z-report (F-09).
CREATE TABLE pos_cash_drawer_sessions (
  drawer_session_id TEXT PRIMARY KEY,
  opened_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  opened_at TEXT NOT NULL,
  opening_float_paisa INTEGER NOT NULL CHECK (opening_float_paisa >= 0),
  closed_by_staff_id TEXT REFERENCES staff_users(id),
  closed_at TEXT,
  expected_cash_paisa INTEGER,
  counted_cash_paisa INTEGER,
  variance_paisa INTEGER,
  notes TEXT
);
```

```sql
-- suppliers / purchase_orders / goods_receipts: the legal way stock enters the system.
CREATE TABLE suppliers (
  supplier_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL
);
```

```sql
CREATE TABLE purchase_orders (
  purchase_order_id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(supplier_id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('draft','ordered','received','cancelled')),
  total_cost_paisa INTEGER NOT NULL DEFAULT 0 CHECK (total_cost_paisa >= 0),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

```sql
CREATE TABLE goods_receipts (
  goods_receipt_id TEXT PRIMARY KEY,
  purchase_order_id TEXT REFERENCES purchase_orders(purchase_order_id) ON DELETE RESTRICT,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_paisa INTEGER NOT NULL CHECK (unit_cost_paisa >= 0),
  adjustment_id TEXT NOT NULL,          -- the adjustStock() idempotency key that applied it
  received_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  received_at TEXT NOT NULL
);
```

#### Mandatory Constraints (V8)

Guardrail #32 previously named only the reservation index. The complete set of D1 constraints that CI MUST prove with invalid-insert tests:

| Constraint | Table | Purpose | Finding |
|---|---|---|---|
| `UNIQUE(provider, provider_event_id)` | `payment_events` | Webhook replay cannot double-credit | F-01 |
| `UNIQUE(coupon_id, order_id)` | `coupon_redemptions` | One redemption per coupon per order | RT-007 |
| `UNIQUE` partial on `(order_id, variant_id) WHERE status='active' AND order_id IS NOT NULL` | `stock_reservations` | One active reservation per order per variant | RT-002 |
| `UNIQUE` partial on `(checkout_id, variant_id) WHERE status='active'` | `stock_reservations` | Retry guard before an order exists | RT-002 |
| `UNIQUE` on `receipt_no` | `invoices` | Sequential, non-duplicated tax serial | RT-008 |
| `CHECK (quantity > 0)` + `NOT NULL` | `order_items`, `stock_reservations` | No zero/negative line quantities | Section 4 of the review |
| `CHECK (total_paisa >= 0)` | `orders` | Money is never negative | Section 4 |
| `CHECK (advance_paisa <= total_paisa)` | `orders` | Advance cannot exceed the order | Section 4 |
| `CHECK (advance_paisa + balance_paisa = total_paisa)` | `orders` | The split always reconciles | Section 4 |
| `CHECK (status IN (...))` | `orders` | The Section 13.1 state machine is enforced by the database, not only by prose | Section 4 |
| `CHECK (payment_status IN ('unpaid','partially_paid','paid','refunded','partially_refunded'))` | `orders` | Payment state is orthogonal to fulfilment state | F-05 |

The refund cap `SUM(refunds.refund_paisa) <= orders.advance_paisa` cannot be expressed as a SQLite `CHECK` across tables. It is enforced by an `AFTER INSERT` trigger on `refunds` that raises `ABORT`, and by the refund service before it writes. Both paths MUST exist; the trigger is the backstop.

```sql
CREATE TRIGGER trg_refund_cap
AFTER INSERT ON refunds
FOR EACH ROW
WHEN (
  SELECT COALESCE(SUM(r.refund_paisa), 0) FROM refunds r WHERE r.order_id = NEW.order_id
) > (
  SELECT o.advance_paisa FROM orders o WHERE o.id = NEW.order_id
)
BEGIN
  SELECT RAISE(ABORT, 'refund_exceeds_advance');
END;
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
- `cart_version INTEGER NOT NULL DEFAULT 0` — the CartDO version that produced this row. Required to make the dual-writer upsert monotonic (CF-04).
- `updated_at TEXT NOT NULL`

Both writers (the alarm handler and the `cart-activity` queue consumer) MUST carry `cart_version` and MUST use a version-conditional upsert. Queues deliver at least once and do not guarantee order; without this, a retried older message overwrites a newer row and `last_cart_update_at` moves backwards, which can send a reminder to an active shopper.

```sql
INSERT INTO cart_activity (
  session_id, customer_phone, customer_email, customer_name,
  item_count, total_quantity, subtotal_paisa,
  last_cart_update_at, cart_version, updated_at
)
VALUES (:session_id, :phone, :email, :name, :item_count, :qty, :subtotal,
        :last_cart_update_at, :cart_version, datetime('now'))
ON CONFLICT(session_id) DO UPDATE SET
  customer_phone      = excluded.customer_phone,
  customer_email      = excluded.customer_email,
  customer_name       = excluded.customer_name,
  item_count          = excluded.item_count,
  total_quantity      = excluded.total_quantity,
  subtotal_paisa      = excluded.subtotal_paisa,
  last_cart_update_at = excluded.last_cart_update_at,
  cart_version        = excluded.cart_version,
  updated_at          = datetime('now')
WHERE excluded.cart_version > cart_activity.cart_version;
```

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
   - **Alarm-based projection refresh:** On every mutation, CartDO arms its single alarm with purpose `'persist'` and a 5-minute delay. If no further mutation arrives within 5 minutes, the alarm fires, CartDO upserts its current state to D1 `cart_activity`, and then **hands off to purpose `'cleanup'`** (30 days). It MUST NOT re-arm `'persist'`.
   - **`cart-activity` queue (batching optimization):** After each mutation, CartDO also publishes a lightweight message to the `cart-activity` queue, coalesced to at most one message per 5 seconds per cart. The queue consumer batches these and upserts D1 with the version-conditional statement above.

**Corrected rationale (C-02, RT-006).** Durable Object transactional storage is already durable across Worker restart and DO eviction. The alarm does **not** provide durability and MUST NOT be described as doing so. The alarm exists for exactly one reason: to keep the D1 `cart_activity` projection fresh enough for the abandoned-cart cron even when the `cart-activity` queue consumer is backed up. Implementers MUST NOT duplicate cart state into KV or D1 for safety — Guardrail #7 forbids it and it is unnecessary.

Checkout must never trust `cart_activity` for active cart content — it must always read from CartDO, using `getCartForCheckout()` (Section 36.6), which returns the cart together with the `cart_version` that checkout MUST re-assert before reserving stock.

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
| `BudgetCounterDO` | `budget:{provider}` | AI/expensive-operation budget enforcement. **One object per provider**, holding both the daily and the monthly bucket. This is the only permitted format document-wide (C-04, C-05). |
| `ProviderHealthDO` | `provider:{name}` | Circuit breaker and health state for external APIs |
| `InvoiceCounterDO` | `invoice-counter:{YYYYMMDD}` | Serializes the daily POS invoice serial. The only legal source of `invoices.receipt_no` (RT-008). |

Each DO must expose clear command methods and return deterministic error codes.

**One alarm per Durable Object (mandatory, RT-006 / CF-01).** A Durable Object has exactly one alarm; `setAlarm()` overwrites any pending alarm. A DO that needs more than one deadline MUST store an `alarm_purpose` value in DO storage and branch on it in `alarm()`. No DO may be designed as if two alarms could coexist. `ProviderHealthDO` has a single purpose (`open → half_open`) and MUST stay that way.

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
| `CartDO` | 5-minute inactivity projection refresh; 30-day total inactivity cleanup | **One alarm, two purposes.** DO storage holds `alarm_purpose`. Every mutation calls `armAlarm('persist')` (now + 5 min), which supersedes any pending `'cleanup'`. When `'persist'` fires: upsert `cart_activity`, then `armAlarm('cleanup')` (now + 30 days). It MUST NOT re-arm `'persist'`. When `'cleanup'` fires: final `cart_activity` write, then `deleteAll()`. |
| `InvoiceCounterDO` | End of the UTC day + 48h grace | Single alarm; on fire, `deleteAll()`. The serial for a past day is never re-issued because a new day uses a new object ID. |
| `stock_reservations` cleanup | N/A — D1 row, not a DO | Hourly cron per Section 12.3, NOT a DO alarm. The `VariantInventoryDO` itself does not expire; only its reservation records do. |

Implementation rule:

```ts
// src/durable-objects/cart-do.ts — canonical single-alarm pattern (RT-006)
type AlarmPurpose = 'persist' | 'cleanup';

async armAlarm(purpose: AlarmPurpose): Promise<void> {
  const delayMs = purpose === 'persist' ? 5 * 60_000 : 30 * 24 * 3600_000;
  await this.ctx.storage.put('alarm_purpose', purpose);
  await this.ctx.storage.setAlarm(Date.now() + delayMs);
}

async alarm(): Promise<void> {
  const purpose = await this.ctx.storage.get<AlarmPurpose>('alarm_purpose');
  if (purpose === 'persist') {
    await this.upsertCartActivity();
    // Do NOT re-arm 'persist'. Hand off to the long cleanup timer.
    await this.armAlarm('cleanup');
    return;
  }
  // 'cleanup': final projection write, then delete.
  await this.upsertCartActivity();
  await this.ctx.storage.deleteAll();
}
```

For single-purpose short-lived objects (`DirectCheckoutSessionDO`, `IdempotencyDO`, `InvoiceCounterDO`) the pattern stays simple, but the purpose is still stored so the handler is explicit:

```ts
// Single-purpose expiry, e.g. DirectCheckoutSessionDO
await this.ctx.storage.put('alarm_purpose', 'expire');
await this.ctx.storage.setAlarm(Date.now() + ttlMs);

async alarm(): Promise<void> {
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
- **Single-alarm projection refresh (mandatory):** On every mutation, CartDO calls `armAlarm('persist')` (now + 5 minutes), which supersedes any pending `'cleanup'` alarm. When `'persist'` fires it upserts `cart_activity` and hands off to `armAlarm('cleanup')` (now + 30 days). It MUST NOT re-arm `'persist'` — that would wake an abandoned cart every 5 minutes forever and destroy the cost posture in Section 2.2. CartDO storage is already durable across restart and eviction; the alarm is about projection freshness, not durability (RT-006, C-02).
- Return cart version number to prevent stale client overwrite.
- Expose `getCartForCheckout({ session_id })`, which returns the cart plus the `cart_version` observed. Checkout MUST pass that version back on reservation; if the cart mutated in between, checkout aborts with `409 CART_VERSION_CONFLICT` before any stock is held.

CartDO is the **only** real-time source of truth during a session. D1 `cart_activity` is a searchable projection used by the abandoned-cart cron, analytics, and staff reporting — never by checkout for active cart contents.

### 9.2 Cart Conflict Handling

Every cart mutation includes:

- `session_id`
- `cart_version`
- mutation command
- idempotency key for repeated client retries

If client version is stale, CartDO returns current cart with `409 CART_VERSION_CONFLICT`. Client must refresh local context.

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
5. Server creates a short-lived `DirectCheckoutSessionDO` object with a 30-minute alarm-based cleanup timer. It generates a `binding_secret = crypto.randomUUID()`, stores only `binding_hash = sha256(binding_secret)` in the DO, and never writes the secret anywhere else.
6. Server returns redirect URL `/buy-now/{slug}` — **with no `sid` and no other identifier in the query string** — and sets two cookies on that response:
   - `bn_sid={session_id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1800`
   - `bn_bind={binding_secret}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1800`
   A session identifier MUST NOT appear in any URL (S-02). The DO holds `form_draft` with name, phone, and address; a query-string `sid` leaks through `Referer`, browser history, and shared screenshots.
7. Landing page loads session state server-side by reading `bn_sid` and verifying `sha256(bn_bind)` against the stored `binding_hash`. A missing or mismatched cookie is treated as "no session": the page re-renders the product with a fresh Buy Now action. It MUST NOT 403 and MUST NOT delete the DO on a plain GET.
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
- `binding_hash` (SHA-256 of the `bn_bind` cookie secret — the only session binding; the secret itself is never stored)

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
| Session fixation mitigation | The session is bound to a **secret the attacker cannot supply**: `bn_bind`, an `HttpOnly; Secure; SameSite=Lax` cookie whose SHA-256 MUST equal the stored `binding_hash` on every request that reads or mutates session state. `Origin` and `User-Agent` MUST NOT be used for binding. The User-Agent hash check is **deleted** — it is a false control with a real false-positive rate (in-app browser → Chrome hand-off, WebView updates, Chrome UA reduction). |
| Origin check scope | The `Origin` header is checked on **state-changing POSTs only** (`/api/buy-now/submit`, `/api/buy-now/form-draft`), where browsers do send it. It MUST NOT be checked on `GET /buy-now/[slug]`: browsers omit `Origin` on same-origin top-level GET navigation, so a check there returns 403 on the first page load of the primary conversion path (RT-005). |
| Failure handling | A missing/failed binding on a GET renders the product page with a fresh Buy Now action — no 403, no DO deletion. A failed binding or Origin check on a POST returns `403` and does **not** delete the DO (deletion on a forged request is itself a denial-of-service primitive); the DO expires on its own 30-minute alarm. |
| Logged-in customer | Out of scope until **DECISION REQUIRED (D-01)** below is answered. No `customer_session_link` field exists in V8. |
| Lifetime | 30-minute alarm from creation. On alarm fire: if no `order_id` is set, `deleteAll()`. |
| Post-order cleanup | The DirectCheckoutSessionDO is **deleted immediately** after the order is successfully created (after D1 order write + reservation confirmation). This prevents session replay and frees DO storage. The alarm is cancelled on successful order creation. |
| Concurrent Buy Now tabs | A customer may open multiple Buy Now tabs for different products. Each tab gets its own `session_id` and its own DirectCheckoutSessionDO. They do not interfere with each other or with the customer's CartDO. |

The intent of this strict isolation is to ensure that a customer who uses Buy Now for a single-item impulse purchase does not accidentally lose or alter their carefully-built cart from earlier browsing. The two flows are independent entry points into the same secure checkout engine (Section 10.8).

> **DECISION REQUIRED (D-01):** Does the platform have customer accounts, or is it guest-only? — Options: **A)** Guest-only. Delete `CartDO.mergeCart()`, delete `customer_session_link`, and replace `/api/me/*` with a phone-OTP-gated lookup that reads `orders` by normalized phone and issues a one-time token. **B)** Customer accounts. Add a `customers` table, a customer session specification, a customer role in the Section 14.1 RBAC table, and a milestone in Section 29.
> Blocking: `CartDO.mergeCart()` (Section 36.6) cannot be implemented or deleted; `/api/me/data` export and deletion (Section 28.3) has no identity to authenticate; Section 6.1 has no `customers` table. Until this is answered, V8 treats the platform as **guest-only** for schema purposes and `mergeCart()` is marked NOT IMPLEMENTED in Section 36.6 rather than silently shipped.

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
2. Verify Turnstile for guest checkout when **pre-checkout signals** require it. Pre-checkout signals are the only inputs available at this step: Cloudflare Bot Management score, request rate for the IP/session, cart velocity for the session, and whether the normalized phone has ordered before. The FraudBD score does not exist yet — it is produced at step 12 — so it MUST NOT be referenced here (C-01). FraudBD may trigger a *second* interactive challenge at step 13, in the `41–70` band only, before reservation.
3. Normalize phone to E.164 Bangladesh format `+8801XXXXXXXXX`.
4. Load active cart from CartDO using `getCartForCheckout({ session_id })` and retain the returned `cart_version`.
5. Parse only `variant_id` and `quantity`. Ignore all browser-supplied prices/totals.
6. Load authoritative variant, product, price, and status from D1.
7. Reject inactive, unpublished, deleted, or unavailable variants.
8. Compute subtotal, delivery fee, discount, **VAT**, total, advance, and balance server-side. The VAT rule is defined once, in Section 11.7, and applies identically to POS (Section 15.2). The browser must NEVER supply VAT.
9. **Validate** the coupon only — read-only. Check active dates, usage limit remaining, minimum order, and maximum discount, and compute `discount_paisa`. **Do not write `coupon_redemptions` here** and do not decrement usage here (RT-007). Redemption happens in the same D1 batch as the order, at step 16.
10. Compute `total_quantity = SUM(quantity)`.
11. Apply the COD rules. All three MUST pass or the request returns `402 PREPAYMENT_REQUIRED`:
    a. `total_quantity <= 2` (unless a Manager/Owner staff override applies per Section 14.3).
    b. `total_paisa <= MAX_COD_VALUE_PAISA` — see **DECISION REQUIRED (D-04)** below.
    c. COD velocity: within the trailing 24 hours, the normalized phone has at most `COD_ORDERS_PER_PHONE_24H` COD orders and the address hash has at most `COD_ORDERS_PER_ADDRESS_24H` COD orders. Both counters are computed server-side from `orders` and are not derivable from anything the client controls (S-04).
12. Run FraudBD as a direct HTTP call with 1.5s timeout and circuit breaker. Skip for POS. Score handling, including the 4xx branch, is defined in Section 11.2.
13. If the FraudBD score is in the reject band (`71–100`), reject before stock reservation. If it is in the `41–70` band, issue the second interactive Turnstile challenge (step 2's deferred challenge) before reservation, then create the order as `pending_review`.
14. Reserve stock through VariantInventoryDO for each variant, passing `checkout_id`. Each reservation returns `reservation_id`. Before reserving, re-assert the `cart_version` from step 4; on mismatch return `409 CART_VERSION_CONFLICT` and reserve nothing.
15. If any variant reservation fails, release all successful prior reservations and return `409 INSUFFICIENT_STOCK`.
16. Create the D1 order using an atomic D1 batch: `orders` (including `reservation_expires_at`, `payment_status`, `fraud_score`, `fraud_source`, `created_by_staff_id` where applicable), `order_items`, `stock_reservations` (one row per variant, carrying `checkout_id` and `expires_at`), `order_status_events`, `coupon_redemptions` **if a coupon was validated at step 9**, and the coupon usage decrement. Because `batch()` is atomic, either the order and its redemption both exist or neither does.
17. If D1 order creation fails, immediately release all DO reservations and mark IdempotencyDO state as failed/released.
18. Complete IdempotencyDO with order_id and serialized response.
19. Enqueue order confirmation email.
20. Enqueue fraud-audit message for post-checkout enrichment.
21. If online payment or partial prepay is required, initiate UddoktaPay hosted payment and store transaction metadata.
22. Return order response or payment redirect payload.

> **DECISION REQUIRED (D-04):** What is the COD ceiling and the COD velocity limit? — Options: **A)** `MAX_COD_VALUE_PAISA = 500000` (BDT 5,000), `COD_ORDERS_PER_PHONE_24H = 2`, `COD_ORDERS_PER_ADDRESS_24H = 3`. **B)** Owner supplies different values based on average order value and courier COD loss history.
> Blocking: step 11b and 11c cannot be implemented without numbers. A single BDT 60,000 bridal piece at quantity 1 currently qualifies for COD while three pairs of socks do not; that is the gap S-04 identified. Until this is answered, the implementation MUST use option A's values and MUST read them from `site_settings` so the Owner can change them without a deploy.

### 11.2 FraudBD Policy

#### Scoring

| Score | Action |
|---|---|
| 0-40 | Auto-approve |
| 41-70 | Create with `pending_review`; staff must confirm before fulfillment |
| 71-100 | Reject before reservation/order creation |
| Timeout | Allow with `pending_review`; alert if timeout rate above threshold |
| **4xx response, or any outcome with no valid score** | Use fallback score `50` → `pending_review`. Record the call in `api_audit_logs` with `status = 'client_error'`. Do **not** count it toward the circuit breaker window (it is not a provider failure). Fire a P3 alert if the 4xx rate exceeds 5% over 15 minutes. This closes the undefined branch a FraudBD `429` used to produce (C-10). |

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
7. **COD is hard-blocked while the circuit is open (S-05).** An order that would have been COD returns `402 PREPAYMENT_REQUIRED` and must be prepaid or partially prepaid. `pending_review` alone is not a control while the breaker is open, because an attacker can deliberately induce 5 failures and then push COD orders through the 5-minute window repeatedly.
8. While the circuit is open, the per-phone and per-IP order rate limits are tightened to one order per phone per 10 minutes.
9. **`pending_review` MUST NOT transition to `processing` without an explicit staff action recorded in `audit_log`** (`event_type = 'pending_review_cleared'`, with `staff_id`). No queue consumer, cron, or automatic path may clear `pending_review`. The `fraud-audit` consumer may only downgrade to `confirmed` or escalate to `cancelled`; moving to `processing` is a human decision. This is Guardrail #14's enforcement point.

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
- `adjustStock({variant_id, delta, reason, reference_id?, staff_id, approved_by_staff_id, adjustment_id})` — **the only way `stock` ever changes** (RT-003). Covers return restock, goods receipt, stocktake correction, damage, theft, and correction. Writes a `stock_adjustments` row and an `audit_log` entry. Idempotent on `adjustment_id`. For a negative `delta`, `approved_by_staff_id` MUST differ from `staff_id`.
- `restoreFromSnapshot({stock, reserved, sold, snapshot_id})` — disaster-recovery only (RT-004). Overwrites the DO counters from an R2 snapshot taken alongside the D1 backup. Gated by the `DR_RESTORE_ENABLED` environment flag; refuses to run when the flag is unset. Every call writes a P1 `audit_log` entry.
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

  /**
   * Adjust total stock. The ONLY way stock enters or leaves outside of
   * sales. Writes a stock_adjustments row and an audit_log entry.
   * Idempotent on adjustment_id.
   */
  adjustStock(input: {
    variant_id: string;
    delta: number;               // positive = receive/restock, negative = write-off
    reason: 'return_restock' | 'goods_receipt' | 'stocktake'
          | 'damage' | 'theft' | 'correction';
    reference_id?: string;       // return_id, purchase_order_id, invoice_id
    staff_id: string;
    approved_by_staff_id: string; // MUST differ from staff_id for negative deltas
    adjustment_id: string;        // idempotency key
  }): Promise<{ applied: boolean; new_stock: number; adjustment_id: string }>;

  /**
   * Disaster recovery only. Overwrites the DO counters from an R2 snapshot
   * taken with the same timestamp as the D1 backup. Env-gated by
   * DR_RESTORE_ENABLED; throws RESTORE_DISABLED when the flag is unset.
   */
  restoreFromSnapshot(input: {
    stock: number;
    reserved: number;
    sold: number;
    snapshot_id: string;
  }): Promise<{ restored: boolean; snapshot_id: string }>;

  getAvailability(input: { variant_id: string }):
    Promise<{ stock: number; reserved: number; sold: number; available: number }>;
}
```

#### Stock Arithmetic (canonical, F-04)

There is exactly one arithmetic across every channel:

| Operation | `stock` | `reserved` | `sold` |
|---|---|---|---|
| `reserve()` | unchanged | +qty | unchanged |
| `release()` | unchanged | −qty | unchanged |
| `confirm()` | unchanged | −qty | +qty |
| `directSale()` (POS) | **unchanged** | unchanged | **+qty** |
| `reverseDirectSale()` | unchanged | unchanged | −qty |
| `adjustStock(+delta)` | +delta | unchanged | unchanged |
| `adjustStock(−delta)` | −delta | unchanged | unchanged |

`stock` means "total units ever received, less units removed by an explicit adjustment". Sales never touch it. `directSale()` increments `sold` exactly like an online confirmation does — POS and online use the same arithmetic on the same object, which is the point of routing both through `VariantInventoryDO`.

#### Checkout Rollback Triggers

Checkout must release reservations immediately on:

- D1 write failure.
- Payment initiation failure before order is valid.
- Multi-variant partial failure.
- Idempotency collision failure.
- Cart version conflict detected at step 14.
- Worker exception caught after reservation.

**Coupon rollback (RT-007).** Coupon redemption is written inside the same D1 batch as the order (step 16), so a failed order cannot consume a coupon. As a defensive backstop, if the batch is reported as applied but post-write verification fails, the rollback path MUST delete the `coupon_redemptions` row for `(coupon_id, order_id)` and restore the usage counter, and MUST log `event_type = 'coupon_rollback'`. The `UNIQUE(coupon_id, order_id)` constraint makes this operation exactly-once.

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
3. Insert into `payment_events` with `(provider, provider_event_id)`. The `UNIQUE(provider, provider_event_id)` constraint is the idempotency mechanism (F-01): if the insert fails with a uniqueness violation, this is a replay — return 200 and stop. Do **not** enqueue. "Store idempotently" is not a behaviour a developer can implement; the constraint is.
4. Enqueue to `payment-webhooks` queue.
5. Return 200 quickly to provider.
6. Queue consumer verifies provider status server-to-server.
7. Write a `payment_transactions` row for the amount actually settled, then set `orders.payment_status` (`unpaid` → `partially_paid` → `paid`).
8. Payment success does **not** move the fulfilment state machine on its own. See Section 13.1: `payment_status` is orthogonal to `status` (F-05). A fully paid order with `fraud_score <= 40` auto-transitions `created → confirmed`; anything else waits for staff.
9. Enqueue payment confirmation email.

### 11.6 Payment Reconciliation

Cron every 15 minutes:

- Query pending payment orders older than 30 minutes.
- Call UddoktaPay/SSLCommerz status API.
- Update D1 if provider confirms payment.
- Cancel the order and release its reservations only when `orders.reservation_expires_at < datetime('now')`.
- Alert if provider confirms payment but local event was missed.

#### Payment Window vs Reservation Window (canonical, F-02)

| Window | Value | Anchored on |
|---|---:|---|
| Payment window | 30 minutes | `orders.created_at` — the reconciliation cron does not even look at an order until it is 30 minutes old |
| Reservation grace | 15 minutes | after the payment window closes |
| `orders.reservation_expires_at` | **`created_at + 60 minutes`** | written in the same D1 batch that creates the order |

`reservation_expires_at` (60 min) is strictly greater than the payment window (30 min) plus the reconciliation tick interval (15 min), so a reservation can never expire while the reconciliation cron still considers the payment live. Orders in `pending_review` use the same 60-minute value; if staff have not acted by then, the order is cancelled by the reconciliation cron and the stock is released through the normal path. There is no code path that releases a reservation belonging to an order that is still alive.

This value is mechanically checkable: `reservation-window-outlasts-payment.test.ts` asserts `reservation_expires_at - created_at > payment_window + reconcile_interval` for every order-creation path.

### 11.7 VAT Computation (canonical)

The VAT rule is defined here once and mirrored nowhere. Section 15.2 (POS) references this section rather than restating it.

1. **Rate source.** The rate is read from the D1 `tax_rates` table for the row where `applies_to = 'goods'` and `effective_from <= now < COALESCE(effective_to, '9999-12-31')`, in the same read as pricing (C-09). It is **not** a Cloudflare secret and **not** a KV feature flag — KV is eventually consistent and two orders seconds apart could otherwise carry different VAT on a legally binding invoice. `VAT_RATE_PERCENT` is retired as a configuration source.
2. **Taxable base.** `taxable_base_paisa = subtotal_paisa - discount_paisa` (F-06). VAT is charged on the discounted consideration, not on the pre-discount subtotal.
3. **Delivery.** Delivery is taxed only if a `tax_rates` row exists with `applies_to = 'delivery'`. See **DECISION REQUIRED (D-03)**.
4. **Rounding.** `vat_paisa = floor(taxable_base_paisa * rate_percent / 100 + 0.5)` — half-up, integer arithmetic only, no floats.
5. **Per-line allocation.** `order_items.vat_paisa` is allocated by the **largest-remainder method** so the line values sum exactly to `orders.vat_paisa`: compute each line's exact share, take the floor, then distribute the remaining paisa one at a time to the lines with the largest fractional remainders, breaking ties by ascending `order_item_id`. `SUM(order_items.vat_paisa) = orders.vat_paisa` is an invariant, asserted by `vat-discount-rounding.test.ts`.
6. **The browser never supplies VAT.** The checkout request body is parsed with a `.strict()` schema that rejects unknown keys, so a client-supplied `vat_paisa` is a validation error, not a silently ignored field.

> **DECISION REQUIRED (D-03):** Is delivery subject to VAT for this business? — Options: **A)** Delivery is not taxed; seed only the `applies_to = 'goods'` row. **B)** Delivery is taxed at the same rate; seed both rows.
> Blocking: the `tax_rates` seed migration and step 3 above. Until this is answered, only the `goods` row is seeded and delivery is untaxed. This is a tax-filing question, not an engineering one, and MUST be confirmed by the Owner with the VAT consultant before VAT is switched on.

---

## 12. Inventory and Stock Control

### 12.1 Inventory Model

Inventory is tracked at variant level.

Formula:

```txt
available = stock - reserved - sold
```

Definitions:

- `stock`: total units received, less units removed by an explicit `adjustStock()` call. **Sales never change `stock`** (F-04).
- `reserved`: units held by an active checkout reservation.
- `sold`: units confirmed sold, through either `confirm()` (online) or `directSale()` (POS). Both channels use the same arithmetic — see the table in Section 11.3.
- `available`: computed value exposed to display/API as a band, never as an exact count on public endpoints (Section 2.2).

### 12.2 VariantInventoryDO Rules

- One DO object per variant.
- Reservation commands are processed sequentially.
- DO checks current available stock before reserve.
- DO stores reservation IDs with expiry timestamp.
- DO updates D1 after successful reservation/release/confirm through a controlled gateway.
- Any D1 mismatch triggers a reconciliation alert.

**DO↔D1 divergence is expected, not exceptional (CF-02).** D1 has no interactive transactions, and a DO mutation followed by a D1 write is two operations on this platform. They cannot be made atomic. The plan therefore defines the repair path, not only the alert:

| Divergence | Detection | Repair |
|---|---|---|
| DO holds a reservation, no `stock_reservations` row exists | Daily reconciliation compares `getAvailability().reserved` against `SUM(quantity)` of active D1 rows per variant | Staff call `release()` with `reason = 'orphan_repair'` from the staff inventory screen; the action is RBAC-gated on `inventory.adjust` and audit-logged |
| D1 row exists, DO has already released | Same query, opposite sign | The row is stamped `status = 'released'` with `reason = 'do_already_released'` |
| DO counters wrong after a restore | `dr-do-d1-parity` check (Section 27.3) | `restoreFromSnapshot()`, then `adjustStock(reason = 'correction')` for any residual delta, with two-person approval |

Every repair path terminates in a real DO method. V7 had none, which meant the daily digest reported a problem nobody could fix (CF-05).

### 12.3 Reservation Lifecycle

| Event | Action |
|---|---|
| Reserve success | Increment reserved and create reservation record |
| Order D1 write failure | Immediate release |
| Payment timeout | Cancel order and release |
| Staff cancel before confirmation | Release |
| Staff confirms order | Move reserved to sold |
| Reservation expires | Cleanup cron releases — only if the reservation is orphaned or its order is cancelled (see below) |
| Return approved, item resaleable | `VariantInventoryDO.adjustStock({ delta: +qty, reason: 'return_restock', reference_id: return_id, ... })` and stamp `returns.restocked_at`. Restocking is an inventory action, not an order state (C-06). |
| Return approved, item not resaleable | `adjustStock({ delta: 0 })` is not called; a `stock_adjustments` row with `reason = 'damage'` and `delta = 0` is written for the audit trail, and `returns.restocked_at` stays NULL |

#### Reservation Cleanup Cron Specification (mandatory)

The cleanup cron is a **safety net**, not the primary rollback mechanism (per Guardrail #12). Its job is to release reservations that the normal checkout flow failed to release — e.g. Worker restart mid-flight, network partition after reservation but before order write, or queue consumer crash.

| Parameter | Value |
|---|---|
| Schedule | **Hourly** (Cloudflare Cron Trigger: `0 * * * *`) |
| Eligible rows | Only reservations that are **orphaned** (no order was ever written, older than 15 minutes) or whose **order is cancelled**, or whose order's `reservation_expires_at` has passed |
| Select filter | `release_requested_at IS NULL` (not already queued for release by another path) |
| Action per row | Call `VariantInventoryDO.release({reservation_id, reason: 'cleanup_cron_expired'})` |
| Failure handling | Log to `audit_log` (`event_type = 'reservation_cleanup_failure'`); retry next hour |
| Concurrency | **Assume cron ticks can overlap.** Cloudflare Cron Triggers are not guaranteed single-instance; a delayed tick can run into the next one (CF-06). The `release_requested_at` compare-and-set stamp is the load-bearing protection, not a secondary safeguard. |

A reservation attached to a live order MUST NOT be released by this cron. That was the V7 oversell path (RT-001): a `pending_review` order created at 21:00 lost its stock at 21:15 while the shop was closed, the units were sold again, and `confirm()` was later called on a released reservation.

SQL (SQLite syntax, run inside the cron Worker):

```sql
-- migrations-independent runtime query: src/cron/reservation-cleanup.ts
-- 1. Select reservations that are safe to release.
SELECT r.id AS reservation_id, r.variant_id, r.order_id, r.quantity
FROM stock_reservations r
LEFT JOIN orders o ON o.id = r.order_id
WHERE r.status = 'active'
  AND r.release_requested_at IS NULL
  AND (
    -- orphaned: reserved but no order was ever written
    (r.order_id IS NULL AND r.created_at < datetime('now', '-15 minutes'))
    -- or the order died
    OR o.status = 'cancelled'
    -- or the order's own reservation window has closed
    OR (o.reservation_expires_at IS NOT NULL
        AND o.reservation_expires_at < datetime('now'))
  );
```

```sql
-- 2. For each row returned, stamp it BEFORE calling release(). The stamp is a
--    compare-and-set: if changes() = 0, another tick already claimed this row
--    and this worker MUST skip it without calling release().
UPDATE stock_reservations
SET release_requested_at = datetime('now'),
    status = 'release_requested',
    updated_at = datetime('now')
WHERE id = :reservation_id
  AND release_requested_at IS NULL;
```

Orders in `pending_review` and orders awaiting payment hold their reservation until `orders.reservation_expires_at`, which is 60 minutes from creation and therefore outlasts the 30-minute payment window in Section 11.6 (F-02).

#### Race Prevention Contract

Race conditions are prevented by **two** partial unique indexes at two different grains. A single index on `(order_id)` is wrong in both directions — it matches nothing during reservation (SQLite treats NULLs as distinct, and `order_id` is NULL at reserve time) and it breaks every multi-item order at the order write (RT-002).

```sql
-- One active reservation per order per variant.
-- A 3-variant order writes 3 active rows and all 3 succeed.
CREATE UNIQUE INDEX idx_stock_res_order_variant_active
  ON stock_reservations(order_id, variant_id)
  WHERE status = 'active' AND order_id IS NOT NULL;
```

```sql
-- Retry guard: one active reservation per checkout attempt per variant.
-- This is the index that actually stops double-holding on a retried checkout,
-- because checkout_id exists at reserve time and order_id does not.
CREATE UNIQUE INDEX idx_stock_res_checkout_variant_active
  ON stock_reservations(checkout_id, variant_id)
  WHERE status = 'active';
```

`stock_reservations.checkout_id` is a real column in V8. V7 passed `checkout_id` to `reserve()` but never defined the column anywhere.

What this means:

- A multi-item order writes one active row per variant. All rows share `order_id` and differ by `variant_id`, so the first index permits them.
- A retried checkout that reaches reservation twice with the same `checkout_id` fails the second insert at the second index, before any stock is double-held.
- The `release_requested_at` stamp prevents double-release between overlapping cron ticks, and it is load-bearing — cron single-instancing MUST NOT be assumed (CF-06).
- If `release()` succeeds at the DO level but the D1 stamp fails, the next run sees `reserved = 0` at the DO and marks the row stale; the reconciliation cron flags it and staff repair it through the paths in Section 12.2.

The retired index name `idx_stock_reservations_order_active` MUST NOT appear in any migration, code path, test, or audit check. It is dropped by migration 0035 and recorded in `V8_CHANGELOG.md` as a retired artifact.

The 15-minute window applies **only** to orphaned reservations with no order. Reservations attached to an order are governed by `orders.reservation_expires_at` (60 minutes). The 1-hour cron cadence means the worst-case orphan lifetime is ~1h15m and the worst-case attached-reservation lifetime is ~2h.

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
- **There is no virtual queue.** The V7 sentence "for more than 100 concurrent checkouts on same variant, enable virtual queue in VariantInventoryDO" is deleted (CF-11). It had no mechanism, no trigger, no interface method, and no code; an unenforceable requirement in a contract document is worse than no requirement. A Durable Object is single-threaded, so contention on one variant serializes naturally. The real controls are: `reserve()` MUST NOT perform a D1 round-trip inside the critical section (D1 writes are published asynchronously after the counter mutation), and a variant under contention returns `409 INSUFFICIENT_STOCK` fast rather than queueing, which keeps the 800ms checkout TTFB and 30ms Worker CPU budgets in Section 21 intact.
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
| `returned` | `refunded` | Return approval | Inventory effect is handled by `adjustStock()`, not by a state |
| `refunded` | terminal | Refund complete | Update finance log |

`restocked` is **not** a state (C-06). V7 listed it as a transition target with no matching state row, so a legitimate restock would have been rejected and logged as a security event. Restocking is an inventory action: `VariantInventoryDO.adjustStock({ reason: 'return_restock' })` plus a `returns.restocked_at` timestamp plus a `stock_adjustments` row.

Invalid transitions must be rejected and logged as security/bug events. The permitted state set is enforced by a `CHECK(status IN (...))` constraint on `orders`, not by prose alone.

#### Payment Status (orthogonal, F-05)

`orders.payment_status` is a separate field from `orders.status`. Fulfilment state and money state are independent axes; folding them together left a fully prepaid low-risk order with no automatic path out of `created`.

| `payment_status` | Meaning |
|---|---|
| `unpaid` | Nothing settled (pure COD before delivery) |
| `partially_paid` | Advance settled, balance outstanding |
| `paid` | Full amount settled |
| `partially_refunded` | Some settled money returned |
| `refunded` | All settled money returned |

Interaction rule, stated once: when `payment_status` becomes `paid` or `partially_paid` **and** `fraud_score <= 40` **and** `status = 'created'`, the order auto-transitions to `confirmed` and its reservations are confirmed (`reserved → sold`). In every other case the order stays where it is and waits for a staff action. An order in `pending_review` never auto-advances, regardless of payment (Section 11.2 step 9).

### 13.2 Return and Refund Flow

- Customer contacts support by phone, Messenger, WhatsApp, or staff channel.
- Staff creates return request with order_id, items, reason, condition, photos if needed.
- Manager/Owner approves or rejects (`returns.approve` RBAC).
- If approved and the condition allows resale, the return service calls `VariantInventoryDO.adjustStock({ variant_id, delta: +quantity, reason: 'return_restock', reference_id: return_id, staff_id, approved_by_staff_id, adjustment_id })` and stamps `returns.restocked_at`. This is the only legal restock path (RT-003); editing D1 inventory directly violates Guardrail #17.
- UddoktaPay refund is initiated for the prepaid amount. The refund service MUST check `SUM(refunds.refund_paisa) + new_refund <= orders.advance_paisa` before writing; the `trg_refund_cap` trigger in Section 6.1 is the backstop (F-03).
- Each refund writes a `payment_transactions` row with `direction = 'refund'`.
- COD-only orders require no payment refund unless store policy says otherwise.
- **Return window is enforced server-side (F-10).** The default is 7 days after `orders.delivered_at`. The return-creation endpoint MUST reject a request where `delivered_at + window < now` with `422 RETURN_WINDOW_EXPIRED`. The window value lives in `site_settings` (D1), not in a KV feature flag — KV is eventually consistent and explicitly operational-config-only (Section 6.4). An out-of-window return can be created only by a Manager or Owner holding the new `returns.override_window` permission, and the override is written to `audit_log`.

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
| returns.override_window | Yes | Yes | No | No |
| inventory.adjust | Yes | Yes | Yes | No |
| inventory.adjust.approve | Yes | Yes | No | No |
| inventory.restore_snapshot | Yes | No | No | No |
| guardrails.view | Yes | Yes | No | No |
| reports.export | Yes | Yes | No | No |
| pos.drawer.close | Yes | Yes | Yes | No |
| suppliers.manage | Yes | Yes | No | No |
| purchase_orders.manage | Yes | Yes | No | No |
| products.create | Yes | Yes | Yes | No |
| products.update | Yes | Yes | Yes | No |
| products.delete | Yes | No | No | No |
| coupons.create | Yes | No | No | No |
| coupons.deactivate | Yes | No | No | No |
| invoices.create | Yes | Yes | Yes | No |
| invoices.void | Yes | Yes | No | No |
| staff.manage | Yes | No | No | No |
| reports.view | Yes | Yes | No | Yes |

Rules that the table alone cannot express, stated so they are implementable:

- **Two-person rule.** `inventory.adjust` lets a user *propose* an adjustment; a **negative** `delta` additionally requires an approver holding `inventory.adjust.approve`, and `approved_by_staff_id` MUST differ from `staff_id`. A positive `delta` (goods receipt, return restock) may be self-approved by a holder of `inventory.adjust`.
- **Same-day POS void.** `invoices.void` is necessary but not sufficient: the void endpoint MUST also assert `date(invoices.created_at) = date('now')` server-side. "Same-day void only by Manager or Owner" (Section 15.4) is therefore two mechanical checks — permission plus date — not a policy note.
- **Guardrail dashboard.** `/staff/guardrails` requires `guardrails.view`, **not** `reports.view` (C-08). Under `reports.view` a read-only Viewer could see violation history while a Staff member could not, which inverts the trust hierarchy.
- **Report export.** Writing to the `zabir-reports` R2 bucket requires `reports.export`.
- **DR restore.** `restoreFromSnapshot()` requires `inventory.restore_snapshot` **and** the `DR_RESTORE_ENABLED` environment flag. Owner only.

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
- VAT is computed by the rule in Section 11.7 — same taxable base, same rounding mode, same per-line allocation. POS MUST NOT implement its own VAT arithmetic.
- Choose payment method: cash, card, bKash, Nagad, Rocket, bank transfer.
- Support split payments if needed.
- Optional customer name/phone.
- Issue receipt.
- Print 80mm thermal receipt.

### 15.3 POS Receipt

Route: `/api/staff/invoices/{id}/print`

Receipt must include:

- Store name and address.
- Receipt number: `ZB-INV-YYYYMMDD-NNNN`, stored in `invoices.receipt_no` and issued **only** by `InvoiceCounterDO` (Section 15.5).
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

- Same-day void only by Manager or Owner. Both checks are mechanical: RBAC `invoices.void` **and** `date(invoices.created_at) = date('now')` asserted server-side.
- Restores stock through `VariantInventoryDO.reverseDirectSale({ reason: 'same_day_void' })`. Never by editing D1.
- Writes an `invoice_audit` row.
- Does not delete the invoice. `receipt_no` is never reused — the serial stays consumed and the invoice carries a void stamp.

### 15.5 Invoice Serial Numbering (canonical, RT-008)

Bangladesh VAT (Mushak) requires sequential, non-duplicated invoice serials. Two cashiers on two tablets reading `daily_invoice_counters` and writing back would both produce the same serial; D1 has no `SELECT ... FOR UPDATE`, so a read-modify-write on a counter row is not safe under concurrency.

The serial is issued by a Durable Object, matching the pattern the plan already uses for every other serialization need:

| Property | Value |
|---|---|
| Object ID | `invoice-counter:{YYYYMMDD}` (UTC day) |
| Method | `nextInvoiceNumber(): Promise<{ receipt_no: string; seq: number }>` |
| Format | `ZB-INV-{YYYYMMDD}-{seq zero-padded to 4}` |
| Persistence | `seq` in DO storage; the DO writes an advisory row to `daily_invoice_counters` after issuing, for reporting only |
| Constraint | `invoices.receipt_no` is `UNIQUE`. The DO is the generator; the constraint is the proof. |
| Failure mode | If the D1 invoice write fails after a serial was issued, the serial is **burned**, not reused. A gap in the serial sequence is acceptable; a duplicate is not. The burned serial is recorded in `invoice_audit` with `event_type = 'serial_burned'` so the gap is explainable to an auditor. |

`pos-invoice-number-concurrency.test.ts` asserts that 20 concurrent invoice creations produce 20 distinct serials.

### 15.6 Cash Drawer Close and Z-Report (F-09)

A physical counter without an end-of-day close has no control against cashier error or theft. This is mandatory before POS goes live.

1. A cashier opens a drawer session at the start of a shift, recording `opening_float_paisa`. POS refuses to create a cash invoice with no open drawer session.
2. Every `invoice_payments` row with `method = 'cash'` is attributed to the open drawer session.
3. At close, the system computes `expected_cash_paisa = opening_float + SUM(cash in) - SUM(change out)` and the cashier enters `counted_cash_paisa`.
4. `variance_paisa = counted - expected` is stored. A non-zero variance requires a note and is included in the owner's daily digest. A variance above BDT 500 raises a P2 alert.
5. The Z-report is generated to the `zabir-reports` R2 bucket: per-payment-method totals, invoice count, void count, discount total, VAT total (the output-VAT register for the day), and the variance. It requires `reports.export`.
6. Closing a drawer session requires `pos.drawer.close`. A session left open past 24 hours raises a P3 alert.

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
2. Cloudflare Email Routing for inbound customer/support email only.
3. Manual staff notification fallback for failed transactional email.

> **DECISION REQUIRED (D-02):** Is Cloudflare Email Sending generally available for outbound transactional mail to arbitrary customer addresses on this account? — Options: **A)** Verified available: keep the `cloudflare_email` adapter as the documented second provider and test the failover. **B)** Not available (Email Routing is an inbound product and Email Workers' send capability has historically been limited to replies and verified destinations): delete the `cloudflare_email` adapter folder and add a second *real* transactional provider, because Resend is otherwise a single point of failure with no fallback.
> Blocking: the provider-order list above, the `SendResponse.provider` union type in Section 36.4, Guardrail #30, and the `src/lib/integrations/email/cloudflare_email/` folder. Until the Owner confirms in writing, `EMAIL_PROVIDER=cloudflare_email` MUST NOT be set in staging or production, and the adapter is treated as unproven scaffolding rather than a fallback. Section 17.2's "manual staff notification" is the only fallback the plan can currently guarantee.

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
--    The `AND abandoned_email_sent_at IS NULL` predicate is the compare-and-set.
--    It is NOT optional. The code MUST check changes() = 1 before enqueueing;
--    if changes() = 0, another tick already claimed this row and this worker
--    MUST NOT enqueue an email (C-03).
UPDATE cart_activity
SET abandoned_email_sent_at = datetime('now'),
    updated_at = datetime('now')
WHERE session_id = :session_id
  AND abandoned_email_sent_at IS NULL;
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

### 18.2 Staff Protection

- `/staff/*` and `/api/staff/*` protected by Cloudflare Zero Trust Access.
- RBAC middleware checks every staff API request.
- All staff data access to PII is logged in append-only `audit_log`. **Audit rows MUST store `customer_ref` as a salted hash plus the `order_id`, never raw name, phone, or address** (S-07). The audit log is append-only and retained 7 years; if it held raw PII, the deletion right in Section 28.3 would be unsatisfiable. Anonymizing the customer row is then sufficient because nothing else holds the identity.

#### Zero Trust and Cookie Sessions (CF-10)

Two mechanisms guard the same routes. How they compose is stated once, here:

| Question | Answer |
|---|---|
| Do staff authenticate twice? | Yes, and deliberately. Cloudflare Access is the network perimeter (who may reach the origin); the cookie session is the application identity (which staff user, which role, which permissions). Access identity is not a substitute for RBAC. |
| Where does the login page live? | **Outside the Access perimeter.** `/staff/login` and `/api/staff/session` are excluded from the Access policy; everything else under `/staff/*` and `/api/staff/*` is inside it. A login form behind a perimeter that requires you to be logged in is unreachable. |
| How does the POS tablet authenticate? | A Cloudflare Access **service token** bound to the shop device, plus a normal cashier cookie session. The service token satisfies the perimeter; the cookie identifies the cashier for `invoice_audit`. |
| Break-glass | An Access policy misconfiguration would take the physical shop offline. The Owner holds a break-glass procedure: a documented, time-boxed Access bypass rule for `/staff/sales/pos` and `/api/staff/invoices/*` only, activated from the Cloudflare dashboard, valid ≤ 4 hours, requiring the Owner's TOTP at application login and writing a P1 `audit_log` entry on every request served through it. The runbook lives at `docs/runbooks/access-break-glass.md`. Break-glass MUST NOT cover any other route. |

### 18.3 CSRF

One mechanism, not three (S-10). V7 specified a double-submit cookie **and** an HMAC-signed nonce **and** a `csrf_nonces` D1 table with no description of how they combine.

- **HMAC-signed double-submit token** is the single canonical mechanism. The token is `base64url(nonce || HMAC(key, nonce || session_id || issued_at))`, set as a cookie and echoed in a header on unsafe methods. It is stateless.
- The `csrf_nonces` D1 table is **retired**. Nothing reads or writes it.
- Header token required for POST, PUT, PATCH, DELETE. Never for GET.
- **Key rotation with a dual-key window.** The signing key rotates monthly. Verification accepts the current key **and** the previous key for a **24-hour overlap**; issuance always uses the current key. Without the overlap, rotation invalidates every open form (S-11). The two keys are `CSRF_SIGNING_SECRET` and `CSRF_SIGNING_SECRET_PREVIOUS`.

### 18.4 Rate Limiting

Bangladeshi mobile carriers use large-scale CGNAT: thousands of Grameenphone or Robi subscribers can share one egress IP, so a viral Facebook post throttles the store's own customers (S-08). Write paths are therefore keyed on server-derived identity, and read paths use Bot Management scores rather than raw IP counts.

| Route | Limit | Key |
|---|---|---|
| Checkout | 20/min | `session_id` + normalized phone (server-derived) |
| Login | 5/min per IP and 10/min per email | IP + email |
| Coupon apply | 5/min | **IP + normalized phone** — never `session_id`, which the client chooses and can rotate freely (S-03) |
| General API | 60/min | session; IP only as a secondary ceiling at 600/min to absorb CGNAT |
| Catalog pages | Cloudflare Bot Management score threshold, not a request count | Bot score |
| `/api/stock/[variant_id]` | 30/min | session; response is a band and is edge-cached 10s |
| Payment webhook | Signature verification is the control. The provider IP allowlist is **advisory and alert-only** — payment providers change egress IPs, and a hardcoded list silently breaks all payment confirmations (S-09). | HMAC |

### 18.5 Turnstile

- Checkout: invisible/managed based on **pre-checkout** signals only (Section 11.1 step 2), plus a second interactive challenge in the FraudBD `41–70` band.
- Staff login: managed mode.
- Coupon application: interactive challenge **after 3 failed attempts** from the same IP+phone key within 10 minutes. "After repeated failed attempts" is not implementable; three is.
- Contact forms: managed mode.

### 18.6 CSP

Minimum CSP:

```txt
default-src 'self';
script-src 'self' 'nonce-{per-request}' https://challenges.cloudflare.com;
style-src 'self' 'nonce-{per-request}';
img-src 'self' https://images.zabirboutiques.com data: blob:;
connect-src 'self' https://challenges.cloudflare.com https://api.uddoktapay.com;
frame-src https://challenges.cloudflare.com;
frame-ancestors 'none';
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
```

Changes from V7 and why (S-06):

| Change | Reason |
|---|---|
| Added `frame-ancestors 'none'` | Checkout and `/staff/*` were clickjackable |
| Added `https://challenges.cloudflare.com` to `connect-src` | The Turnstile widget makes XHR calls and would fail under the V7 policy |
| Removed `https://api.fraudbd.com` from `connect-src` | FraudBD is server-side only (Guardrail #23). Listing it was unnecessary attack surface and advertised the fraud vendor in a response header |
| Replaced `style-src 'unsafe-inline'` with a per-request nonce | `'unsafe-inline'` is a real XSS weakening and is avoidable with Tailwind's compiled output |
| `cdn.zabirboutiques.com` → `images.zabirboutiques.com` | The V7 host appeared nowhere in Section 26.1. The image host is now the R2 custom domain named in Section 26.1 |

### 18.7 Secrets

All secrets live in Cloudflare Secrets. The complete list — V7 omitted four of these while other sections required them:

| Secret | Used by | Rotation |
|---|---|---|
| `UDDOKTAPAY_API_KEY`, `UDDOKTAPAY_WEBHOOK_SECRET` | Payment adapter, webhook | Quarterly, dual-key |
| `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_WEBHOOK_SECRET` | Payment adapter, webhook | Quarterly, dual-key |
| `FRAUDBD_API_KEY` | FraudBD adapter | Quarterly |
| `RESEND_API_KEY` | Email adapter | Quarterly |
| `DEEPSEEK_API_KEY` | AI adapter | Quarterly |
| `IMAGIFY_API_KEY` | Image adapter | Annually |
| `POS_BIN`, `POS_TIN` | Receipt printing | On change by the tax authority |
| `CSRF_SIGNING_SECRET`, `CSRF_SIGNING_SECRET_PREVIOUS` | CSRF | Monthly, 24h overlap |
| `BUY_NOW_SESSION_HMAC_SECRET` | `session_id = HMAC(secret, ...)` (Section 10.6) | Quarterly, dual-key |
| `AUDIT_CUSTOMER_REF_SALT` | Salted `customer_ref` hash in `audit_log` (S-07) | **Never** — rotating it breaks the ability to link existing audit rows to a customer |

Environment variables (not secrets): `EMAIL_PROVIDER`, `DR_RESTORE_ENABLED`. `VAT_RATE_PERCENT` is **retired** — the rate now lives in the D1 `tax_rates` table (Section 11.7).

#### Rotation Procedure (S-11)

Every rotatable secret follows the same three-step procedure; none of them may be rotated by simply overwriting the value:

1. Publish the new value as `{NAME}` and move the old value to `{NAME}_PREVIOUS`.
2. Verification accepts both for the overlap window (24 hours for CSRF and webhook secrets, 1 hour for API keys where the provider supports two active keys). Signing/issuance always uses the new value.
3. After the window, delete `{NAME}_PREVIOUS` and confirm no verification failures in `api_audit_logs`.

Rotating a webhook secret without an overlap drops in-flight payment confirmations, which is a money-loss event, not an inconvenience. The runbook is `docs/runbooks/secret-rotation.md`.

Never commit `.env` secrets to Git.

---

## 19. Caching and CDN

### 19.1 Cache Strategy

| Content | Strategy | TTL | Purge |
|---|---|---|---|
| Product page | On-demand render + Cache API/SWR | `s-maxage=3600`, stale 1d | Product update, price change, availability-band transition. Purge tag `product-{id}`. |
| Category page | On-demand render + Cache API/SWR | `s-maxage=1800`, stale 2h | Category/product mapping update. Purge tag `category-{id}`. |
| Homepage | On-demand render + Cache API/SWR | `s-maxage=600`, stale 1h | Featured product update. Purge tag `homepage`. |
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

Stock changes purge the product cache only when the availability **band** changes (`in_stock` ⇄ `low` ⇄ `out`). Because catalog pages are rendered on demand, a purge is sufficient to publish: the next request re-renders from D1. There is no build step in the publish path (RT-009).

---

## 20. SEO Architecture

### 20.1 URL Rules

- Product: `/products/{slug}`.
- Category: `/categories/{slug}`.
- Blog: `/blog/{slug}`.
- No product IDs in public URLs.
- Lowercase hyphen slugs only.
- Product canonical always points to `/products/{slug}`.

### 20.2 Structured Data

| Page | Schema |
|---|---|
| Product | Product + Offer |
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

Launch search uses D1 FTS5:

- Product name.
- Description.
- Category.
- Tags.
- SKU.
- Bangla/English terms where available.

Autocomplete:

- KV prefix cache updated on product changes.
- Top 8 suggestions.
- Fallback to D1 if KV missing.

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

#### Object Keying (canonical, C-04 / C-05)

| Property | Value |
|---|---|
| Object ID | `budget:{provider}` — for example `budget:deepseek`, `budget:workers_ai`, `budget:imagify` |
| Buckets held | Both, in one object: `daily` (rolled at UTC midnight) and `monthly` (rolled at the first UTC day of the month) |
| Roll mechanism | On every call, the DO compares the stored `daily_period_key` / `monthly_period_key` against the current UTC keys and zeroes the bucket whose key has changed, before evaluating limits |
| Config | Read from D1 `ai_budget_limits` on first call after a roll, then cached in-DO |

The DO MUST NOT be keyed by period. A daily-keyed object has no visibility into the monthly total, which made the monthly limit unenforceable while `recordUsage()` claimed to return both totals from a single instance (C-05). Rolling inside one object also removes the "read config from D1 on first call per period" cold-start cost.

`budget-counter-id-format.test.ts` asserts that `canUseDeepSeek()` and `recordUsage()` resolve to the same DO instance.

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
| Persistence | Config in D1 `ai_budget_limits`; live counters in `BudgetCounterDO` (`budget:deepseek` — one object, both buckets) |

#### Staff Action Flow (canonical)

Every staff-initiated AI action that uses DeepSeek MUST follow this flow:

```ts
// 1. Pre-flight check.
//    Object ID is `budget:{provider}` and nothing else — the SAME string used by
//    recordUsage(). Three competing formats in V7 meant the pre-flight read one
//    object and the write updated another, so the budget was never enforced (C-04).
const budget = env.BUDGET_COUNTER_DO.get(env.BUDGET_COUNTER_DO.idFromName('budget:deepseek'));
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

**Correction to the V7 reasoning (CF-08).** Workers AI is **billed**, not blocked, beyond the included allocation on the Paid plan. The claim that Workers AI "has its own platform-level budget enforcement via the Cloudflare account" is false, and it made the fallback path an unmetered spend path during any DO outage. The fallback is still the right choice — blocking the staff action is worse — but it MUST be capped:

| Backstop | Rule |
|---|---|
| Local counter | Every Workers AI fallback call increments a KV counter `ai_fallback:{YYYY-MM-DD-HH}` with a 2-hour TTL, written before the call |
| Hourly cap | **50 Workers AI fallback calls per hour, account-wide.** Beyond that, the staff action returns `429 AI_FALLBACK_CAP_REACHED` with "AI is temporarily unavailable — please write the description manually." |
| Alert | Crossing the cap raises a P2 alert; a KV counter is eventually consistent, so the cap is approximate by design and is a spend ceiling, not an exact quota |

Falling back to Workers AI when `BudgetCounterDO` is unreachable is safer than blocking the staff action or allowing unlimited DeepSeek calls — but only with the cap above in place.

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

#### The `redact()` Chokepoint (mandatory, S-12)

"No PII in logs" is not enforceable as a policy. It is enforceable as a chokepoint:

- A single utility, `src/lib/observability/redact.ts`, exports `redact(value: unknown): unknown`. It masks Bangladeshi phone numbers (`+8801XXXXXXXXX` → `+88017****789`), address-shaped fields, email local parts, and anything matching known API-key shapes.
- **Every** log sink and **every** adapter's audit summary MUST route through `redact()`. Direct `console.log` / `console.error` and direct writes to the log sink are lint-banned outside `src/lib/observability/`.
- `redaction.test.ts` runs a fixture containing a real-shaped `+8801…` number, a Dhaka address, and an API key through every sink and asserts none of them appear in the output.

A 7-day staging log scan (drift code D-30) stays as a detection backstop, but it is sampling and it only fires after a leak. The chokepoint plus the lint ban is the control.

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

---See Part-2
