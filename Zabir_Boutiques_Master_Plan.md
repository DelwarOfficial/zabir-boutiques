# Zabir Boutiques Master Plan V7

**Canonical, Conflict-Free, Cloudflare-Native Architecture**  
**Target market:** Bangladesh F-commerce and boutique retail  
**Primary hosting budget:** Cloudflare Workers Paid plan, minimum $5/month account plan  
**Document status:** Source of truth for developers and AI coding agents  
**Version:** V7 Cloudflare Canonical Plan  
**Date:** June 2026

---

## 0. Non-Negotiable Canonical Decisions

Every implementation, prompt, ticket, PR, and agent instruction must follow these decisions.

| Area | Canonical Decision | Why |
|---|---|---|
| Astro output mode | Use `output: 'static'` with `@astrojs/cloudflare`; dynamic routes export `prerender = false`. Never use `output: 'hybrid'`. | Astro v6 supports `static` and `server`; old hybrid behavior is now achieved by static-first on-demand rendering. |
| Rendering model | Static-first hybrid behavior: public pages are prerendered; checkout, staff, auth, payment, API, POS, and webhooks are dynamic. | Fast SEO pages with safe server-side commerce logic. |
| Cart source of truth | `CartDO` is the only active cart source of truth. KV must not store authoritative cart JSON. | Cart requires strong consistency and concurrent tab safety. |
| Abandoned cart detection | D1 stores a searchable `cart_activity` index updated by CartDO. Cron queries D1 and enqueues emails. | Durable Objects and KV cannot be globally queried for old carts. |
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

The project uses **Astro 6 + React 19 Islands + Tailwind CSS + Cloudflare adapter**. Static-first rendering provides speed for public pages. Dynamic on-demand routes handle checkout, cart validation, staff dashboard, POS, payments, webhooks, inventory mutation, authentication, and admin APIs.

---

## 2. Platform and Cost Strategy

### 2.1 Primary Platform

| Layer | Canonical Choice |
|---|---|
| Hosting | Cloudflare Pages + Workers/Pages Functions |
| Framework | Astro 6 |
| Rendering | `output: 'static'` + route-level `export const prerender = false` |
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

Required adapter path:

```txt
src/lib/integrations/{provider}/client.ts
src/lib/integrations/{provider}/types.ts
src/lib/integrations/{provider}/errors.ts
src/lib/integrations/{provider}/mock.ts
src/lib/integrations/{provider}/index.ts
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
| FraudBD | Courier/fraud risk check for Bangladesh ecommerce orders | `FRAUDBD_API_KEY`, `FRAUDBD_BASE_URL` | Checkout service + fraud audit queue | 1.5s checkout / 3s background | 1 safe retry only outside checkout | Create order as `pending_review` when slow/unavailable |
| UddoktaPay | Primary online payment and partial prepayment | `UDDOKTAPAY_BASE_URL`, `UDDOKTAPAY_API_KEY`, `UDDOKTAPAY_WEBHOOK_SECRET` | Payment service + webhook + reconciliation cron | 10s | Verify calls retry; create charge must be idempotent | SSLCommerz fallback or pending payment retry |
| SSLCommerz | Payment fallback provider | `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_BASE_URL`, `SSLCOMMERZ_WEBHOOK_SECRET` | Payment service | 10s | Verify calls retry; create payment idempotent | Manual payment review |
| DeepSeek | Complex AI generation fallback | `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` | AI service queue/staff action | 30s foreground, longer only in queue | Retry only for transient errors | Workers AI or manual staff content |
| Workers AI | Primary low-cost AI tasks | Cloudflare binding | AI service | Platform default | No blind retry on budget failure | D1 FTS/category fallback/manual |
| Imagify | Image optimization, resize/compression, WebP/AVIF support where approved | `IMAGIFY_API_KEY`, `IMAGIFY_BASE_URL` | Image-processing queue | 30s | 2x queue retry | Keep original + browser-generated R2 variants |
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
  // Astro v6 supports static and server. Static is used to keep public pages fast.
  output: 'static',

  // Required because some pages and endpoints opt out of prerendering.
  adapter: cloudflare(),

  integrations: [react()],

  vite: {
    plugins: [tailwindcss()],
  },
});
```

### 3.2 Dynamic Route Rule

Any route that reads cookies, handles authentication, writes to D1/R2/KV/DO, checks live inventory, creates orders, verifies payments, or returns user-specific data must include:

