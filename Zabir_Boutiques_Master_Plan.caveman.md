# Zabir Boutiques Master Plan v7 — Caveman

**Project:** Bangladesh eCommerce + F-commerce + POS  
**Stack:** Astro 6, React Islands, Tailwind CSS, Cloudflare Workers/Pages, D1, DO, R2, KV, Queues, Cron, Turnstile, Zero Trust  
**Priority:** Transaction integrity > page speed  
**Status:** Build contract. Source of truth.

---

## 0. Use

This = canonical. Split later into docs/ (MASTER_PLAN, ARCHITECTURE, SECURITY, DATA_MODEL, OPERATIONS, AI_AGENT).

---

## 1. Non-Negotiable

| Area | Decision |
|---|---|
| Framework | Astro 6 `output: 'server'`, `@astrojs/cloudflare`. Static pages opt in with `export const prerender = true` |
| Rendering | Server-first. Checkout/payment/staff/POS/APIs/webhooks/inventory = dynamic |
| Hosting | Cloudflare Pages + Workers/Pages Functions |
| DB | D1 canonical for products, orders, payments, staff, invoices, audit, migrations |
| Consistency | DO mandatory for carts, inventory serialization, idempotency, direct sessions, provider health, budget |
| Object storage | R2 for images, variants, logs, backups, reports |
| KV | Stale-tolerant only: flags, redirects, prefix cache, revocation hints |
| Cart source of truth | CartDO only. D1 `cart_activity` = searchable projection. KV/localStorage not authoritative |
| Buy Now | `DirectCheckoutSessionDO` isolated from `CartDO`. Never mutates normal cart |
| Pricing | Server reloads price, delivery, discount, VAT, advance, balance. Browser totals ignored |
| Money | Integer paisa. Float forbidden except AI cost in USD |
| Payments | Hosted pages only. Redirect not proof. Webhook + server verify + reconciliation required |
| Inventory | Reservations + POS sales pass through `VariantInventoryDO`. D1 not directly mutated outside DO |
| Security | Zero Trust + RBAC + CSRF + Turnstile + WAF + CSP + HMAC webhooks + Cloudflare Secrets |
| AI | Workers AI first. DeepSeek fallback budget-gated. Staff review AI public content |
| Audits | Guardrails + drift checks + P0 tests block release |

---

## 2. Architecture

```
Customer → Edge → WAF → Turnstile → Pages/Workers
Staff → Zero Trust → RBAC → Pages

All → D1 + R2 + KV + DO (CartDO, DirectCheckoutSessionDO, VariantInventoryDO, IdempotencyDO, ProviderHealthDO, BudgetCounterDO)
     → Queues (payment, email, fraud, image, cart, backup)
     → Cron (reconciliation, reservation cleanup, sitemap, backups, low stock)
```

### Service Ownership

| Concern | Service |
|---|---|
| Static pages | Pages/CDN |
| Dynamic routes | Workers/Pages Functions |
| Relational data | D1 |
| Strong consistency | DO |
| Blob storage | R2 |
| Stale cache | KV |
| Async jobs | Queues |
| Scheduled | Cron |
| Bot protection | Turnstile + WAF |
| Staff perimeter | Zero Trust `/staff/*`, `/api/staff/*` |
| Security edge | WAF, Rate Limiting |
| Observability | Analytics Engine, R2 archives |

---

## 3. Routing

### Astro Config

```js
output: 'server'
adapter: cloudflare()
```

### Static (prerender = true)

`/`, `/products/[slug]`, `/categories/[slug]`, `/collections/[slug]`, `/blog/[slug]`, `/about`, `/privacy`, `/terms`, `/return-policy`, `/size-guide`

### Dynamic (default, no prerender flag)

`/cart`, `/checkout`, `/buy-now/[slug]`, `/api/cart/*`, `/api/buy-now/*`, `/api/checkout`, `/api/payments/*`, `/api/stock/*`, `/api/search`, `/staff/*`, `/api/staff/*`

