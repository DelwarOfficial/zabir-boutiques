<div align="center">
  <img src="public/assets/zabir-logo.jpg" alt="Zabir Boutiques" width="120" height="120" style="border-radius: 50%;" />
  <br />
  <h1 align="center">Zabir Boutiques — AI Commerce Platform</h1>
  <p align="center"><strong>Master Edition</strong> · Cloudflare-Native · Bangladesh F-Commerce</p>

  [![Astro](https://img.shields.io/badge/Astro-6.4.4-FF5D01?logo=astro)](https://astro.build)
  [![Cloudflare](https://img.shields.io/badge/Cloudflare-Pages+Workers-F38020?logo=cloudflare)](https://pages.cloudflare.com)
  [![D1](https://img.shields.io/badge/Database-D1-3B82F6?logo=cloudflare)](https://developers.cloudflare.com/d1/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)](https://www.typescriptlang.org)
  [![Vitest](https://img.shields.io/badge/Tests-211%20passing-6E9F18?logo=vitest)](https://vitest.dev)
  [![License](https://img.shields.io/badge/License-Proprietary-64748B)](LICENSE)
</div>

---

A premium boutique fashion e-commerce platform for Wari, Dhaka — purpose-built for the Bangladesh market. **COD-first checkout** with FraudBD risk routing, UddoktaPay payment gateway, real-time inventory reservation, full staff operations dashboard, and Workers AI–powered content tooling.

> **Package version:** `7.0.0` · **Runtime:** Astro 6.4.4 / @astrojs/cloudflare 13.6.1 (advanced mode) · **Spec edition:** Master_Prompt v7.0 — server-authoritative checkout, D1 source of truth, Durable Object inventory gates, Cloudflare Queues for webhooks and email, Workers AI + DeepSeek fallback, R2 Image Resizing, FTS5 search.

---

## Table of Contents

- [Highlights](#highlights)
- [Architecture](#architecture)
- [Features](#features)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [Security Model](#security-model)
- [Deployment](#deployment)
- [Operations](#operations)
- [Scripts](#scripts)
- [Testing](#testing)
- [Documentation](#documentation)
- [Changelog](CHANGELOG.md)
- [Guardrails](#guardrails)
- [License](#license)

---

## Highlights

- **Server-authoritative pricing** — checkout never trusts the browser for money fields; subtotal, delivery, discount, and total are recomputed from D1 `price_paisa` on every request.
- **Zero overselling under concurrency** — single-threaded Durable Object gates reserve/release per variant; D1 remains source of truth.
- **At-least-once webhooks, exactly-once orders** — Cloudflare Queue + IdempotencyDO with server-to-server UddoktaPay verification.
- **30-min idle / 8-hour absolute session timeout** with KV revocation blacklist.
- **Strict CSP** — per-request nonce + build-time SHA-256 allow-list of emitted scripts; no `unsafe-inline` at the perimeter.
- **FTS5 product search** with bm25 ranking + KV-backed tri-gram autocomplete index.
- **R2 Image Resizing** with 4 responsive variants (thumbnail 150w, card 400w, detail 800w, zoom 1600w) and a 1200×630 OG variant.
- **Workers AI primary, DeepSeek fallback**, gated by a per-scope `BudgetCounterDO` for cost control.
- **Three-stage content moderation** — PII regex → keyword blocks → Workers AI text-moderation.
- **DR-grade backups** — every 6 hours to R2; RPO 6h, RTO 2h.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      Cloudflare Edge                              │
│                                                                   │
│   WAF Custom Rules          Cache API (SWR)        Image Resizing│
│   (managed + per-zone)      script-src: nonce      /cdn-cgi/image│
│        │                        │                        │       │
└────────┼────────────────────────┼────────────────────────┼───────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌──────────────────────────────────────────────────────────────────┐
│                Cloudflare Pages + Workers (Astro SSR)             │
│                                                                   │
│   ┌──────────────┐  ┌────────────────┐  ┌────────────────────┐   │
│   │ Static pages │  │ SSR (checkout, │  │ API routes         │   │
│   │ prerender=1  │  │ staff, order)  │  │ /api/*             │   │
│   └──────────────┘  └────────────────┘  └────────────────────┘   │
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │ Middleware  (CSRF · rate limit · per-request CSP nonce   │  │
│   │  · session resolve · __Host- cookies · security headers) │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│   │ Durable Objects  │  │ Queues           │  │ Cron Jobs    │  │
│   │ VariantInvDO     │  │ payment-webhooks │  │ 9 schedules  │  │
│   │ IdempotencyDO    │  │ order-emails     │  │ (see Ops)    │  │
│   │ BudgetCounterDO  │  │ image-processing │  │              │  │
│   │ WafRulesDO       │  │ fraud-scoring    │  │              │  │
│   │                  │  │ d1-backup        │  │              │  │
│   └──────────────────┘  └──────────────────┘  └──────────────┘  │
│                                                                   │
└────────┬─────────────────┬─────────────────┬───────────────────────┘
         │                 │                 │
         ▼                 ▼                 ▼
   ┌──────────┐      ┌──────────┐      ┌──────────┐
   │ D1 (SQL) │      │ R2       │      │ KV       │
   │ 22 tables│      │ media    │      │ cache    │
   │ truth    │      │ backups  │      │ session  │
   └──────────┘      └──────────┘      └──────────┘
         │
         │ (read-only)
         ▼
   ┌────────────────────────────────────────────────────────────┐
   │ External: UddoktaPay · FraudBD · Turnstile · Resend        │
   │          · Workers AI · DeepSeek · Tinify · Cloudflare API │
   └────────────────────────────────────────────────────────────┘
```

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | Astro 6.4.4 (`output: "server"`) | Per-page `prerender = true/false` opt-in |
| **Adapter** | `@astrojs/cloudflare` 13.6.1 | Advanced runtime, DOs, Queues, Cron |
| **Database** | Cloudflare D1 (SQLite) | Source of truth — 22 tables |
| **Concurrency** | Durable Objects | Per-variant inventory gate, idempotency, AI budget, WAF observability |
| **Async** | Cloudflare Queues | Webhooks, emails, image processing, fraud, backups |
| **Media** | Cloudflare R2 | Product images + D1 backup archives |
| **Cache** | Cloudflare KV | Cache API SWR, rate limits, session blacklist, autocomplete prefix index |
| **Images** | Cloudflare Image Resizing | On-the-fly variants via `/cdn-cgi/image/` |
| **Search** | D1 FTS5 + Workers AI | bm25 ranking; AI semantic for Phase 2 |
| **Payments** | UddoktaPay | Server-to-server verification |
| **Fraud** | FraudBD | Risk signal only — D1 stays authoritative |
| **AI** | Workers AI + DeepSeek | Cost-gated by `BudgetCounterDO` |
| **Email** | Resend | Transactional + abandoned cart |
| **Bot defense** | Cloudflare Turnstile | Checkout + staff login |
| **Observability** | Workers Analytics Engine | Business metrics; Logpush to R2 |
| **Image comp** | Tinify | Upload-time compression |

---

## Features

### Storefront
- **Prerendered catalog** — Home, category, and product pages use build-time D1 snapshots with CDN cache headers
- **JSON-LD Product + BreadcrumbList** on PDP for Google rich results
- **Canonical URLs, Open Graph, meta descriptions** site-wide
- **CDN-cached stock badges** — fresh D1 read with `Cache-Tag` headers, zero KV writes on public traffic
- **Guest checkout** — Name, phone, address. No account required.
- **Idempotent checkout** — `Idempotency-Key` header prevents duplicate orders on retry
- **Max 10 line items** — enforced server-side

### Inventory
- **Reservation-first engine** — Stock is reserved (not deducted) at checkout
- **10-minute reservation TTL**, cleanup cron every 5 min
- **Durable Object concurrency gate** — `reserveVariants()` / `releaseVariants()` are serialized per variant
- **Atomic batch operations** — `db.batch()` with `meta.changes` verification
- **Partial-failure rollback** — All successful reservations released if any one fails
- **Order creation gated on reservation success** — guardrail enforced

### Payments
- **UddoktaPay** with **server-to-server verification** (browser redirects never mark paid)
- **Queue-backed webhook processing** — `payment-webhooks` queue with 5-retry backoff
- **Reconciliation cron (15 min)** — catches orphaned payments from missed webhooks
- **Webhook idempotency** — `INSERT OR IGNORE` with `UNIQUE(invoice_id, event_type, status)`
- **`paid_over_allocated` fallback** — graceful handling when stock runs out between checkout and payment

### Fraud Prevention
- **FraudBD risk scoring** — 3-second timeout
- **Risk routing** — 0-30 approved · 31-79 review · 80-100 blocked
- **Timeout/error = review** — never auto-blocks on API failure
- **Async fraud polling** — `fraud_polls` table + `fraud-scoring` queue

### Returns
- **Order state machine** with explicit `returned` → `refunded` transitions
- **Auto-restock on approved returns** — `stock_adjustments` audit row per item
- **UddoktaPay refund API** for prepaid orders

### Staff Operations
- **RBAC** — 6 roles (owner, super_admin, manager, salesman, packing, support) with 30+ permissions
- **HMAC-SHA256 sessions** — only hashed tokens stored in D1
- **Session-independent CSRF** — `nonce.HMAC(nonce)` token, never `sessionToken.hash`
- **Turnstile** on staff login + checkout (server-side verification)
- **KV session revocation blacklist** with D1 mirror
- **Coupon brute-force protection** — 5 failures → 30-min lockout
- **Tamper-evident audit log** with chain hash
- **Returns / refunds / payments / coupons / media / staff menu / dev keys** — all RBAC-gated

### Search & Discovery
- **FTS5 product search** with bm25 relevance ranking
- **KV-backed tri-gram autocomplete** for sub-10ms p99 keystroke responses
- **Fallback to FTS5** when the index misses

### AI Layer
- **Workers AI primary**, DeepSeek fallback
- **BudgetCounterDO** enforces per-scope, per-period cost caps
- **Content moderation** pipeline (PII → keyword → AI) before any user-generated text is persisted

### Security
- **Strict CSP** — per-request nonce + build-time SHA-256 script allow-list
- **HSTS preload**, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`
- **Origin validation** on login + checkout mutations
- **Rate limiting** on every public API route (KV sliding window)
- **Money = INTEGER paisa** — no floating point anywhere
- **Zero Trust Access** for `/staff/*` (configurable via Cloudflare Access)

### Cron & Maintenance
Nine cron schedules, routed by `src/lib/cron-dispatch.ts` and listed in `wrangler.jsonc`:

| Cron | Frequency | Job |
|------|-----------|-----|
| `*/5 * * * *` | Every 5 min | Expired reservation cleanup |
| `*/15 * * * *` | Every 15 min | Payment reconciliation (UddoktaPay status check) |
| `0 * * * *` | Hourly | FraudBD poll sweep |
| `0 0 * * *` | Daily 00:00 UTC | Inventory reconciliation |
| `0 2 * * *` | Daily 02:00 UTC | Session cleanup, idempotency expiry, Tinify retry |
| `0 3 * * *` | Daily 03:00 UTC | Archive old events/logs to R2 |
| `0 */6 * * *` | Every 6 hours | D1 backup to R2 |
| `0 9 * * 0` | Weekly Sun 09:00 | Backup verification + autocomplete index rebuild |
| `0 5 1 * *` | Monthly 1st 05:00 | Long-term archive rotation |

---

## Role-Based Access Control

Server-side enforcement only — route splitting and menu hiding are **not** authorization. The full matrix lives in `src/lib/rbac.ts`.

| Role | Tier | Access |
|------|------|--------|
| `owner` | Owner | Full system access — every permission implicitly |
| `super_admin` | Owner | Alias of `owner` for legacy compatibility |
| `manager` | Business | Daily operations: products, inventory, orders, fraud view, media, reports |
| `salesman` | Business | Sales dashboard + COD order creation/updates |
| `packing` | Business | Packing queue + courier handoff |
| `support` | Business | Order search + support notes |

Owner-only areas (developer API keys, secrets, backups) are gated by `assertOwnerOnly()` plus a specific permission such as `system.api_code.manage`.

---

## Quick Start

### Prerequisites
- Node.js 20+
- A Cloudflare account
- Wrangler CLI (`npm i -g wrangler`)

### Setup

```bash
git clone https://github.com/DelwarOfficial/zabir-boutiques.git
cd zabir-boutiques

npm install

cp .env.example .env.local
# Edit .env.local with your Cloudflare credentials + service keys

# Apply D1 migrations locally
npm run db:migrate:local

# (Optional) Seed sample data
npx tsx scripts/seed.ts

# Start dev server
npm run dev
```

### One-shot

```bash
npm install && npm run db:migrate:local && npm run dev
```

---

## Project Structure

```
zabir-boutiques/
├── src/
│   ├── entry-cloudflare.ts       # Worker entry: fetch + scheduled + queue
│   ├── env.d.ts                  # Cloudflare runtime types
│   ├── middleware.ts             # CSRF + rate limit + CSP nonce + auth guard
│   ├── pages/
│   │   ├── index.astro           # Homepage (prerender = true)
│   │   ├── checkout.astro        # Guest checkout (React island host)
│   │   ├── order-track.astro     # Order tracking
│   │   ├── categories/[slug].astro
│   │   ├── products/[slug].astro # JSON-LD + srcset + CSP-friendly
│   │   ├── staff/                # Operations dashboard
│   │   └── api/                  # All HTTP endpoints
│   │       ├── checkout.ts
│   │       ├── search.ts         # FTS5 + autocomplete helper
│   │       ├── orders/track.ts
│   │       ├── stock/[variantId].ts
│   │       ├── payments/         # create, webhook, status
│   │       ├── fraud/check.ts
│   │       └── staff/            # login, orders, returns, api-keys, ...
│   ├── do/                       # Durable Objects
│   │   ├── variant-inventory-do.ts
│   │   ├── idempotency-do.ts
│   │   ├── budget-counter-do.ts
│   │   └── waf-rules.ts
│   ├── queues/
│   │   └── consumers.ts          # 5 queue handlers
│   ├── lib/                      # Business logic
│   │   ├── env.ts · dates.ts · phone.ts · money.ts
│   │   ├── checkout-pricing.ts   # Server-authoritative pricing
│   │   ├── inventory.ts          # Reservation-first engine
│   │   ├── orders.ts · payments.ts · fraud.ts
│   │   ├── sessions.ts · security.ts · rbac.ts · audit.ts
│   │   ├── order-state-machine.ts
│   │   ├── session-blacklist.ts
│   │   ├── coupon-rate-limit.ts
│   │   ├── image-resizing.ts     # R2 Image Resizing helper
│   │   ├── cache-api.ts          # SWR + cache-tag purge
│   │   ├── autocomplete-index.ts
│   │   ├── pii-scrubber.ts
│   │   ├── content-moderation.ts
│   │   ├── ai-client.ts          # Workers AI + DeepSeek
│   │   ├── email.ts              # Resend client
│   │   ├── turnstile.ts
│   │   ├── cron-dispatch.ts
│   │   ├── csp-hashes.ts         # Build-time CSP allow-list
│   │   └── maintenance/          # backup, archive, inventory-reconcile
│   ├── components/               # Astro components
│   ├── islands/                  # React islands (cart, checkout, nav)
│   ├── data/                     # Build-time snapshots + fallback catalog
│   ├── layouts/ · styles/ · hooks/
│   └── generated/                # Build-time artifacts (csp-hashes)
├── db/migrations/                # 12 SQL migrations
│   └── rollback/                 # Paired rollbacks
├── docs/                         # alerting · csp · dr · logpush · zero-trust
├── scripts/                      # build · bundlewatch · cwv · migrate · seed
├── tests/                        # 21 Vitest files · 211 tests
├── astro.config.mjs              # CSP-hashes Vite plugin
├── wrangler.jsonc                # bindings, DOs, queues, env, triggers
└── package.json
```

---

## Database Schema

22 tables across 12 migrations. D1 is the source of truth; DOs hold only short-lived concurrency state.

| # | Table | Purpose |
|---|-------|---------|
| 1 | `schema_migrations` | Migration tracking |
| 2 | `staff_users` | Admin accounts with RBAC |
| 3 | `staff_sessions` | HMAC-hashed session tokens |
| 4 | `categories` | Product categories (hierarchical) |
| 5 | `products` | Product catalog |
| 6 | `product_variants` | SKU, size, color variants (soft-delete) |
| 7 | `product_images` | R2 references with compression status |
| 8 | `inventory_items` | Quantity + reserved_quantity |
| 9 | `coupons` | Discount codes (fixed/percentage, soft-delete) |
| 10 | `coupon_brute_force` | 5-failure / 30-min lockout tracking |
| 11 | `coupon_claim_tokens` | Atomic claim tokens |
| 12 | `fraud_checks` | FraudBD risk results |
| 13 | `orders` | Guest orders |
| 14 | `order_items` | Snapshot at checkout |
| 15 | `order_status_history` | Status audit trail |
| 16 | `return_requests` | Customer returns (approved/rejected/pending) |
| 17 | `stock_reservations` | 10-min reservation locks |
| 18 | `stock_adjustments` | Inventory delta audit (returns, restocks) |
| 19 | `payments` | UddoktaPay records |
| 20 | `payment_events` | Webhook idempotency |
| 21 | `email_log` | Resend delivery tracking |
| 22 | `low_stock_alerts` | Over-allocated stock incidents |
| 23 | `site_settings` | Admin key-value store |
| 24 | `audit_log` | Tamper-evident staff action trail |
| 25 | `checkout_idempotency` | Idempotency key store |
| 26 | `fraud_polls` | Async fraud resolution |
| 27 | `session_blacklist` | Mirror of KV revocations |
| 28 | `api_keys` | Owner-only dev key registry |
| 29 | `products_fts` | FTS5 virtual table (5-stage triggers) |

Migrations are applied in order; each has a paired rollback in `db/migrations/rollback/`.

---

## API Endpoints

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `POST` | `/api/checkout` | Guest checkout (idempotent, server-authoritative pricing) | Turnstile |
| `POST` | `/api/orders/track` | Order lookup by phone + number | — |
| `GET` | `/api/stock/:variantId` | Stock badge (CDN-cached) | — |
| `GET` | `/api/search?q=…` | FTS5 product search with snippets | — |
| `POST` | `/api/payments/create` | Initiate UddoktaPay checkout | — |
| `POST` | `/api/payments/webhook` | UddoktaPay notification (queue-backed) | UddoktaPay |
| `GET` | `/api/payments/status/:id` | Payment status (server-to-server verified) | — |
| `POST` | `/api/fraud/check` | FraudBD risk assessment | — |
| `POST` | `/api/staff/login` | Staff auth (Turnstile) | Turnstile |
| `POST` | `/api/staff/logout` | Session invalidation | staff |
| `GET` `POST` | `/api/staff/api-keys` | Owner-only dev key registry | owner |
| `POST` | `/api/staff/orders/:id/confirm` | Order confirmation | staff |
| `POST` | `/api/staff/uploads` | Image upload (R2 + Tinify) | staff |
| `POST` | `/api/staff/returns` | Create return request | `orders.update` |
| `POST` | `/api/staff/returns/:id/approve` | Approve + restock + refund | `payments.refund` |
| `POST` | `/api/staff/returns/:id/reject` | Reject return | `orders.update` |

---

## Security Model

- **CSP** — `script-src 'self' 'nonce-{N}' 'strict-dynamic' {sha256-...}`. Per-request nonce + build-time allow-list of emitted scripts. No `unsafe-inline` at the perimeter.
- **CSRF** — Double-submit cookie. The CSRF token is a session-independent `nonce.HMAC(nonce)` signed with `SESSION_SECRET`. It never embeds the session token or its hash, so an XSS that reads the non-HttpOnly `csrf-token` cookie cannot recover the session.
- **__Host- cookies** — Both `__Host-session` and `__Host-csrf-token` are bound to the exact host over HTTPS only.
- **Checkout pricing** — `price_paisa` is loaded from D1; subtotal, delivery, discount, and total are recomputed server-side. Browser-supplied money fields are ignored.
- **Coupon atomicity** — Limited-use coupons are claimed atomically (`applyCouponAtomic`); on subsequent failure they are released (`releaseCouponUsageAtomic`).
- **Payment initiation race prevention** — `payment_status = 'processing'` is set atomically before calling UddoktaPay, preventing duplicate active invoices. Provider failure resets status back to `pending`.
- **Webhook FK safety** — Amount-mismatch alerts resolve an actual `variant_id` from `order_items`, never inject `order_id` into `variant_id`.
- **Sessions** — Raw token in HttpOnly Secure SameSite=Strict cookie; only the HMAC hash is stored in D1.
- **RBAC** — 6-role hierarchy enforced on every staff API route via `requirePermission(user, "perm")`.
- **Rate limiting** — KV sliding window on all public endpoints.
- **Headers** — HSTS preload, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- **Origin validation** — login and checkout mutations check the `Origin` header.
- **Money** — All amounts are INTEGER paisa — no floating point anywhere.

---

## Deployment

### Prerequisites

1. Cloudflare account with:
   - D1 database `zabir-db`
   - KV namespaces `CACHE` and `SESSION`
   - R2 buckets `zabir-media` and `zabir-backups`
   - Queues: `payment-webhooks`, `order-emails`, `image-processing`, `fraud-scoring`, `d1-backup`
   - Durable Object migrations: `v1` (VariantInventoryDO + IdempotencyDO) and `v2` (BudgetCounterDO + WafRules)
2. External accounts: UddoktaPay, FraudBD, Tinify, Resend, Turnstile, DeepSeek, OpenAI-compatible endpoint

### Secrets

Set via `wrangler secret put` (never commit):

| Secret | Description |
|--------|-------------|
| `SESSION_SECRET` | HMAC for sessions + CSRF |
| `PASSWORD_PEPPER` | PBKDF2 password pepper |
| `TINIFY_API_KEY` | Image compression |
| `UDDOKTAPAY_API_KEY` | Payment gateway |
| `UDDOKTAPAY_BASE_URL` | e.g. `https://sandbox.uddoktapay.com` |
| `FRAUDBD_API_KEY` | Fraud scoring |
| `RESEND_API_KEY` | Transactional email |
| `TURNSTILE_SECRET_KEY` | Bot defense |
| `AI_FALLBACK_KEY` | DeepSeek API key |
| `AI_FALLBACK_URL` | DeepSeek endpoint |
| `CF_API_TOKEN` | Cloudflare API token (cache purges) |
| `CF_ZONE_ID` | Cloudflare zone (cache purges) |

### Build & deploy

```bash
# Apply migrations
npm run db:migrate:prod

# Build (D1 snapshots + Astro + bundlewatch)
npm run build

# Deploy
npm run deploy
```

### Environments

`wrangler.jsonc` defines three:

| Environment | Command | Purpose |
|-------------|---------|---------|
| `main` (default) | `wrangler deploy` | Production |
| `staging` | `wrangler deploy --env staging` | Pre-production mirror of prod |
| `dev` | `wrangler deploy --env dev` | Internal experiments |

### CI/CD

Two GitHub Actions workflows:

- `ci.yml` — runs on PRs: typecheck, vitest, build verification
- `deploy.yml` — runs on push to `main`: typecheck, vitest, production build, deploy via wrangler-action

DR runbook in [`docs/disaster-recovery.md`](docs/disaster-recovery.md).

---

## Operations

### Monitoring

- **Workers Analytics Engine** — `ANALYTICS` dataset, indexes on `task`, `action`, `variant_id`
- **Logpush → R2** — every 6h archive; PII scrubber applied (see [`docs/logpush.md`](docs/logpush.md))
- **Alerting rules** — see [`docs/alerting.md`](docs/alerting.md)

### Performance

- **Bundle size** — `npm run bundlewatch` enforces a 350KB gz total budget (`scripts/bundlewatch.mjs`)
- **Core Web Vitals** — `npm run cwv` asserts HTML size, inline-script count, and LCP hints against `scripts/cwv-budget.config.json`
- **Cache hit rate** — verified via Cloudflare Analytics; SWR keeps product pages warm

### Security

- **Zero Trust Access** for `/staff/*` — config guide in [`docs/zero-trust.md`](docs/zero-trust.md)
- **WAF custom ruleset** — versioned in `WafRulesDO`; rules cover staff brute-force, checkout throttling, bad-bot UA, and admin-path probes

### Backups

- **D1 → R2** every 6h; retention 30 days
- **Restore** via `db/migrations/rollback/` runbook (see [`docs/disaster-recovery.md`](docs/disaster-recovery.md))
- **Verification** cron Sundays 09:00 UTC

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Astro dev server |
| `npm run build` | Snapshots + build + bundlewatch |
| `npm run build:snapshots` | Generate D1 snapshots only |
| `npm run build:with-snapshots` | Snapshots + build (no bundlewatch) |
| `npm run build:skip-snapshots` | Build only (no snapshots, no bundlewatch) |
| `npm run preview` | Preview production build locally |
| `npm run typecheck` | `astro check` + `tsc --noEmit` |
| `npm test` | Vitest test suite (211 tests) |
| `npm run test:watch` | Vitest watch mode |
| `npm run bundlewatch` | Assert JS bundle budget |
| `npm run bundlewatch:update` | Reset budget to current sizes + 5% headroom |
| `npm run cwv` | Assert Core Web Vitals proxies |
| `npm run migrate` | Apply pending D1 migrations |
| `npm run migrate:status` | Show applied/pending |
| `npm run migrate:rollback-last` | Roll back the most recent migration |
| `npm run db:migrate:local` | Apply migrations to local D1 |
| `npm run db:migrate:prod` | Apply migrations to remote D1 |
| `npm run deploy` | Build + deploy to Cloudflare Pages |

---

## Testing

**211 tests across 21 files** covering:

- Phone normalization (Bangladesh formats)
- Inventory reservation atomicity and race conditions
- Checkout server-authoritative pricing (price/discount/total tampering, coupon race, order-item snapshot)
- Payment webhook with `paid_over_allocated` handling
- Paid + expired reservation handling
- Session token management
- CSRF token verification (`nonce.HMAC(nonce)` format, tampering, legacy-format rejection)
- RBAC matrix + staff menu
- Order state machine (transition table + side effects)
- API keys + role-based dev access
- Phase 12 extended coverage (audit, prepay, schema naming)
- Media access
- Cron import isolation
- Content moderation (PII, keyword, vendor-pitch blocks)
- KV-backed autocomplete index
- Schema naming conventions
- Race conditions and concurrency

```bash
npm test            # one-shot
npm run test:watch  # watch mode
```

---

## Documentation

Detailed operational guides in [`docs/`](docs/):

- [`docs/disaster-recovery.md`](docs/disaster-recovery.md) — RPO/RTO, backup/restore runbook
- [`docs/csp.md`](docs/csp.md) — CSP per-nonce model + inline-script migration status
- [`docs/zero-trust.md`](docs/zero-trust.md) — Cloudflare Access for staff routes
- [`docs/logpush.md`](docs/logpush.md) — Logpush configuration + PII scrubber
- [`docs/alerting.md`](docs/alerting.md) — Critical-metric alerting rules

Top-level references:

- [`CHANGELOG.md`](CHANGELOG.md) — release notes for v7.0.0 (the audit-fix
  release) and v6.8.0
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — pre-deploy checklist, secret
  rotation, smoke tests, rollback runbook
- [`AGENTS.md`](AGENTS.md) — agent rules (architecture overview,
  guardrails, graphify)

---

## Guardrails

These are non-negotiable:

- D1 is SQLite — use only SQLite-compatible syntax
- All money values are INTEGER paisa — no floating-point money
- Checkout never trusts KV, CDN, or browser data for stock or price — uses fresh D1 reads and conditional updates
- Never create order rows before `reserveVariants()` succeeds
- Public stock badge API must NOT write KV
- UddoktaPay paid status requires server-to-server verification
- Store only HMAC-SHA256 hashes of staff session tokens
- The CSRF token must be a session-independent `nonce.HMAC(nonce)` — never `sessionToken.hash`
- All non-GET staff mutations require CSRF
- Every state-mutating staff action goes through `writeAuditLog`
- Durable Objects hold concurrency state only — D1 is the source of truth

---

## License

Proprietary — Zabir Boutiques. All rights reserved.

---

<div align="center">
Built with <a href="https://astro.build">Astro</a> · <a href="https://cloudflare.com">Cloudflare</a> · <a href="https://typescriptlang.org">TypeScript</a>
</div>