```ts
export const prerender = false;
```

### 3.3 Static Route Rule

The following routes should remain static by default:

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

| Route | Type | Rendering | Reason |
|---|---|---|---|
| `/api/cart/*` | API | Dynamic | CartDO reads/writes |
| `/cart` | Page | Static shell + client cart island | Fast page; cart data loaded from API |
| `/checkout` | Page | Dynamic | Reads session/cart and produces server-safe checkout state |
| `/buy-now/[slug]` | Page | Dynamic | Direct guest order landing page with live product, selected variant, and order form |
| `/api/buy-now/session` | API | Dynamic | Creates short-lived direct checkout session without changing normal cart |
| `/api/buy-now/submit` | API | Dynamic | Submits direct guest order through the same secure checkout engine |
| `/api/checkout` | API | Dynamic | Order creation, stock reservation, payment initiation |
| `/api/payments/webhook` | API | Dynamic | HMAC verification and payment events |
| `/api/payments/reconcile` | API/Cron | Dynamic | Payment status checks |
| `/staff/*` | Pages | Dynamic | RBAC, live data, staff-only |
| `/api/staff/*` | API | Dynamic | Authenticated staff writes and reads |
| `/staff/sales/pos` | Page | Dynamic | Counter sales and live variants |
| `/api/staff/invoices/*` | API | Dynamic | POS invoice creation/printing/voiding |
| `/api/search` | API | Dynamic | D1 FTS/query suggestions |
| `/api/stock/[variant_id]` | API | Dynamic | Live DO/D1 stock status |
| `/api/me/*` | API | Dynamic | Personal data access/deletion |

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
| AI budget | BudgetCounterDO | KV limit config | DO enforces counters. |
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

6. Operations
   - `email_log`
   - `stock_adjustments`
   - `inventory_reconciliation_runs`
   - `ai_generation_log`
   - `backup_log`

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
- `abandoned_1h_sent_at TEXT`
- `abandoned_24h_sent_at TEXT`
- `consent_status TEXT CHECK(consent_status IN ('unknown','allowed','denied'))`
- `updated_at TEXT NOT NULL`

CartDO must not synchronously write this table on every mutation. CartDO publishes lightweight messages to the `cart-activity` queue; the queue consumer batches and upserts D1 `cart_activity`. Checkout must never trust `cart_activity` for active cart content.

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
| `CartDO` | 30 days inactivity policy | Keep active cart state; enqueue final `cart_activity` state before cleanup if implemented |

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

Cron sweeps may exist as a safety net, but the primary cleanup mechanism for short-lived DO state is the Durable Object Alarm API.

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
- Publish lightweight `cart-activity` queue message after mutation instead of blocking on D1 writes.
- Return cart version number to prevent stale client overwrite.

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

Forbidden state:

- Payment secrets.
- Final price as authority.
- Final delivery fee as authority.
- Final discount as authority.
- Permanent order data.

Prices shown on the landing page are display-only. Final submit must reload authoritative price and stock from D1/VariantInventoryDO.

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
8. Compute subtotal, delivery fee, discount, total, advance, and balance server-side.
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

### 11.2 FraudBD Policy

| Score | Action |
|---|---|
| 0-40 | Auto-approve |
| 41-70 | Create with `pending_review`; staff must confirm before fulfillment |
| 71-100 | Reject before reservation/order creation |
| Timeout | Allow with `pending_review` if circuit breaker open; alert if timeout rate above threshold |

The queue named `fraud-audit` is not a checkout blocker. It records post-checkout analysis, improves fraud logs, and can request staff review.

### 11.3 Reservation Rollback Contract

VariantInventoryDO must support:

- `reserve({variant_id, quantity, checkout_id})`
- `release({reservation_id, reason})`
- `confirm({reservation_id, order_id})`
- `directSale({variant_id, quantity, invoice_id, staff_id, channel: 'pos'})`
- `getAvailability({variant_id})`

Checkout must release reservations immediately on:

- D1 write failure.
- Payment initiation failure before order is valid.
- Multi-variant partial failure.
- Idempotency collision failure.
- Worker exception caught after reservation.

Cleanup cron releases only expired reservations that were missed by normal flows.

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

### 12.4 Reconciliation

Daily cron:

- Compare D1 order aggregates with inventory counts.
- Flag mismatch above 2 units.
- Produce owner digest.
- Create `inventory_reconciliation_runs` record.
- Never auto-correct without staff approval unless mismatch is only expired reservation cleanup.

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
- If D1 invoice write fails after DO direct sale, the POS flow must immediately call a compensating DO reversal method and log a P1 audit event.

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