Forbidden: `output: static|hybrid`, `export const prerender = false`

---

## 4. Data Ownership

| Data | Source | Projection |
|---|---|---|
| Product metadata | D1 | Static snapshots, Cache API |
| Images | R2 | CDN cache |
| Price | D1 | Checkout reloads |
| Inventory | VariantInventoryDO + D1 ledger | Live stock API |
| Active cart | CartDO | React state, D1 `cart_activity` |
| Buy Now session | DirectCheckoutSessionDO | D1 after order |
| Orders | D1 | None |
| Payment events | D1 | Queue replay |
| Staff sessions | HttpOnly cookie + D1/KV revocation | RBAC server-side |
| POS invoices | D1 | Separate from online |
| Audit logs | D1 hot + R2 archive | Analytics Engine |
| AI budget | D1 `ai_budget_limits` | BudgetCounterDO |
| Provider health | ProviderHealthDO | D1 `api_audit_logs` |

---

## 5. D1 Schema Groups

```
catalog: products, product_variants, categories, product_categories, product_images, product_tags, inventory_items
cart_checkout: cart_activity, direct_checkout_activity, coupons, coupon_redemptions, idempotency_keys, stock_reservations
orders_payments: orders, order_items, order_status_events, payment_events, returns, return_items, refunds
pos: invoices, invoice_items, invoice_payments, invoice_audit, daily_invoice_counters
staff_security: staff_users, staff_roles, staff_permissions, staff_sessions, password_reset_tokens, password_reset_rate_limits, csrf_nonces, otp_secrets, audit_log
operations: api_audit_logs, email_log, stock_adjustments, inventory_reconciliation_runs, ai_generation_log, ai_budget_limits, backup_log
```

### Money Columns

All integer paisa: `*_paisa`. Forbidden: REAL, FLOAT, DOUBLE for commerce. Float only in `BudgetCounterDO.recordUsage()` USD.

### Cart Activity Guarded Upsert

```sql
INSERT INTO cart_activity (...) VALUES (...)
ON CONFLICT(session_id) DO UPDATE SET
  ...
  last_d1_write_seq = cart_activity.last_d1_write_seq + 1
WHERE excluded.last_d1_write_at >= COALESCE(cart_activity.last_d1_write_at, '')
```

Prevents stale queue writes overwriting fresher alarm writes.

### Payment Guarded Update

```sql
UPDATE orders SET payment_status=?, status=?, ... WHERE order_id=?
  AND status NOT IN ('cancelled','returned','refunded')
  AND EXISTS (SELECT 1 FROM payment_events WHERE order_id=? AND event_id=?)
```

Never downgrade paid → pending/cancelled.

### Password Reset Tables

`password_reset_tokens` + `password_reset_rate_limits`. HMAC tokens only, 1hr expiry, one-time use, rate-limited per-IP/per-staff.

### Bangla Localization

`name_bn`, `description_bn` on products + variants. FTS5 includes Bangla fields:

```sql
tokenize="unicode61 tokenchars='_৳' remove_diacritics 1"
```

Canonical URLs Latin. `?lang=bn` for Bangla.

---

## 6. Drizzle ORM

- Every D1 table needs Drizzle schema
- Route handlers call services, not Drizzle inline
- High-traffic routes use explicit column selects
- Stock mutation forbidden through Drizzle outside VariantInventoryDO
- Checkout pricing server-side only

---

## 7. DO Contracts

### CartDO

State:
- `items[]` (variantId, quantity, addedAt, updatedAt)
- `coupon_code?`
- `customer_contact` (name?, phone?, email?, consentStatus)
- `cart_version` — increment only on actual mutation
- `last_mutation_at`, `last_persisted_at?`
- `five_min_alarm_at?`, `thirty_day_alarm_at?`, `soft_alarm_active`

