<div align="center">
  <img src="public/assets/zabir-logo.jpg" alt="Zabir Boutiques" width="120" height="120" style="border-radius: 50%;" />
  <br />
  <h1 align="center">Zabir Boutiques — AI Commerce Platform</h1>
  <p align="center"><strong>v6.8A</strong> · Cloudflare-Native · Bangladesh F-Commerce</p>

  [![Astro](https://img.shields.io/badge/Astro-5.9-FF5D01?logo=astro)](https://astro.build)
  [![Cloudflare](https://img.shields.io/badge/Cloudflare-Pages+Workers-F38020?logo=cloudflare)](https://pages.cloudflare.com)
  [![D1](https://img.shields.io/badge/Database-D1-3B82F6?logo=cloudflare)](https://developers.cloudflare.com/d1/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)](https://www.typescriptlang.org)
  [![Vitest](https://img.shields.io/badge/Tests-Vitest-6E9F18?logo=vitest)](https://vitest.dev)
  [![License](https://img.shields.io/badge/License-Proprietary-64748B)](LICENSE)
</div>

---

Premium boutique fashion e-commerce platform for Wari, Dhaka — purpose-built for the Bangladesh market. COD-first checkout with FraudBD risk routing, UddoktaPay payment gateway, real-time inventory reservation, and a full staff operations dashboard.

## Architecture (v6.8A)

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
| **Framework** | Astro 5 (`output: static` + SSR routes) | Static-first pages, API routes |
| **Adapter** | `@astrojs/cloudflare` | Cloudflare Workers runtime |
| **Database** | Cloudflare D1 (SQLite) | Source of truth, transactional |
| **Media** | Cloudflare R2 | Product images, backups, archives |
| **Cache** | Cloudflare KV | Admin-cached listings, rate limits |
| **Payments** | UddoktaPay | Server-to-server verification |
| **Fraud** | FraudBD | External risk signal only |
| **Images** | Tinify | Upload-time compression |

## Features

### Storefront
- **Static-first** — Home, category, and product pages are SSG from build-time D1 snapshots
- **CDN-cached stock badges** — Real-time stock read from D1 with CDN cache headers (zero KV writes on public traffic)
- **Guest checkout** — Name, phone, address only. No account required.
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
- **RBAC** — 7 roles (super_admin → viewer) with hierarchical permissions
- **HMAC-SHA256 sessions** — Only hashed tokens stored in D1
- **CSRF protection** — Double-submit cookie pattern with timing-safe HMAC verification
- **Audit log** — All state mutations recorded

### Security
- CSP, HSTS, frame-ancestors, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- Origin validation on login
- Rate limiting on all public API routes
- All money values are INTEGER paisa (no floating point)

### Cron & Maintenance
| Frequency | Job |
|-----------|-----|
| Every 10 min | Expired reservation cleanup + FraudBD poll sweep |
| Daily 03:00 UTC | Session cleanup + Tinify retry + idempotency expiry |
| Weekly Sun 04:00 | D1 backup to R2 |
| Monthly 1st 05:00 | Archive old events/logs to R2 |

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
wrangler d1 execute zabir-db --local --file=db/seed.sql

# Start development server
npm run dev
```

## Project Structure

```
zabir-boutiques/
├── src/
│   ├── env.d.ts              # Cloudflare runtime type definitions
│   ├── middleware.ts          # CSRF + rate limiting + security headers
│   ├── pages/
│   │   ├── index.astro       # Homepage (SSG)
│   │   ├── checkout.astro    # Guest checkout (SSR, React island)
│   │   ├── order-track.astro # Order tracking (SSR)
│   │   ├── orders.astro      # Order lookup (SSR)
│   │   ├── categories/
│   │   │   └── [slug].astro  # Category listing (SSG)
│   │   ├── products/
│   │   │   └── [slug].astro  # Product detail (SSG)
│   │   ├── staff/
│   │   │   ├── index.astro   # Dashboard (SSR)
│   │   │   └── orders/
│   │   │       └── [id].astro # Order detail (SSR)
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
│   │           ├── orders/[id]/confirm.ts
│   │           └── uploads.ts
│   ├── lib/
│   │   ├── env.ts            # Runtime env accessor
│   │   ├── dates.ts          # UTC timestamp (nowSql)
│   │   ├── phone.ts          # Bangladesh phone normalization
│   │   ├── money.ts          # INTEGER paisa arithmetic, coupons
│   │   ├── inventory.ts      # Reservation-first engine
│   │   ├── orders.ts         # Order creation with retry
│   │   ├── payments.ts       # UddoktaPay integration
│   │   ├── fraud.ts          # FraudBD risk routing
│   │   ├── sessions.ts       # HMAC-SHA256 staff auth
│   │   ├── security.ts       # Timing-safe comparison
│   │   ├── rbac.ts           # Role-based access control
│   │   ├── cache.ts          # KV utilities
│   │   ├── idempotency.ts    # Checkout idempotency
│   │   ├── tinify.ts         # Image compression pipeline
│   │   ├── cron-dispatch.ts  # Scheduled job router
│   │   └── maintenance/
│   │       ├── backup.ts
│   │       ├── archive.ts
│   │       └── idempotency.ts
│   ├── components/
│   │   ├── product/
│   │   ├── checkout/
│   │   ├── staff/
│   │   ├── shared/
│   │   └── shell/            # Header, Footer, CategoryRail
│   ├── islands/              # React islands
│   │   ├── GuestCheckout.tsx
│   │   ├── AddToCartButton.tsx
│   │   └── BottomNav.tsx
│   ├── data/
│   │   ├── catalog.ts        # Snapshot/fallback resolver
│   │   ├── catalog.ts        # (snapshot JSON files — gitignored)
│   │   └── demo-products.ts  # Fallback data for dev
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
├── tests/                         # 71 Vitest tests
│   ├── checkout.test.ts
│   ├── csrf.test.ts
│   ├── fraud.test.ts
│   ├── inventory.test.ts
│   ├── payments.test.ts
│   ├── phone.test.ts
│   ├── sessions.test.ts
│   └── ...
├── astro.config.mjs
├── wrangler.jsonc
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Database (D1 Schema)

All 21 tables with canonical naming:

| Table | Purpose |
|-------|---------|
| `schema_migrations` | Migration tracking |
| `staff_users` | Admin accounts with RBAC roles |
| `staff_sessions` | HMAC-hashed session tokens |
| `categories` | Product categories (hierarchical) |
| `products` | Product catalog |
| `product_variants` | SKU, size, color variants |
| `product_images` | R2 image references with compression status |
| `inventory_items` | Quantity + reserved_quantity (is_available) |
| `coupons` | Discount codes (fixed/percentage) |
| `orders` | Guest orders with fraud/payment status |
| `order_items` | Snapshot at checkout time |
| `stock_reservations` | 30-minute reservation locks |
| `order_status_history` | Status change audit trail |
| `payments` | Payment records linked to UddoktaPay |
| `payment_events` | Webhook idempotency |
| `fraud_checks` | FraudBD risk results |
| `fraud_polls` | Async fraud resolution polling |
| `low_stock_alerts` | Over-allocated stock incidents |
| `site_settings` | Admin-configurable key-value store |
| `audit_log` | Staff action audit trail |
| `checkout_idempotency` | Idempotency key store |

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/checkout` | Guest checkout (idempotent) |
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

## Security

- **CSRF**: Double-submit cookie with HMAC-SHA256 verification and timing-safe comparison
- **Sessions**: Raw token in HttpOnly Secure SameSite=Strict cookie; only HMAC hash stored in D1
- **RBAC**: 7-role hierarchy enforced on every staff API route
- **Rate limiting**: KV-backed sliding window on all public API endpoints
- **Headers**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **Origin validation**: Login endpoint checks Origin header
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
- TypeScript type checking
- 71 Vitest tests
- Build verification (with D1 snapshots if secrets available)

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
   | `SESSION_SECRET` | Encrypted (secret) | HMAC key for sessions |
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
| `npm run build` | Astro production build |
| `npm run build:snapshots` | Generate D1 snapshots only |
| `npm run build:with-snapshots` | Snapshots + build |
| `npm run preview` | Preview production build locally |
| `npm run typecheck` | `astro check` + `tsc --noEmit` |
| `npm test` | Run Vitest test suite |
| `npm run db:migrate:local` | Apply migrations to local D1 |
| `npm run db:migrate:prod` | Apply migrations to remote D1 |
| `npm run deploy` | Build + deploy to Cloudflare Pages |

## Testing

71 tests across 11 test files covering:

- Phone normalization (Bangladesh formats)
- Inventory reservation atomicity
- Checkout idempotency and fraud routing
- Payment webhook with paid_over_allocated handling
- Race condition scenarios
- Session token management
- CSRF token verification
- Schema naming conventions
- Cron import isolation
- Expired reservation cleanup

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

## Guardrails

- D1 is SQLite — use only SQLite-compatible syntax
- All money values are INTEGER paisa — no floating-point money
- Checkout never trusts KV or CDN stock — uses fresh D1 conditional updates
- Never create order rows before `reserveVariants()` succeeds
- Public stock badge API must NOT write KV
- UddoktaPay paid status requires server-to-server verification
- Store only HMAC-SHA256 hashes of staff session tokens
- All non-GET staff mutations require CSRF

## License

Proprietary — Zabir Boutiques. All rights reserved.

---

Built with [Astro](https://astro.build) · [Cloudflare](https://cloudflare.com) · [TypeScript](https://typescriptlang.org)
