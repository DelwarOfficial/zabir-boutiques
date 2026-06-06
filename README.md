<div align="center">
  <img src="public/assets/zabir-logo.jpg" alt="Zabir Boutiques" width="120" height="120" style="border-radius: 50%;" />
  <br />
  <h1 align="center">Zabir Boutiques — AI Commerce Platform</h1>
  <p align="center"><strong>v6.8B · Security Audit Patch Edition</strong> · Cloudflare-Native · Bangladesh F-Commerce</p>

  [![Astro](https://img.shields.io/badge/Astro-5.9-FF5D01?logo=astro)](https://astro.build)
  [![Cloudflare](https://img.shields.io/badge/Cloudflare-Pages+Workers-F38020?logo=cloudflare)](https://pages.cloudflare.com)
  [![D1](https://img.shields.io/badge/Database-D1-3B82F6?logo=cloudflare)](https://developers.cloudflare.com/d1/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)](https://www.typescriptlang.org)
  [![Vitest](https://img.shields.io/badge/Tests-111%20passing-6E9F18?logo=vitest)](https://vitest.dev)
  [![License](https://img.shields.io/badge/License-Proprietary-64748B)](LICENSE)
</div>

---

Premium boutique fashion e-commerce platform for Wari, Dhaka — purpose-built for the Bangladesh market. COD-first checkout with FraudBD risk routing, UddoktaPay payment gateway, real-time inventory reservation, and a full staff operations dashboard.

> **Package version:** `6.8.0` · **Spec edition:** v6.8B Security Audit Patch (server-authoritative checkout pricing + session-independent CSRF tokens).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare Pages                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Astro SSG   │  │  Astro SSR   │  │  API (Workers)    │  │
│  │ (index, cat, │  │ (checkout,   │  │ (/api/*)          │  │
│  │  product)    │  │  order-track,│  │                   │  │
│  │              │  │  staff/*)    │  │                   │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘  │
│         │                 │                    │             │
│         ▼                 ▼                    ▼             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Cloudflare D1 (SQLite)                   │   │
│  │  21 tables — inventory, orders, payments, fraud      │   │
│  └──────────────────────────────────────────────────────┘   │
│         │                 │                    │             │
│         ▼                 ▼                    ▼             │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  R2      │    │  KV          │    │  Scheduled       │  │
│  │ (media,  │    │ (cache,      │    │  Workers (cron)  │  │
│  │ backup)  │    │  rate-limit) │    │  maintenance     │  │
│  └──────────┘    └──────────────┘    └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | Astro 5 (`output: static` + on-demand routes) | Static-first pages; API/SSR routes opt in via `export const prerender = false` |
| **Adapter** | `@astrojs/cloudflare` | Cloudflare Workers runtime |
| **Database** | Cloudflare D1 (SQLite) | Source of truth, transactional |
| **Media** | Cloudflare R2 | Product images, backups, archives |
| **Cache** | Cloudflare KV | Admin-cached listings, rate limits, sessions binding |
| **Payments** | UddoktaPay | Server-to-server verification |
| **Fraud** | FraudBD | External risk signal only |
| **Images** | Tinify | Upload-time compression |

> Astro 5 removed `output: "hybrid"`. The project uses `output: "static"`, which behaves identically: pages are static by default and any route that needs server execution opts in with `export const prerender = false`.

## Features

### Storefront
- **Static-first** — Home, category, and product pages are SSG from build-time D1 snapshots
- **CDN-cached stock badges** — Real-time stock read from D1 with CDN cache headers (zero KV writes on public traffic)
- **Guest checkout** — Name, phone, address only. No account required.
- **Server-authoritative pricing** — The checkout API never trusts browser-supplied money fields. Subtotal, delivery, discount, and total are computed from D1 `price_paisa` only (v6.8B fix #2)
- **Idempotent checkout** — Idempotency key prevents duplicate orders on network retry
- **Max 10 line items** — Enforced server-side

### Inventory
- **Reservation-first engine** — Stock is reserved (not deducted) at checkout time
- **30-minute reservation expiry** — Released by cron if payment not completed
- **Atomic batch operations** — `db.batch()` with `meta.changes` verification
- **Partial failure rollback** — All successful reservations released if any one fails
- **Never creates order before reservation success** — Guardrail enforced

### Payments
- **UddoktaPay** — Bangladesh payment gateway
- **Server-to-server verification** — Browser redirects never mark order paid
- **Webhook idempotency** — `INSERT OR IGNORE` with `UNIQUE(invoice_id, event_type, status)`
- **`paid_over_allocated` fallback** — Graceful handling when stock runs out between checkout and payment
- **Forward-only status transitions** — No backward status changes

### Fraud Prevention
- **FraudBD risk scoring** — External API, 3-second timeout
- **Risk routing** — 0-30 approved, 31-79 review, 80-100 blocked
- **Timeout/error = review** — Never auto-blocks on API failure
- **Async fraud polling** — `fraud_polls` table with cron-based resolution

### Staff Operations
- **RBAC** — 6 roles with hierarchical permissions (see below)
- **HMAC-SHA256 sessions** — Only hashed tokens stored in D1
- **CSRF protection** — Double-submit cookie with a session-independent `nonce.HMAC(nonce)` token (v6.8B fix #3)
- **Audit log** — All state mutations recorded

### Security
- CSP, HSTS, frame-ancestors, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- Origin validation on login
- Rate limiting on all public API routes
- All money values are INTEGER paisa (no floating point)

### Cron & Maintenance
Cron triggers are declared in `wrangler.jsonc` (`triggers.crons`) and routed by `src/lib/cron-dispatch.ts`.

| Cron expression | Frequency | Job |
|-----------------|-----------|-----|
| `*/10 * * * *` | Every 10 min | Expired reservation cleanup + FraudBD poll sweep |
| `0 3 * * *` | Daily 03:00 UTC | Session cleanup + Tinify retry + idempotency expiry |
| `0 4 * * 0` | Weekly Sun 04:00 | D1 backup to R2 |
| `0 5 1 * *` | Monthly 1st 05:00 | Archive old events/logs to R2 |

## Role-Based Access Control

Server-side enforcement only (route splitting and menu hiding are **not** authorization). The matrix lives in `src/lib/rbac.ts`.

| Role | Tier | Access |
|------|------|--------|
| `super_admin` | Owner-tier | Full system access (alias of owner) |
| `owner` | Owner-tier | Full system access — every permission implicitly |
| `manager` | Business | Daily operations: products, categories, inventory, orders, fraud view, media, reports |
| `salesman` | Business | Sales dashboard + COD order creation/updates |
| `packing` | Business | Packing queue + courier handoff (pack/ship) |
| `support` | Business | Order search + support notes |

Owner-only areas (developer/API-code, secrets, backups) are gated by `assertOwnerOnly()` plus a specific permission such as `system.api_code.manage`.

## Quick Start

```bash
# Prerequisites: Node.js 20+, Cloudflare account, Wrangler

git clone https://github.com/DelwarOfficial/zabir-boutiques.git
cd zabir-boutiques

# Install dependencies
npm install

# Copy environment
cp .env.example .env.local
# Edit .env.local with your Cloudflare credentials

# Run D1 migrations locally
npm run db:migrate:local

# Seed sample data (optional)
npx tsx scripts/seed.ts

# Start development server
npm run dev
```

## Project Structure

```
zabir-boutiques/
├── src/
│   ├── entry-cloudflare.ts    # Worker cron entry point (scheduled handler)
│   ├── env.d.ts               # Cloudflare runtime type definitions (Env)
│   ├── middleware.ts          # CSRF + rate limiting + security headers
│   ├── pages/
│   │   ├── index.astro        # Homepage (SSG)
│   │   ├── checkout.astro     # Guest checkout (React island host)
│   │   ├── order-track.astro  # Order tracking
│   │   ├── orders.astro       # Order lookup
│   │   ├── categories/
│   │   │   └── [slug].astro   # Category listing (SSG)
│   │   ├── products/
│   │   │   └── [slug].astro   # Product detail (SSG)
│   │   ├── staff/
│   │   │   ├── index.astro    # Dashboard
│   │   │   ├── login.astro    # Staff login page
│   │   │   └── orders/
│   │   │       └── [id].astro # Order detail
│   │   └── api/
│   │       ├── checkout.ts
│   │       ├── orders/track.ts
│   │       ├── stock/[variantId].ts
│   │       ├── payments/
│   │       │   ├── create.ts
│   │       │   ├── webhook.ts
│   │       │   └── status/[id].ts
│   │       ├── fraud/check.ts
│   │       └── staff/
│   │           ├── login.ts
│   │           ├── logout.ts
│   │           ├── uploads.ts
│   │           ├── api-code/index.ts      # Owner-only API-code area
│   │           └── orders/[id]/confirm.ts
│   ├── lib/
│   │   ├── env.ts             # Runtime env accessor
│   │   ├── dates.ts           # UTC timestamp (nowSql)
│   │   ├── phone.ts           # Bangladesh phone normalization
│   │   ├── money.ts           # INTEGER paisa arithmetic, coupons
│   │   ├── checkout-pricing.ts # Server-authoritative checkout pricing (v6.8B)
│   │   ├── inventory.ts       # Reservation-first engine
│   │   ├── orders.ts          # Order creation with retry
│   │   ├── payments.ts        # UddoktaPay integration
│   │   ├── fraud.ts           # FraudBD risk routing
│   │   ├── sessions.ts        # HMAC-SHA256 staff auth
│   │   ├── security.ts        # CSRF tokens + timing-safe comparison
│   │   ├── rbac.ts            # Role-based access control
│   │   ├── staff-menu.ts      # Permission-driven staff menu
│   │   ├── audit.ts           # Audit log writer + request helpers
│   │   ├── cache.ts           # KV utilities
│   │   ├── cart-store.ts      # Client cart store helpers
│   │   ├── idempotency.ts     # Checkout idempotency
│   │   ├── tinify.ts          # Image compression pipeline
│   │   ├── cron-dispatch.ts   # Scheduled job router
│   │   └── maintenance/
│   │       ├── backup.ts
│   │       ├── archive.ts
│   │       └── idempotency.ts
│   ├── components/
│   │   ├── product/           # ProductCard
│   │   ├── checkout/          # CheckoutSkeleton
│   │   ├── staff/
│   │   ├── shared/
│   │   └── shell/             # Header, Footer, CategoryRail, ProductGridSkeleton
│   ├── islands/               # React islands
│   │   ├── GuestCheckout.tsx
│   │   ├── AddToCartButton.tsx
│   │   └── BottomNav.tsx
│   ├── hooks/
│   │   └── useLocalCart.ts
│   ├── data/
│   │   ├── catalog.ts             # Snapshot/fallback resolver
│   │   ├── category-taxonomy.ts   # Category filter taxonomy
│   │   ├── demo-products.ts       # Fallback data for dev
│   │   ├── categories-snapshot.json  # Build-time D1 snapshot
│   │   └── products-snapshot.json    # Build-time D1 snapshot
│   ├── layouts/
│   │   └── RootLayout.astro
│   └── styles/
│       └── global.css
├── db/
│   └── migrations/
│       ├── 0001_initial_v6_8a_schema.sql  # 21 tables
│       └── 0002_indexes.sql               # Performance indexes
├── scripts/
│   ├── build-static-snapshots.ts  # D1 REST API snapshot generator
│   └── seed.ts                    # Sample data seeder
├── tests/                         # 111 Vitest tests across 14 files
│   ├── checkout.test.ts
│   ├── security.test.ts
│   ├── csrf.test.ts
│   ├── rbac.test.ts
│   ├── staff-menu.test.ts
│   ├── sessions.test.ts
│   ├── inventory.test.ts
│   ├── payments.test.ts
│   ├── fraud.test.ts
│   ├── phone.test.ts
│   ├── race-conditions.test.ts
│   ├── paid-expired-reservation.test.ts
│   ├── cron-imports.test.ts
│   └── schema-naming.test.ts
├── astro.config.mjs
├── wrangler.jsonc
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Database (D1 Schema)

All 21 tables (migration `0001_initial_v6_8a_schema.sql`):

| # | Table | Purpose |
|---|-------|---------|
| 1 | `schema_migrations` | Migration tracking |
| 2 | `staff_users` | Admin accounts with RBAC roles |
| 3 | `staff_sessions` | HMAC-hashed session tokens |
| 4 | `categories` | Product categories (hierarchical) |
| 5 | `products` | Product catalog |
| 6 | `product_variants` | SKU, size, color variants (soft-delete) |
| 7 | `product_images` | R2 image references with compression status |
| 8 | `inventory_items` | Quantity + reserved_quantity (is_available) |
| 9 | `coupons` | Discount codes (fixed/percentage, soft-delete) |
| 10 | `fraud_checks` | FraudBD risk results |
| 11 | `orders` | Guest orders with fraud/payment status |
| 12 | `order_items` | Snapshot at checkout time |
| 13 | `stock_reservations` | 30-minute reservation locks |
| 14 | `order_status_history` | Status change audit trail |
| 15 | `payments` | Payment records linked to UddoktaPay |
| 16 | `payment_events` | Webhook idempotency |
| 17 | `low_stock_alerts` | Over-allocated stock incidents |
| 18 | `site_settings` | Admin-configurable key-value store |
| 19 | `audit_log` | Staff action audit trail |
| 20 | `checkout_idempotency` | Idempotency key store |
| 21 | `fraud_polls` | Async fraud resolution polling |

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/checkout` | Guest checkout (idempotent, server-authoritative pricing) |
| `POST` | `/api/orders/track` | Order lookup by phone + number |
| `GET` | `/api/stock/:variantId` | Stock badge (CDN-cached, no KV write) |
| `POST` | `/api/payments/create` | Initiate UddoktaPay checkout |
| `POST` | `/api/payments/webhook` | UddoktaPay payment notification |
| `GET` | `/api/payments/status/:id` | Payment status lookup |
| `POST` | `/api/fraud/check` | FraudBD risk assessment |
| `POST` | `/api/staff/login` | Staff authentication |
| `POST` | `/api/staff/logout` | Staff session invalidation |
| `POST` | `/api/staff/orders/:id/confirm` | Order confirmation (RBAC) |
| `POST` | `/api/staff/uploads` | Image upload (R2 + Tinify) |
| `GET` `POST` | `/api/staff/api-code` | Owner-only API-code area (key names only, never secret values) |

## Security

- **CSRF**: Double-submit cookie. The CSRF token is a session-independent `nonce.HMAC(nonce)` (random nonce signed with `SESSION_SECRET`), verified with timing-safe comparison. It never embeds the session token or its hash, so an XSS that reads the non-HttpOnly `csrf-token` cookie cannot recover the session token. *(v6.8B fix #3)*
- **Checkout pricing**: The server loads `price_paisa` from D1 and computes subtotal, delivery, discount (coupons only, via `applyCouponAtomic`), and total. Browser-supplied money fields are ignored. *(v6.8B fix #2)*
- **Sessions**: Raw token in HttpOnly Secure SameSite=Strict cookie; only the HMAC hash is stored in D1
- **RBAC**: 6-role hierarchy enforced on every staff API route
- **Rate limiting**: KV-backed sliding window on public API endpoints
- **Headers**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **Origin validation**: Login endpoint checks the Origin header
- **Money**: All amounts are INTEGER paisa — no floating point anywhere

## Deployment

### Prerequisites

1. Cloudflare account with:
   - D1 database (`zabir-db`)
   - KV namespaces (`CACHE`, `SESSION`)
   - R2 buckets (`zabir-media`, `zabir-backups`)
2. External service accounts: UddoktaPay, FraudBD, Tinify

### Environment Variables

Set these via `wrangler secret put` (never in `.env`):

| Secret | Description |
|--------|-------------|
| `SESSION_SECRET` | HMAC key for session tokens + CSRF |
| `TINIFY_API_KEY` | Image compression API key |
| `UDDOKTAPAY_API_KEY` | Payment gateway API key |
| `UDDOKTAPAY_BASE_URL` | `https://sandbox.uddoktapay.com` (dev) |
| `FRAUDBD_API_KEY` | Fraud scoring API key |
| `DEEPSEEK_API_KEY` | AI feature API key |
| `OPENAI_API_KEY` | AI feature API key |

Build-time variables (set in CI):

| Variable | Description |
|----------|-------------|
| `CF_ACCOUNT_ID` | Cloudflare account ID |
| `CF_D1_DATABASE_ID` | D1 database ID |
| `CF_D1_READ_TOKEN` | D1 read-only API token |

### Deploy

Deploy via **Cloudflare Pages native Git integration** (recommended):

1. Push to `main` → Cloudflare auto-builds + deploys
2. PRs automatically get preview URLs

Or manually via CLI:

```bash
# Build with D1 snapshots
CF_ACCOUNT_ID=xxx CF_D1_DATABASE_ID=xxx CF_D1_READ_TOKEN=xxx npm run build:with-snapshots

# Deploy to Cloudflare Pages
wrangler pages deploy dist --project-name zabir-boutiques
```

### CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs quality checks on every push and PR:
- TypeScript type checking (`npm run typecheck`)
- 111 Vitest tests (`npm test`)
- Build verification (`npm run build:with-snapshots`, with D1 snapshots if secrets are available)

Deployment is handled by **Cloudflare Pages native Git integration** — push to `main` and Cloudflare builds + deploys automatically. No API tokens to manage in GitHub.

### Cloudflare Pages Setup

1. Go to **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git**
2. Select your GitHub repo (`DelwarOfficial/zabir-boutiques`)
3. Set build configuration:

   | Setting | Value |
   |---------|-------|
   | Build command | `npm run build:with-snapshots` |
   | Build output | `dist` |
   | Root directory | `/` |
   | Node.js version | `20` |

4. Add environment variables (must be **Encrypted** for secrets):

   | Variable | Type | Description |
   |----------|------|-------------|
   | `CF_ACCOUNT_ID` | Plain text | Your Cloudflare account ID |
   | `CF_D1_DATABASE_ID` | Plain text | D1 database ID (`zabir-db`) |
   | `CF_D1_READ_TOKEN` | Encrypted (secret) | D1 read-only API token |
   | `SESSION_SECRET` | Encrypted (secret) | HMAC key for sessions + CSRF |
   | `TINIFY_API_KEY` | Encrypted (secret) | Image compression |
   | `UDDOKTAPAY_API_KEY` | Encrypted (secret) | Payment gateway |
   | `UDDOKTAPAY_BASE_URL` | Plain text | `https://sandbox.uddoktapay.com` |
   | `FRAUDBD_API_KEY` | Encrypted (secret) | Fraud scoring |
   | `DEEPSEEK_API_KEY` | Encrypted (secret) | AI features |
   | `OPENAI_API_KEY` | Encrypted (secret) | AI features |

5. Deploy — first build may take 2-3 minutes. Every push to `main` auto-deploys.

**PR previews** are automatic — Cloudflare creates a unique URL for every PR.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Astro dev server |
| `npm run build` | Generate D1 snapshots + Astro production build |
| `npm run build:snapshots` | Generate D1 snapshots only |
| `npm run build:with-snapshots` | Snapshots + build (used by CI and `deploy`) |
| `npm run build:skip-snapshots` | Astro build without regenerating snapshots |
| `npm run preview` | Preview production build locally |
| `npm run typecheck` | `astro check` + `tsc --noEmit` |
| `npm test` | Run Vitest test suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run db:migrate:local` | Apply migrations to local D1 |
| `npm run db:migrate:prod` | Apply migrations to remote D1 |
| `npm run deploy` | Build (with snapshots) + deploy to Cloudflare Pages |

## Testing

**111 tests across 14 files** covering:

- Phone normalization (Bangladesh formats)
- Inventory reservation atomicity and race conditions
- Checkout server-authoritative pricing (price/discount/total tampering, coupon race, order-item snapshot)
- Payment webhook with `paid_over_allocated` handling
- Paid + expired reservation handling
- Session token management
- CSRF token verification (`nonce.HMAC(nonce)` format, tampering, legacy-format rejection)
- RBAC matrix + staff menu
- Schema naming conventions
- Cron import isolation

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

## Guardrails

- D1 is SQLite — use only SQLite-compatible syntax
- All money values are INTEGER paisa — no floating-point money
- Checkout never trusts KV, CDN, or browser data for stock or price — uses fresh D1 reads/conditional updates
- Never create order rows before `reserveVariants()` succeeds
- Public stock badge API must NOT write KV
- UddoktaPay paid status requires server-to-server verification
- Store only HMAC-SHA256 hashes of staff session tokens
- The CSRF token must be a session-independent `nonce.HMAC(nonce)` — never `sessionToken.hash`
- All non-GET staff mutations require CSRF

## License

Proprietary — Zabir Boutiques. All rights reserved.

---

Built with [Astro](https://astro.build) · [Cloudflare](https://cloudflare.com) · [TypeScript](https://typescriptlang.org)