Methods: `addItem`, `removeItem`, `changeQuantity`, `clearCart`, `applyCoupon`, `removeCoupon`, `updateCustomerContact`, `mergeCart`, `getCart`

Version rules: increment by 1 only if state changed. No increment on alarm/replay.

Alarm lifecycle:
- Mutation → set 5-min alarm + `soft_alarm_active = true`
- `getCart()` after eviction + items exist + no alarm → re-arm
- 5-min alarm → guarded D1 upsert (`write_source='alarm'`)
- 30-day cleanup → final D1 write + `deleteAll()`
- Empty cart → skip activity write

### DirectCheckoutSessionDO

State: session_id, product_id, variant_id, quantity, selected_options, created_at, expires_at (30min), origin, user_agent_hash, source_page, utm_params, form_draft

Rules:
- `session_id = HMAC(secret, timestamp + random)`
- Validate Origin + User-Agent hash on every request
- Mismatch → 403 + delete session
- Delete form data after order success
- 30-min expiry alarm required

### VariantInventoryDO

available = stock - reserved - sold

Methods: `reserve`, `release`, `confirm`, `directSale`, `reverseDirectSale`

POS: directSale writes D1 first → DO state. Invoice write fail → reverseDirectSale. Reversal fail → P0 audit.

### IdempotencyDO

Claim operation atomically. Store response 24h. Replay returns same. Different payload same key → conflict. Alarm cleanup after TTL.

### ProviderHealthDO

Circuit breaker per provider. 5 failures/60s → open. Open 5min → half-open. Fallback score 50 for FraudBD.

### BudgetCounterDO

DeepSeek: $5/day hard cap. Workers AI primary fallback. `canUseDeepSeek()` timeout → Workers AI, not unlimited. `recordUsage()` idempotent on (provider, request_id).

---

## 8. Cart Flow

```
UI → /api/cart/* (with cart_version + idempotency_key)
   → CartDO command (validate + mutate + increment version + arm alarm + publish queue)
   → Response (current cart + version)
Queue → D1 guarded upsert (source='queue')  
Alarm → D1 guarded upsert (source='alarm')
```

Conflict: stale `clientVersion` → 409 + current cart.

Abandoned: 24h inactivity + no conversion + consent=allowed + email present. Dedup by `customer_email` with `ROW_NUMBER()`.

---

## 9. Buy Now Flow

1. Select variant + quantity → click Buy Now
2. `/api/buy-now/session` → DirectCheckoutSessionDO (30min)
3. Redirect to `/buy-now/{slug}?sid={session_id}`
4. Submit guest form → `/api/buy-now/submit`
5. Shared checkout engine: pricing, fraud, reservation, D1 order, payment, email
6. Clear session data after success

Never mutates CartDO. No final price authority in session.

---

## 10. Checkout

### Steps

1. Validate Idempotency-Key (IdempotencyDO)
2. Validate CSRF + Turnstile
3. Normalize BD phone to +880
4. Load cart from CartDO or DirectCheckoutSessionDO
5. Accept only variant_id + quantity from browser
6. Server reload price, stock, status
7. Compute subtotal, discount, delivery, VAT, total server-side
8. Validate coupon atomic in D1
9. COD rule: SUM(quantity) threshold
10. FraudBD direct check (1.5s timeout, 0 retries)
11. Reserve stock through VariantInventoryDO
12. Write D1 order + items atomic
13. D1 fail → immediate release all reservations
14. Initiate hosted payment if needed
15. Enqueue email + fraud audit
16. Complete idempotency

### VAT

`vatRate = env.VAT_RATE_PERCENT ?? 0`. If > 0 → audit_log `OWNER_ACK_BD_VAT_MVP`.

### Payment Methods

| Method | Advance | Balance |
|---|---|---:|---:|
| cod | 0 | full |
| partial_prepay | configured % | remaining |
| uddoktapay | full | 0 |
| sslcommerz | full (fallback) | 0 |
| in_store | full paid at counter | 0 |