The project uses an email adapter so providers can change without rewriting business logic.

Provider order:

1. Resend as the default stable transactional email provider.
2. Cloudflare Email Sending as optional low-cost provider when the account feature is enabled and tested.
3. Cloudflare Email Routing for inbound customer/support email only.
4. Manual staff notification fallback for failed transactional email.

### 17.2 Email Types

| Email | Trigger | Queue | Limit |
|---|---|---|---|
| Order confirmation | Order creation | `order-emails` | 1/order |
| Payment confirmation | Payment success | `order-emails` | 1/payment event |
| Shipping notification | Status `shipped` | `order-emails` | 1/status change |
| Delivery confirmation | Status `delivered` | `order-emails` | 1/status change |
| Password reset | Staff reset request | `order-emails` | 3/hour/email |
| Abandoned cart 1h | D1 cart_activity eligible | `order-emails` | 1/cart |
| Abandoned cart 24h | D1 cart_activity eligible | `order-emails` | 1/cart |
| Return confirmation | Return approved | `order-emails` | 1/return |
| Low stock digest | Daily cron | `order-emails` | 1/day/owner |

### 17.3 Abandoned Cart Flow

1. CartDO updates D1 `cart_activity` after cart mutation.
2. Customer phone/email is captured only after checkout begins or customer enters contact.
3. Consent must be `allowed` before marketing-style reminders.
4. Cron runs every 15 minutes.
5. Cron queries carts untouched for 1 hour and 24 hours.
6. Cron enqueues eligible reminders.
7. Email consumer sends via provider adapter.
8. D1 updates `abandoned_1h_sent_at` or `abandoned_24h_sent_at`.
9. If order is created, `converted_order_id` prevents further reminders.

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

Minimum CSP:

```txt
default-src 'self';
script-src 'self' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' https://cdn.zabirboutiques.com data: blob:;
connect-src 'self' https://api.uddoktapay.com https://api.fraudbd.com;
frame-src https://challenges.cloudflare.com;
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
```

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
- Provider cost bucket.
- User/staff triggering generation.

Default limits:

- 50 product description generations/day.
- 1,000 generations/month.
- Soft alert at 80%.
- Hard block at 100% unless Owner override.

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

These rules are mandatory.

1. Never use `output: 'hybrid'`.
2. Use `output: 'static'` with dynamic routes marked `prerender = false`.
3. Never move pricing authority to the browser.
4. Never trust browser-supplied totals, delivery fees, discounts, or stock.
5. Never use floating-point money.
6. CartDO is the active cart source of truth.
7. KV must not store authoritative cart, stock, payment, or order state.
8. Buy Now must create a direct checkout session and must not mutate the normal cart.
9. Buy Now submit must use the same secure checkout engine as normal checkout.
10. Never create an order before successful reservation.
11. If D1 order write fails after reservation, immediately release all reservations.
12. Cleanup cron is only a safety net, not primary rollback.
13. Short-lived Durable Objects must use alarm-based cleanup.
14. FraudBD direct checkout call timeout is 1.5 seconds; slow/unavailable responses create `pending_review` orders and enqueue async audit.
15. COD quantity rule uses `SUM(quantity)`.
16. POS does not use checkout reservation, but POS stock deduction must pass through `VariantInventoryDO.directSale()`.
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
28. CartDO must not synchronously write D1 on every cart mutation; use `cart-activity` queue and batch D1 writes.
29. Resend is the default transactional email provider; Cloudflare Email Sending is optional after account-level testing.
30. All migrations use D1-compatible SQL.
31. D1 constraints are enforced and tested.
32. All staff PII access is audit logged.
33. Every public page must meet performance budget.
34. Accessibility is mandatory.
35. AI-generated public content requires staff review.
36. Expensive add-ons require Owner approval.

---

## 31. AI Coding Agent Instructions

When an AI coding agent works on this repository, it must follow this order:

1. Read this Master Plan first.
2. Treat this document as higher priority than AGENTS.md, taste files, or generated implementation notes.
3. If another file says `output: 'hybrid'`, update that file to this canonical rule.
4. If another file says cart lives in KV, update it to CartDO source of truth.
5. If implementing checkout, include reservation rollback tests.
6. If implementing abandoned cart, create D1 cart_activity index and cart-activity queue flow.
7. If implementing POS, keep it separate from online orders but route stock mutation through VariantInventoryDO.directSale().
8. If implementing staff-assisted order, use checkout pipeline.
9. Every feature must include tests for failure paths, not only happy paths.
10. Before PR completion, run conflict checklist below.