### Provider Contract

```ts
interface PaymentProvider {
  createPayment(input): CreatePaymentResult;
  verifyPayment(input): VerifyPaymentResult;
  parseWebhook(request): VerifiedPaymentEvent;
  refund?(input): RefundResult;
}
```

Webhook: verify signature → idempotent insert → queue → server verify → guarded update → confirm stock → email → audit.

Reconciliation: 15min cron, verify pending orders >30min with provider. Never downgrade confirmed paid.

---

## 11. FraudBD

| Score | Action |
|---|---:|---|
| 0-40 | Approve |
| 41-70 | `pending_review` |
| 71-100 | Reject |
| Timeout/circuit open | score 50 + `pending_review` |

Circuit: 5 failures/60s → open 5min. Fallback score 50. Checkout timeout 1.5s, 0 retries.

---

## 12. Inventory

available = stock - reserved - sold

Reservation lifecycle: checkout → reserve → D1 write fail → release. Payment timeout → cancel + release. Confirmed → reserved→sold. Return approved → restock.

Cleanup cron: hourly, active >15min + no release_requested → release.

Unique index on active reservations per order.

---

## 13. POS

POS does not use guest checkout, COD, or online payment. Stock through `VariantInventoryDO.directSale()`.

Compensating transaction:
1. Create invoice_id
2. `directSale()` — insufficient stock → stop
3. Success → write D1 invoice
4. D1 fail → `reverseDirectSale(reason='d1_invoice_write_failed')`
5. Reversal success → P1 audit, ask cashier retry
6. Reversal fail → P0 audit, alert on-call

---

## 14. Order States

created → pending_review → confirmed → processing → shipped → delivered → returned → refunded
created/confirmed/processing → cancelled (terminal)
cancelled/returned/refunded — terminal, never re-activate

---

## 15. Staff & RBAC

Zero Trust Access for `/staff/*` + `/api/staff/*`. App-level RBAC after Access.

Roles: Owner, Manager, Staff, Viewer. Permissions per role table in §17.2.

Owner needs TOTP. Sessions: Secure, HttpOnly, SameSite=Strict. Idle timeout 30min. Absolute 8h. Max 2 concurrent.

Staff-assisted orders use same checkout service with staff identity.

---

## 16. Security

### Headers

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
```

### Public CSP

`default-src 'self'`; `script-src 'self' nonce-{nonce} 'strict-dynamic' + hashes`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' cdn... *.r2.dev data: blob:`; `connect-src 'self' api.uddoktapay.com uddoktapay.com securepay.sslcommerz.com api.fraudbd.com api.resend.com api.deepseek.com *.imagify.com api.pathao.com portal.packzy.com api.redx.com.bd *.r2.cloudflarestorage.com`; `frame-src 'self' challenges.cloudflare.com securepay.sslcommerz.com uddoktapay.com`; `form-action 'self' uddoktapay.com securepay.sslcommerz.com`

### Staff CSP

Restricted: `connect-src 'self'`; `frame-src 'self' challenges.cloudflare.com`; `form-action 'self'`

### CSRF

Unsafe methods: HttpOnly session cookie + non-HttpOnly CSRF cookie + HMAC-signed header + Origin/Referer validation. Monthly key rotation.

### Turnstile

Required: staff login, checkout on risk threshold, coupon after repeated failures, contact forms, password reset. Server-side validation mandatory.

### Rate Limits

| Route | Limit |
|---|---:|
| /api/checkout | 20/min/IP |
| /staff/login | 5/min/IP + 10/min/email |
| /api/coupon/apply | 5/min/session |
| /api/payments/webhook | Provider allowlist + signature |
| /api/search | 60/min/IP |
| /api/staff/password-reset/* | 3/15min/IP |
| Public pages | 100/min/IP |

### Secrets

Cloudflare Secrets only. Forbidden: .env in git, API key in source, raw webhook payload in logs, payment provider secret in bundle, TOTP key in D1.

---

## 17. WAF

Protected route groups: checkout (`/api/checkout`, `/checkout`, `/buy-now/*`), staff (`/staff/*`, `/api/staff/*`), payment (`/api/payments/webhook`), coupon (`/api/coupon/*`), password reset, search.

Actions: managed challenge for suspicious checkout/coupon. Block malicious payloads. Rate limit login/reset. Don't challenge verified webhooks before signature.

Origin protection: Cloudflare Tunnel or AOP preferred. Origin firewall deny public inbound.

---

## 18. Caching

| Content | Strategy | TTL |
|---|---|---:|
| Homepage | Static/SWR | 10min |
| Product page | Prerender + live stock API | 1h |
| Category page | Prerender/SWR | 30min |
| Product listing | Cache API | 5min |
| R2 images | CDN | 7d+ |
| JS/CSS | Immutable | 1y |
| Checkout/auth/staff | No-store | 0 |
| Sitemap | R2 static | 24h |

Never cache checkout/cart/staff. Cache Tags for targeted purge. No purge-everything business hours. Stock changes purge product cache only when visible.

---

## 19. Performance

| Metric | Target | CI fail |
|---|---:|---:|
| LCP | <2.5s | >3.0s |
| INP | <200ms | >300ms |
| CLS | <0.1 | >0.15 |
| Public TTFB | <300ms | >800ms |
| Checkout TTFB | <800ms | >1200ms |
| Page weight | <500KB | >700KB |
| JS island | <30KB gzip | >50KB |
| Public islands/page | ≤5 | >7 |
| Checkout CPU | <30ms | >50ms |
| Search p95 | <200ms | >500ms |

Rules: responsive images + srcset, lazy-load below-fold, avoid `client:load` except checkout/staff, no staff JS on public pages.

---

## 20. SEO & Bangla

URLs: Latin lowercase hyphen slugs. `?lang=bn` for Bangla. Canonical → `/products/{slug}`.

Structured data: Product+Offer, ItemList (category), Organization+WebSite (homepage), BreadcrumbList, safe Order data (tracking).

Locale: `'en' | 'bn'`. Bangla fields in staff editor. FTS5 with Bangla columns. Unicode normalization for search.

---

## 21. Search

Launch: D1 FTS5 (name, description, category, tags, sku, name_bn, description_bn). FTS synced by triggers or service writes. Same tokenizer insert and query.

Future: catalog >10k products or search p95 >200ms → Typesense/Meilisearch/Algolia. Typo tolerance or semantic intent → managed search or Workers AI embeddings.

---

## 22. Image Pipeline

1. Staff upload original to R2 via signed URL
2. Browser preview only, not production variants
3. Queue generates variants (150px thumbnail, 400px card, 800px detail, 1600px zoom, 1200x630 og)
4. Imagify adapter optional; failure non-blocking
5. Alt text required before publish. AI may suggest, staff must review

---

## 23. Email

### Adapter

```ts
interface EmailProvider {
  sendEmail(request: SendEmailRequest): Promise<SendResponse>;
}
```

Provider: `EMAIL_PROVIDER=resend` (default) | `cloudflare_email`.

### Types

Order confirmation (1/order), payment confirmation (1/payment), shipping, delivery, password reset (3/h/email), abandoned cart (1/wave), return confirmation, low stock digest (daily).

---

## 24. External API Governance

Adapters required for all third-party APIs. Layout:

```
src/lib/integrations/{provider}/
  client.ts, types.ts, errors.ts, mock.ts, index.ts
```

Every adapter implements: env-aware base URL, Cloudflare Secrets credentials, timeout, retry policy, idempotency, circuit breaker (ProviderHealthDO), runtime schema validation, PII redaction, sandbox/mock mode, `api_audit_logs` logging.

Forbidden: raw fetch from route handlers, API keys in client code, trust provider response without validation, send PII to AI providers without approval.

---

## 25. AI

| Feature | Primary | Fallback | Review |
|---|---|---|---|
| Product description | Workers AI | DeepSeek | Required |
| Alt text | Workers AI | Staff | Required |
| Recommendations | Workers AI/logic | Category | Optional |
| Search embeddings | Workers AI | D1 FTS | Not required |
| Content moderation | Rules + AI | Staff | Required |

Budget: Workers AI 200 calls/$1/day, DeepSeek 50 calls/$5/day, Imagify as configured. Block on first limit hit (count or USD). Soft alert 80%. Owner override only with P2 alert per call. AI public content stays draft until staff approves. Prompt injection logged.

---

## 26. Observability

### Log Fields

timestamp, request_id, route, status_code, duration_ms, worker_cpu_ms, error_type, user_type, channel, payment_method, order_id_hash, provider, circuit_state, queue_name, retry_count

Never log: full phone/address, API keys, payment secrets, raw webhooks, TOTP secrets, reset tokens.

### Alerts

checkout_failure_rate >20% 15min, payment_webhook_failure sustained, d1_query p99 >2000ms, fraudbd_timeout >10%, provider_circuit_open (P2/P1), stock_reservation_failures >10/min/variant, pos_compensation_failure (P0), email_fail >5% 15min, cache_hit_rate <70%, worker_cpu p99 >50ms, ai_budget 80% alert / 100% block.

### Audit Events

Append-only: staff login/logout/failure, PII access, order/payment status change, refund, stock adjustment, POS void/compensation, FraudBD decision, circuit transition, password reset, Owner VAT ack, AI budget override, waiver, release sign-off.

---

## 27. CI/CD

### Environments

Production `zabirboutiques.com` (real data), Staging `staging.*` (anonymized), Dev `dev.*` (seed). Each: separate D1, R2, KV, DO, Queues, Secrets, Access.

### Pipeline

install → typecheck → lint → unit tests → contract tests → D1 migration dry-run → invalid-insert tests → Drizzle schema parity → Astro build → bundle size → Lighthouse → CSP tests → security scan (secrets, PII, direct fetch) → drift audit → preview deploy → manual approval → production deploy → smoke tests → targeted cache purge.

Production blocked if any P0 test fails.

### Migrations

Numbered only. Rollback required. SQLite/D1-compatible. Staging first. Risky soak 24h. Never edit applied migration. Test fixtures for constraints, invalid inserts, rollback.

---

## 28. Disaster Recovery

RPO 6h, RTO 2h. D1 backup every 6h. Retention: 30 daily, 12 monthly. Restore test weekly to staging.

Backup: cron → backup worker → D1 export → R2 → checksum → log → alert on failure.

Restore: select latest verified backup → restore to new D1 or staging → verify counts + checksum → schema integrity → update bindings → purge cache → smoke test product, checkout, payment, staff, POS → monitor 30min. If corruption suspected, stop writes before repair.

---

## 29. Privacy & PCI

Guest collects: name, phone, delivery address, optional email, optional note. No NID, DOB, gender, card details.

Retention: PII 3y (or deletion request), orders 7y, payment 7y, audit 7y, hot logs 90d, cold redacted 1y, backups 30d/12m.

PCI: hosted pages only, no card forms, no card storage/logging/proxy, webhook redacted, annual SAQ A.

---

## 30. P0 Remediation Backlog

| ID | Fix |
|---|---|
| P0-01 | Launch CSP public/staff split (DONE) |
| P0-02 | Payment event index (DONE) |
| P0-03 | Canonical payment conflict SQL (DONE) |
| P0-04 | UddoktaPay timeout/idempotency (DONE) |
| P0-05 | Checkout payment initiation (DONE) |
| P0-06 | Cart activity race columns + guarded upsert (DONE) |
| P0-07 | CartDO two-stage alarm lifecycle (DONE) |
| P0-08 | Cart version contract (DONE) |
| P0-09 | POS directSale stock checks (DONE) |
| P0-10 | POS reverseDirectSale audit (DONE) |
| P0-11 | `direct_checkout_activity` table (DONE) |
| P0-12 | Staff password reset tables (DONE) |

### Short-Term Hardening

H-01 Drizzle schema (DONE), H-02 Contract stubs (DONE), H-03 Drift audit D-01-D-56, H-04 Bangla + FTS, H-05 D1 invalid-insert tests, H-06 WAF/rate limits Terraform, H-07 Zero Trust config audit, H-08 Turnstile server tests, H-09 Origin protection, H-10 Dashboards + alerts

---

## 31. 44 Guardrails

1. No `output: static|hybrid`
2. No `prerender = false` on dynamic routes
3. No browser-trusted price, stock, discount, VAT, delivery, total
4. No floating-point commerce money
5. No authoritative cart in KV or localStorage
6. CartDO two-stage alarm lifecycle
7. CartDO D1 projection monotonic guarded upsert
8. Cart version rules pass contract tests
9. Buy Now must not mutate CartDO
10. Buy Now submit uses checkout service
11. DirectCheckoutSessionDO validates Origin + User-Agent
12. No order before stock reservation
13. D1 order write fail → release all reservations
14. Reservation cleanup cron is safety net
15. Stock reservation partial unique active-order index
16. POS must use directSale/reverseDirectSale
17. POS compensation failure is P0
18. Payment redirect does not mark paid
19. Webhooks require signature verification
20. Reconciliation verifies provider before state change
21. Payment updates use guarded forward-only SQL
22. Staff routes require Access + RBAC
23. Owner requires TOTP
24. Password reset uses HMAC one-time tokens
25. No PII or secrets in logs
26. External APIs use adapters only
27. Provider adapters require timeout, retry, circuit breaker, schema validation, mocks
28. Turnstile requires server-side verification
29. CSP must not block payment, Turnstile, images, staff
30. Checkout/auth/staff never cached
31. Public pages meet performance budgets
32. WCAG 2.1 AA mandatory
33. Browser uploads originals only; variants queue-generated
34. AI public content requires staff review
35. DeepSeek budget check before call
36. Drizzle must not directly mutate stock
37. Every D1 table needs Drizzle schema
38. Bangla search fields in FTS
39. Public slugs Latin unless ADR
40. All migrations require rollback + tests
41. Drift audit must fail closed
42. P0 tests block release
43. Waivers expire 30 days, cannot be silent
44. Release sign-off required

---

## 32. Drift Audit Checks

Must check: Astro rendering drift, prerender false drift, cart localStorage/KV authority drift, cart alarm lifecycle drift, cart race-contract columns drift, payment SQL drift, payment event index drift, FraudBD retry/circuit drift, POS compensation drift, CSP allowlist drift, Turnstile validation drift, password reset token drift, Bangla localization drift, FTS tokenizer drift, Drizzle schema coverage drift, direct stock mutation drift, PII log drift, external API direct fetch drift, AI budget bypass drift, migration rollback drift.

Script fails if catalogue count ≠ implemented checks count.

---

## 33. AI Agent Instructions

1. Read Master Plan first
2. Identify feature/bug
3. Identify affected guardrails
4. Locate `src/lib/contracts/`
5. Implement only through approved architecture
6. Add tests (happy + failure)
7. Run typecheck, lint, tests, migration dry-run, drift audit
8. Report guardrail conflict — don't silently bypass

### Forbidden

No cart in localStorage as source of truth. No KV cart. No browser totals. No route handler stock mutation. No payment from redirect. No direct third-party fetch from routes. No committed secrets. No PII logs. No fake scarcity. No `output: static|hybrid`. No `prerender=false`. No Turnstile bypass. No ship without failure tests.

---

## 34. Core Rule

**Public pages may sell product. Only trusted dynamic server paths may price, reserve, collect, verify, fulfill, refund, or mutate business state.**