### Agent Conflict Checklist

- [ ] No `output: 'hybrid'` exists.
- [ ] Dynamic routes export `prerender = false`.
- [ ] Cart authoritative state is in CartDO.
- [ ] KV cart JSON is not used.
- [ ] Checkout ignores client price/totals.
- [ ] Money uses integer paisa.
- [ ] FraudBD blocking/async behavior is not mixed.
- [ ] Reservation release exists on every failure branch.
- [ ] Abandoned cart has D1 queryable index.
- [ ] POS uses invoice ledger, not online orders.
- [ ] POS stock deduction uses VariantInventoryDO.directSale().
- [ ] Browser uploads original image only; variants are queue/API generated.
- [ ] Short-lived Durable Objects use alarm cleanup.
- [ ] CartDO publishes cart-activity queue messages instead of synchronous D1 writes.
- [ ] Resend is default email provider; Cloudflare Email Sending is optional.
- [ ] FraudBD checkout timeout is 1.5 seconds with pending_review fallback.
- [ ] Buy Now does not mutate normal cart.
- [ ] Buy Now submit uses secure checkout engine.
- [ ] Staff routes have RBAC middleware.
- [ ] Webhooks verify HMAC.
- [ ] External APIs use provider adapters only.
- [ ] FraudBD/UddoktaPay/DeepSeek/Imagify have timeout, retry, circuit breaker, and mock tests.
- [ ] No PII logs.
- [ ] Tests cover D1 constraint failures.

---

## 32. Feature Coverage Matrix

This matrix confirms that the V7 plan includes the required business, technical, operational, and AI-assisted features.

| Feature | V7 Coverage |
|---|---|
| Astro 6 | Included, corrected to v6 static-first model |
| Cloudflare Pages + Workers | Included |
| React 19 Islands | Included |
| Tailwind CSS design tokens | Included |
| D1 schema and constraints | Included and clarified |
| R2 images | Included |
| KV sessions/flags/redirects | Included, cart removed from authoritative KV |
| Durable Objects | Included and clarified |
| VariantInventoryDO | Included with rollback contract |
| CartDO | Included as normal cart source of truth |
| DirectCheckoutSessionDO | Included for Buy Now temporary sessions |
| BudgetCounterDO | Included |
| IdempotencyDO | Included |
| Queues | Included with corrected fraud queue role |
| UddoktaPay | Included as primary payment provider adapter with verify/reconcile flow |
| SSLCommerz fallback | Included |
| FraudBD | Included with direct checkout call, timeout, circuit breaker, and async audit |
| Buy Now direct guest order | Included with direct landing page, DirectCheckoutSessionDO, and secure checkout engine |
| COD-first model | Included with clear total quantity rule |
| Partial prepayment | Included |
| Server-authoritative pricing | Included |
| Stock reservation lifecycle | Included and hardened |
| Payment webhook/reconciliation | Included |
| 8-state order lifecycle | Included and extended with pending_review |
| Returns/refunds | Included |
| Staff RBAC | Included |
| Staff-assisted orders | Included |
| POS thermal receipts | Included with VariantInventoryDO direct-sale stock path |
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
| Resend email | Included as default transactional provider |
| Cart activity queue | Included for batched D1 cart_activity updates |
| Abandoned cart emails | Included with real detection mechanism |
| Inventory reconciliation | Included |
| Flash sale strategy | Included |
| Observability and alerts | Included |
| Environment separation | Included |
| CI/CD and migrations | Included |
| D1 backups to R2 | Included |
| Disaster recovery | Included |
| Compliance/privacy | Included |
| AI product descriptions/recommendations | Included with Workers AI primary and DeepSeek fallback |
| Prompt injection protection | Included |

---

## 33. Final Implementation Contract

This V7 plan is the implementation contract. The project must remain Cloudflare-native, cost-aware, mobile-first, SEO-friendly, and safe for ecommerce operations.

The most important engineering rule is simple:

**Static pages may sell the product, and Buy Now pages may convert the customer, but only dynamic server routes may trust data, change money, reserve stock, create orders, verify payments, send transactional emails, or change inventory.**

