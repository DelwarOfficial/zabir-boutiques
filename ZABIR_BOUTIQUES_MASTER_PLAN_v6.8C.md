---
title: Zabir Boutiques AI Commerce Master Plan — Client Edition v6.8C
---

**Version 6.8C — Production Reconciled Edition**

Pure Cloudflare-Native | Astro Static + Pages Functions | D1 + R2 + KV + Workers
| UddoktaPay + FraudBD | Bangladesh F-Commerce

Prepared for Zabir Boutiques | June 2026 | Production Handoff Ready

---

| Field | Final Value |
|-------|-------------|
| Document title | Zabir Boutiques AI Commerce Master Plan v6.8C |
| Subtitle | Production Reconciled Edition — Client Ready |
| Previous version | v6.8B Security Audit Patch Edition (corrected June 2026) |
| Reason for revision | Reconciled specification against actual production-ready codebase. Aligned render mode, runtime binding patterns, cron architecture, file structure, wrangler config, and package versions with deployed reality. |
| Target platform | Cloudflare Pages + Workers runtime + D1 + R2 + KV + CDN Cache |
| Framework | Astro 5.9 with `output: "static"` plus Cloudflare Pages Functions for dynamic routes |
| Adapter | `@astrojs/cloudflare` 12.4 |
| UI Layer | React 19 islands (client:idle hydration) |
| Country context | Bangladesh F-commerce, COD-first conversion, UddoktaPay online payments, FraudBD courier risk, Bangladeshi phone normalization |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Non-Negotiable Architecture](#3-non-negotiable-architecture)
4. [Absolute Guardrails](#4-absolute-guardrails)
5. [Astro Rendering Strategy](#5-astro-rendering-strategy)
6. [Build-Time D1 Snapshot Strategy](#6-build-time-d1-snapshot-strategy)
7. [Production File Structure](#7-production-file-structure)
8. [Cloudflare Runtime Bindings](#8-cloudflare-runtime-bindings)
9. [Customer Flow](#9-customer-flow)
10. [Bangladesh Phone Normalization](#10-bangladesh-phone-normalization)
11. [D1 Schema Rules](#11-d1-schema-rules)
12. [Canonical D1 Naming Contract](#12-canonical-d1-naming-contract)
13. [Complete D1 Table List](#13-complete-d1-table-list)
14. [Money and Coupon Logic](#14-money-and-coupon-logic)
15. [Server-Side Price Authority](#15-server-side-price-authority)
16. [Order Number Format](#16-order-number-format)
17. [Inventory Reservation-First Engine](#17-inventory-reservation-first-engine)
18. [Guest Checkout Flow](#18-guest-checkout-flow)
19. [FraudBD Risk Routing](#19-fraudbd-risk-routing)
20. [UddoktaPay Payment Integration](#20-uddoktapay-payment-integration)
21. [Staff Authentication and RBAC](#21-staff-authentication-and-rbac)
22. [API Routes and Stock Badge](#22-api-routes-and-stock-badge)
23. [KV and Cloudflare Budget Strategy](#23-kv-and-cloudflare-budget-strategy)
24. [Worker CPU and D1 Query Budget](#24-worker-cpu-and-d1-query-budget)
25. [Tinify + R2 Media Pipeline](#25-tinify--r2-media-pipeline)
26. [Security Controls](#26-security-controls)
27. [CSRF Protection Implementation](#27-csrf-protection-implementation)
28. [SEO, Meta Pixel, and Performance](#28-seo-meta-pixel-and-performance)
29. [Build and Deployment Workflow](#29-build-and-deployment-workflow)
30. [Scheduled Jobs and Cron Dispatch](#30-scheduled-jobs-and-cron-dispatch)
31. [Testing Protocol](#31-testing-protocol)
32. [Disaster Recovery and Backup](#32-disaster-recovery-and-backup)
33. [Developer Guardrails](#33-developer-guardrails)
34. [Source Notes](#34-source-notes)

---

## 1. Executive Summary

Zabir Boutiques is moving from Facebook-first F-commerce into a professional AI-assisted ecommerce platform while preserving the current Facebook, Reels, Live, and Messenger conversion advantage. Version 6.8C is the production-reconciled Astro Static + Pages Functions edition.

The platform uses **Astro static generation** (`output: "static"`) for public browsing pages and **Cloudflare Pages Functions** for checkout, order tracking, staff workflows, payment verification, fraud routing, image upload, cron jobs, and API routes. Dynamic routes opt in via `export const prerender = false`.

**Cloudflare D1** remains the absolute source of truth for catalog, inventory, orders, payments, fraud checks, staff sessions, audit logs, and checkout idempotency. **Cloudflare KV** is used for cache, rate limiting, and staff session storage. **Cloudflare R2** stores media assets and backups.

This edition reconciles the specification with the actual production-ready codebase: corrected render mode, runtime binding patterns (using `cloudflare:workers` module imports instead of `locals.runtime.env`), accurate cron architecture (`entry-cloudflare.ts` + `cron-dispatch.ts`), correct wrangler config format, and verified package versions.

| Production concern | v6.8C decision |
|-------------------|----------------|
| Public storefront speed | Home, category, product, and trust pages are static and served from Cloudflare CDN. |
| Dynamic business operations | Checkout, order tracking, staff dashboard, API routes, webhook handlers, and scheduled jobs run in Cloudflare Pages Functions. |
| Stock integrity | All checkout stock operations use D1 atomic conditional UPDATE statements via `reserveVariants()`; cached stock is display-only. |
| Payments | UddoktaPay status is never trusted from browser redirects; every paid state requires server-to-server verification. |
| Fraud risk | FraudBD is a risk signal only. D1 remains the source of truth and every decision is logged. |
| Money | All prices, totals, discounts, shipping fees, refunds, and payments use INTEGER paisa fields only. Checkout ignores browser-supplied unit prices, subtotals, discounts, and totals. |
| Coupon atomicity | Limited-use coupons have atomic claim + rollback on subsequent checkout failure. |
| Payment race prevention | Payment creation atomically claims the order (`payment_status = 'processing'`) before calling provider. |

---

## 2. Architecture Overview

```
                         Cloudflare Pages
     ┌──────────────────────────────────────────────────┐
     │  Static Assets (CDN)    │  Pages Functions       │
     │  ┌───────────────────┐  │  ┌──────────────────┐  │
     │  │ Home, Category,   │  │  │ Checkout,        │  │
     │  │ Product, Trust    │  │  │ Order Tracking,  │  │
     │  │ pages (SSG via    │  │  │ Payments, Fraud, │  │
     │  │ D1 snapshots)     │  │  │ Staff Dashboard, │  │
     │  │                   │  │  │ API Routes,      │  │
     │  │                   │  │  │ Cron Handler     │  │
     │  └────────┬──────────┘  │  └────────┬─────────┘  │
     │           │                         │            │
     │           ▼                         ▼            │
     │  ┌─────────────────────────────────────────────┐ │
     │  │          Cloudflare D1 (SQLite)             │ │
     │  │  21 tables — inventory, orders, payments    │ │
     │  └─────────────────────────────────────────────┘ │
     │           │              │              │        │
     │           ▼              ▼              ▼        │
     │  ┌──────────┐   ┌──────────────┐   ┌──────────┐ │
     │  │  R2      │   │  KV          │   │  Cron    │ │
     │  │ (media,  │   │ (cache,      │   │  Triggers│ │
     │  │ backup)  │   │  rate-limit) │   │          │ │
     │  └──────────┘   └──────────────┘   └──────────┘ │
     └──────────────────────────────────────────────────┘
```

### Layer Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | Astro 5.9 (`output: static`) | Static pages with on-demand Pages Functions |
| **Adapter** | `@astrojs/cloudflare` 12.4 | Cloudflare Pages/Workers runtime |
| **UI** | React 19 | Interactive islands (cart, checkout, theme toggle) |
| **Styling** | Tailwind CSS 4 | Utility-first CSS with custom theme tokens |
| **Database** | Cloudflare D1 (SQLite) | Source of truth, transactional |
| **Media** | Cloudflare R2 | Product images, backups, archives |
| **Cache** | Cloudflare KV + CDN Cache | Admin-cached listings, rate limits, sessions binding |
| **Payments** | UddoktaPay | Server-to-server verification |
| **Fraud** | FraudBD | External risk signal only |
| **Images** | Tinify | Upload-time compression |
| **AI** | DeepSeek, OpenAI | Product descriptions, captions, SEO text (budget-gated) |

### Key Distinction: Astro Static + Pages Functions

This project does **not** use Astro's `output: "hybrid"` mode. Instead:
- **Static routes** (`prerender = true`) are pre-built during `astro build` as HTML files in `dist/`
- **Dynamic routes** (`export const prerender = false`) are automatically deployed as Cloudflare Pages Functions by the `@astrojs/cloudflare` adapter
- Pages Functions execute in the Cloudflare Workers runtime with access to D1, KV, R2, and secrets

---

## 3. Non-Negotiable Architecture

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Astro 5.9 (`output: static` with prerender=false opt-in) | SSG-first storefront with Pages Functions for dynamic features |
| Adapter | `@astrojs/cloudflare` 12.4 | Cloudflare Pages Functions runtime and bindings access |
| Deployment | Cloudflare Pages | Static assets plus auto-generated Pages Functions |
| Database | Cloudflare D1 SQLite | Absolute source of truth for all transactional data |
| Media | Cloudflare R2 | Product images, backups, exports, original media |
| Image optimization | Tinify/TinyPNG via fetch | Upload-time compression only; never per page load |
| Cache/config | Cloudflare KV + CDN Cache | Site settings, selected listing cache, rate counters, AI budget counters; never checkout stock |
| Payment | UddoktaPay | Optional online payment and prepaid risk routing |
| Fraud risk | FraudBD | COD courier-risk checking and manager review routing |
| Automation | Scheduled Workers via `entry-cloudflare.ts` | Reservation cleanup, fraud polling, backup, maintenance |
| AI content | DeepSeek | Product descriptions, captions, SEO text, moderator-reviewed |
| AI support | OpenAI GPT-4o or smaller with hard caps | Limited live support only, budget-gated |

---

## 4. Absolute Guardrails

- Never use Supabase, Vercel, Neon, PlanetScale, external Postgres, or external MySQL as the application database layer.
- D1 is SQLite. Use only SQLite-compatible syntax. No pgcrypto, SERIAL, TIMESTAMPTZ, SELECT FOR UPDATE, or PostgreSQL-only features.
- All writes go through Astro Pages Functions (`src/pages/api/*` or SSR routes with `prerender = false`) running in Cloudflare Workers runtime.
- Frontend public pages must never write directly to D1, R2, or KV.
- No customer account, password, OTP, or customer login in MVP checkout. Checkout is guest-only: name, phone, address, note, payment method.
- All money values use INTEGER paisa. Floating-point money fields are banned.
- Checkout never trusts KV or CDN stock. Checkout uses fresh D1 conditional updates through `reserveVariants()`.
- Checkout never trusts browser-supplied `unit_price_paisa`, `subtotal_paisa`, `discount_paisa`, `delivery_paisa`, or `total_paisa`. These fields may be accepted only for UI echo/debug comparison, never for persistence or payment.
- `loadVariantSnapshots()` must select authoritative `price_paisa` from D1 for every cart line, and checkout must calculate subtotal from that value only.
- Coupon discount must come from `applyCouponAtomic()` after subtotal calculation; client discount fields are ignored.
- CSRF tokens must be independent nonces signed with HMAC. Never embed the raw staff session token in any JS-readable cookie.
- Browser payment redirect query parameters never mark an order paid. UddoktaPay must be verified server-to-server.
- Never create an order record before `reserveVariants()` returns `ok: true`.
- Never call `reserveVariants()` outside `src/lib/inventory.ts`.
- Never validate and increment coupons as separate D1 calls. Use `applyCouponAtomic()`.
- Claimed coupon usage must be released on subsequent failure (fraud block, stock exhaustion, order creation error) via `releaseCouponUsageAtomic()`.
- Payment creation must atomically claim the order (`payment_status = 'processing'`) before calling UddoktaPay, preventing duplicate active invoices. Provider failure resets status back to `pending`.
- Webhook amount-mismatch alerts must resolve an actual order item variant, not the `order_id` injected into `variant_id`.
- Store only HMAC-SHA256 hashes of staff session tokens; never store raw session tokens in D1.
- All external API keys must be Cloudflare secrets only.

---

## 5. Astro Rendering Strategy

| Route type | Astro mode | Rule |
|-----------|-----------|------|
| Home page | SSG | `export const prerender = true` (default for `output: static`) |
| Category pages | SSG | `getStaticPaths()` from build-time D1 snapshot JSON |
| Product pages | SSG | Static product details; dynamic stock badge is optional island/API call |
| Campaign/Reel pages | SSG | Static landing pages for Facebook traffic |
| Trust pages | SSG | Delivery, return, privacy, terms, size guide |
| Checkout | SSR/Pages Function | `export const prerender = false`; dynamic guest form and server validation |
| Order tracking | SSR/API | Phone + order number lookup, rate-limited |
| Staff dashboard | SSR | Deep server-side session parsing, RBAC, CSRF for mutations |
| Staff login | SSR | `export const prerender = false`; authentication page |
| API routes | Pages Functions | `src/pages/api/*` with `prerender = false`; mutations protected by rate-limit and CSRF where applicable |

### astro.config.mjs (Production)

```javascript
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  integrations: [react()],
  adapter: cloudflare({
    imageService: { build: "compile", runtime: "passthrough" },
    platformProxy: { enabled: true },
  }),
  prefetch: true,
  vite: {
    plugins: [tailwindcss()],
    build: { minify: true },
  },
});
```

### wrangler.jsonc (Production)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "zabir-boutiques",
  "compatibility_date": "2026-06-04",
  "compatibility_flags": ["nodejs_compat"],
  "pages_build_output_dir": "./dist",
  "assets": {
    "binding": "SITE_ASSETS"
  },
  "observability": {
    "enabled": true,
    "head_sampling_rate": 0.1
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "zabir-db",
      "database_id": "REPLACE_WITH_D1_DATABASE_ID"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "CACHE",
      "id": "REPLACE_WITH_CACHE_KV_NAMESPACE_ID"
    },
    {
      "binding": "SESSION",
      "id": "REPLACE_WITH_SESSION_KV_NAMESPACE_ID"
    }
  ],
  "r2_buckets": [
    {
      "binding": "MEDIA",
      "bucket_name": "zabir-media"
    },
    {
      "binding": "BACKUPS",
      "bucket_name": "zabir-backups"
    }
  ],
  "vars": {
    "PUBLIC_SITE_URL": "https://zabirboutiques.com",
    "PUBLIC_SITE_NAME": "Zabir Boutiques"
  },
  "triggers": {
    "crons": ["*/10 * * * *", "0 3 * * *", "0 4 * * 0", "0 5 1 * *"]
  }
}
```

---

## 6. Build-Time D1 Snapshot Strategy

Cloudflare runtime bindings do not exist inside standard build containers. Therefore SSG pages use build-time snapshots created by a prebuild script that calls the D1 REST API with a scoped read-only token. The token is stored only as a Cloudflare Pages build environment variable and is never committed.

- Required env vars: `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_D1_READ_TOKEN`.
- `CF_D1_READ_TOKEN` must be scoped to read only the required D1 database.
- Generated `src/data/*.json` files are build artifacts and must be gitignored.
- If snapshot generation fails, build must fail. Do not silently deploy stale empty catalogs.

### `scripts/build-static-snapshots.ts`

```typescript
import { writeFileSync, mkdirSync } from 'node:fs';

const ACCOUNT = process.env.CF_ACCOUNT_ID;
const DB_ID = process.env.CF_D1_DATABASE_ID;
const TOKEN = process.env.CF_D1_READ_TOKEN;
if (!ACCOUNT || !DB_ID || !TOKEN) throw new Error('Missing D1 snapshot environment variables');

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`;

async function d1Query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params })
  });
  const json = await res.json() as any;
  if (!json.success) throw new Error(`D1 REST error: ${JSON.stringify(json.errors)}`);
  return json.result?.[0]?.results as T[] ?? [];
}

mkdirSync('./src/data', { recursive: true });

const categories = await d1Query(
  `SELECT slug, name, meta_title, meta_description FROM categories WHERE is_active = 1 ORDER BY sort_order ASC`
);
const products = await d1Query(
  `SELECT p.slug, p.name, p.meta_title, p.meta_description, p.price_paisa, c.slug AS category_slug
   FROM products p JOIN categories c ON c.id = p.category_id WHERE p.status = 'published'`
);

if (categories.length === 0) throw new Error('Snapshot failed: zero active categories');

writeFileSync('./src/data/categories-snapshot.json', JSON.stringify(categories, null, 2));
writeFileSync('./src/data/products-snapshot.json', JSON.stringify(products, null, 2));
```
---

## 7. Production File Structure

```
zabir-boutiques/
├── astro.config.mjs              # Astro config (output: static + cloudflare adapter)
├── wrangler.jsonc                # Cloudflare Pages + D1 + KV + R2 + cron bindings
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example                  # Environment variable template
├── .env.local                    # Local development secrets (gitignored)
│
├── src/
│   ├── entry-cloudflare.ts       # Worker cron entry point (scheduled handler)
│   ├── env.d.ts                  # Cloudflare runtime type definitions (Env)
│   ├── middleware.ts             # CSRF + rate limiting + security headers
│   │
│   ├── pages/
│   │   ├── index.astro           # Homepage (SSG)
│   │   ├── checkout.astro        # Guest checkout (React island host)
│   │   ├── order-track.astro     # Order tracking lookup page
│   │   ├── orders.astro          # Order listing page
│   │   ├── categories/
│   │   │   └── [slug].astro      # Category listing (SSG)
│   │   ├── products/
│   │   │   └── [slug].astro      # Product detail (SSG)
│   │   ├── staff/
│   │   │   ├── index.astro       # Staff dashboard
│   │   │   ├── login.astro       # Staff login page
│   │   │   └── orders/
│   │   │       └── [id].astro    # Order detail page
│   │   └── api/
│   │       ├── checkout.ts               # POST - Guest checkout
│   │       ├── orders/track.ts           # POST - Order tracking
│   │       ├── stock/[variantId].ts      # GET  - Stock badge (CDN-cached)
│   │       ├── payments/
│   │       │   ├── create.ts             # POST - Initiate UddoktaPay checkout
│   │       │   ├── webhook.ts            # POST - UddoktaPay payment notification
│   │       │   └── status/[id].ts        # GET  - Payment status lookup
│   │       ├── fraud/check.ts            # POST - FraudBD risk assessment
│   │       └── staff/
│   │           ├── login.ts              # POST - Staff authentication
│   │           ├── logout.ts             # POST - Staff session invalidation
│   │           ├── uploads.ts            # POST - Image upload (R2 + Tinify)
│   │           ├── api-code/index.ts     # GET/POST - Owner-only API-code area
│   │           └── orders/[id]/confirm.ts # POST - Order confirmation (RBAC)
│   │
│   ├── lib/
│   │   ├── env.ts                # Runtime env accessor (uses cloudflare:workers)
│   │   ├── dates.ts              # UTC timestamp (nowSql)
│   │   ├── phone.ts              # Bangladesh phone normalization
│   │   ├── money.ts              # INTEGER paisa arithmetic, coupon logic
│   │   ├── checkout-pricing.ts   # Server-authoritative checkout pricing
│   │   ├── inventory.ts          # Reservation-first engine
│   │   ├── orders.ts             # Order creation with retry
│   │   ├── payments.ts           # UddoktaPay integration
│   │   ├── fraud.ts              # FraudBD risk routing
│   │   ├── sessions.ts           # HMAC-SHA256 staff auth
│   │   ├── security.ts           # CSRF tokens + timing-safe comparison
│   │   ├── rbac.ts               # Role-based access control
│   │   ├── staff-menu.ts         # Permission-driven staff menu
│   │   ├── audit.ts              # Audit log writer + request helpers
│   │   ├── cache.ts              # KV utilities
│   │   ├── cart-store.ts         # Client cart store helpers
│   │   ├── idempotency.ts        # Checkout idempotency
│   │   ├── tinify.ts             # Image compression pipeline
│   │   ├── cron-dispatch.ts      # Scheduled job router
│   │   └── maintenance/
│   │       ├── backup.ts         # D1 → R2 weekly backup
│   │       ├── archive.ts        # Monthly event log archival
│   │       └── idempotency.ts    # Idempotency key cleanup
│   │
│   ├── components/
│   │   ├── shell/
│   │   │   ├── Header.astro
│   │   │   ├── Footer.astro
│   │   │   ├── CategoryRail.astro
│   │   │   └── ProductGridSkeleton.astro
│   │   ├── product/
│   │   │   └── ProductCard.astro
│   │   ├── checkout/
│   │   │   └── CheckoutSkeleton.astro
│   │   ├── staff/
│   │   └── shared/
│   │
│   ├── islands/                  # React islands (client:idle hydration)
│   │   ├── GuestCheckout.tsx
│   │   ├── AddToCartButton.tsx
│   │   ├── BottomNav.tsx
│   │   └── ThemeToggle.tsx
│   │
│   ├── hooks/
│   │   └── useLocalCart.ts
│   │
│   ├── data/                     # Generated build-time D1 snapshots (gitignored)
│   │   ├── catalog.ts
│   │   ├── category-taxonomy.ts
│   │   ├── demo-products.ts
│   │   ├── categories-snapshot.json
│   │   └── products-snapshot.json
│   │
│   ├── layouts/
│   │   └── RootLayout.astro
│   │
│   └── styles/
│       └── global.css            # Tailwind v4 + semantic theme tokens (light/dark)
│
├── db/
│   └── migrations/
│       ├── 0001_initial_v6_8a_schema.sql   # 21 tables
│       └── 0002_indexes.sql                # Performance indexes
│
├── scripts/
│   ├── build-static-snapshots.ts  # D1 REST API snapshot generator
│   └── seed.ts                    # Sample data seeder
│
├── tests/                         # 122 Vitest tests across 14 files
│   ├── phone.test.ts
│   ├── inventory.test.ts
│   ├── checkout.test.ts
│   ├── payments.test.ts
│   ├── fraud.test.ts
│   ├── sessions.test.ts
│   ├── security.test.ts
│   ├── csrf.test.ts
│   ├── rbac.test.ts
│   ├── staff-menu.test.ts
│   ├── race-conditions.test.ts
│   ├── paid-expired-reservation.test.ts
│   ├── cron-imports.test.ts
│   └── schema-naming.test.ts
│
├── public/
│   └── assets/
│       └── zabir-logo.jpg
│
├── graphify-out/                  # Generated knowledge graph (project mapping)
│   ├── graph.json
│   ├── graph.html
│   └── GRAPH_REPORT.md
│
└── AGENTS.md                      # Agent instructions for AI-assisted development
```

---

## 8. Cloudflare Runtime Bindings

### Environment Type Definitions

```typescript
// src/env.d.ts
/// <reference types="astro/client" />

export type Env = {
  DB: D1Database;
  CACHE: KVNamespace;
  SESSION: KVNamespace;
  MEDIA: R2Bucket;
  BACKUPS: R2Bucket;
  TINIFY_API_KEY: string;
  UDDOKTAPAY_API_KEY: string;
  UDDOKTAPAY_BASE_URL: string;
  FRAUDBD_API_KEY: string;
  DEEPSEEK_API_KEY: string;
  OPENAI_API_KEY: string;
  SESSION_SECRET: string;
  PUBLIC_SITE_URL: string;
  PUBLIC_SITE_NAME: string;
};

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
```

### Runtime Env Accessor

The project uses the modern `cloudflare:workers` module import pattern (NOT the deprecated `context.locals.runtime.env` pattern).

```typescript
// src/lib/env.ts
import type { APIContext } from 'astro';
import type { Env } from '../env';
import { env as cloudflareEnv } from 'cloudflare:workers';

export function getEnv(context: APIContext): Env {
  void context;
  if (!cloudflareEnv) throw new Error('Cloudflare runtime env is unavailable');
  return cloudflareEnv as Env;
}
```

### Direct Binding Access in Middleware and API Routes

```typescript
// src/middleware.ts (pattern for direct binding access)
import { env as cloudflareEnv } from 'cloudflare:workers';
const runtimeEnv = cloudflareEnv as { CACHE?: KVNamespace; PUBLIC_SITE_URL?: string; SESSION_SECRET?: string };

// src/pages/api/stock/[variantId].ts (pattern for API routes)
import { env as cloudflareEnv } from 'cloudflare:workers';
const env = cloudflareEnv as { DB: D1Database };
```

---

## 9. Customer Flow

Facebook / Instagram / Reels / Live
→ Astro static product page on Cloudflare CDN
→ Cart island (AddToCartButton: React client:idle)
→ SSR checkout page (GuestCheckout: React client:idle)
→ POST /api/checkout
→ normalizeBangladeshPhone()
→ FraudBD sync attempt (timeout = 3s, failure = review)
→ reserveVariants() in D1 (atomic batch)
→ create order + order_items + stock_reservations (single batch)
→ COD: staff confirmation workflow
→ OR UddoktaPay: redirect → payment → server-to-server webhook verification
→ packing → courier → delivered

---

## 10. Bangladesh Phone Normalization

Canonical phone format stored in D1 is `+8801XXXXXXXXX`. The local 11-digit format used during validation is `01XXXXXXXXX`. All regex anchors use real ASCII caret (U+005E).

```typescript
// src/lib/phone.ts
export type PhoneNormalizeResult =
  | { ok: true; phone: string; local: string }
  | { ok: false; error: string };

const PHONE_PATTERN = new RegExp('^01[3-9]\\d{8}$');

export function normalizeBangladeshPhone(input: string): PhoneNormalizeResult {
  const stripped = String(input ?? '').replace(/\D/g, '');
  let local: string;

  if (stripped.length === 13 && stripped.startsWith('880')) {
    local = '0' + stripped.slice(3);
  } else if (stripped.length === 11 && stripped.startsWith('0')) {
    local = stripped;
  } else if (stripped.length === 10 && stripped.startsWith('1')) {
    local = '0' + stripped;
  } else {
    return { ok: false, error: 'Invalid Bangladeshi mobile number. Enter 11 digits starting with 01X.' };
  }

  if (!PHONE_PATTERN.test(local)) {
    return { ok: false, error: 'Invalid Bangladeshi mobile number. Enter 11 digits starting with 01X.' };
  }

  return { ok: true, local, phone: '+88' + local };
}
```

---

## 11. D1 Schema Rules

- Generate all IDs in runtime code using `crypto.randomUUID()`.
- All timestamp columns use TEXT generated by `nowSql()`, format `YYYY-MM-DD HH:MM:SS` UTC-equivalent string.
- Never use SQLite `datetime("now")` in application SQL snippets; pass timestamps as bound parameters.
- Use CHECK constraints for status fields and numeric ranges.
- Use UNIQUE constraints for `order_number`, `slug`, `invoice_id`, webhook idempotency, and `idempotency_key`.
- Use `ON DELETE RESTRICT` for historical order/payment references.
- Use soft-delete for `product_variants` and `coupons`; never hard-delete records referenced by orders.

```typescript
// src/lib/dates.ts
export function nowSql(date = new Date()): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}
```

---

## 12. Canonical D1 Naming Contract

| Entity | Canonical names |
|--------|----------------|
| Tables | `product_images`, `audit_log`, `staff_sessions`, `payment_events`, `fraud_checks`, `fraud_polls`, `stock_reservations`, `checkout_idempotency` |
| `orders` columns | `id`, `order_number`, `phone`, `name`, `address`, `note`, `shipping_zone`, `subtotal_paisa`, `delivery_paisa`, `discount_paisa`, `total_paisa`, `payment_method`, `payment_status`, `fraud_decision`, `status`, `created_at`, `updated_at` |
| `staff_sessions` columns | `token_hash`, `is_revoked`, `expires_at`, `absolute_expires_at`, `last_active_at` |
| `low_stock_alerts` columns | `is_acknowledged`, `created_at`, `variant_id`, `message` |
| `inventory_items` columns | `variant_id`, `quantity`, `reserved_quantity`, `is_available`, `updated_at` |
| Payment status values | `created`, `pending`, `processing`, `paid`, `failed`, `cancelled`, `expired`, `refunded` |
| Order status values | `pending_review`, `pending_payment`, `payment_verified`, `paid_over_allocated`, `staff_confirmed`, `packing`, `shipped`, `delivered`, `cancelled`, `refunded` |

```sql
-- Canonical index examples
CREATE INDEX idx_orders_phone ON orders(phone);
CREATE INDEX idx_sessions_token_active ON staff_sessions(token_hash) WHERE is_revoked = 0;
CREATE INDEX idx_low_stock_unacknowledged ON low_stock_alerts(is_acknowledged, created_at) WHERE is_acknowledged = 0;
```

---

## 13. Complete D1 Table List

| # | Table | Purpose |
|---|-------|---------|
| 1 | `schema_migrations` | Migration version tracking |
| 2 | `staff_users` | Staff accounts and roles |
| 3 | `staff_sessions` | Hashed session token lifecycle |
| 4 | `categories` | Product categories |
| 5 | `products` | Product catalog and SEO fields |
| 6 | `product_variants` | Size/color/SKU variants with soft delete |
| 7 | `product_images` | R2 image references and Tinify status |
| 8 | `inventory_items` | Quantity and reserved_quantity per variant |
| 9 | `coupons` | Fixed/percentage coupon rules |
| 10 | `fraud_checks` | FraudBD responses and decisions |
| 11 | `orders` | Guest orders and state |
| 12 | `order_items` | Line item snapshots captured at checkout |
| 13 | `stock_reservations` | 30-minute reservation records |
| 14 | `order_status_history` | Order state audit trail |
| 15 | `payments` | UddoktaPay lifecycle |
| 16 | `payment_events` | Webhook idempotency and raw payload audit |
| 17 | `low_stock_alerts` | Stock alerts (`paid_over_allocated` incidents) |
| 18 | `site_settings` | Store settings and shipping prices |
| 19 | `audit_log` | Staff/system audit log |
| 20 | `checkout_idempotency` | Prevents duplicate checkout retries |
| 21 | `fraud_polls` | Async FraudBD polling queue |

```sql
-- checkout_idempotency table
CREATE TABLE checkout_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  order_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing','complete','failed')),
  response_body TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- fraud_polls table
CREATE TABLE fraud_polls (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  process_id TEXT NOT NULL,
  poll_count INTEGER NOT NULL DEFAULT 0 CHECK (poll_count >= 0),
  next_poll_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','timeout','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

For the full DDL, see `db/migrations/0001_initial_v6_8a_schema.sql` (21 tables).

---

## 14. Money and Coupon Logic

All money is stored as INTEGER paisa. Coupon validation and usage increment must be atomic. Checkout money is server-authoritative: client-supplied unit prices, subtotals, discounts, and totals are untrusted and ignored.

```typescript
// src/lib/money.ts — Core types
export type Paisa = number;
export type DiscountType = 'fixed' | 'percentage';

export function assertPaisa(value: number, label = "amount"): Paisa {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer paisa value`);
  }
  return value;
}

export function calculateCouponDiscount(
  subtotalPaisa: Paisa,
  discountType: DiscountType,
  discountAmountPaisa: number | null,
  discountPercent: number | null,
  maxDiscountPaisa: number | null
): Paisa {
  if (discountType === 'fixed') {
    return assertPaisa(discountAmountPaisa ?? 0, 'coupon_fixed_amount');
  }
  if (discountType === 'percentage' && discountPercent != null) {
    const raw = Math.floor(subtotalPaisa * discountPercent / 100);
    return maxDiscountPaisa != null ? Math.min(raw, maxDiscountPaisa) : raw;
  }
  return 0;
}

export async function applyCouponAtomic(
  db: D1Database,
  code: string,
  subtotalPaisa: Paisa,
  now: string
): Promise<{ ok: true; discountPaisa: Paisa } | { ok: false; reason: string }> {
  const coupon = await db.prepare(
    `SELECT id, discount_type, discount_amount_paisa, discount_percent,
            max_discount_paisa, min_order_paisa, usage_limit, used_count,
            starts_at, expires_at, is_active
     FROM coupons WHERE code = ?1`
  ).bind(code).first<any>();

  if (!coupon) return { ok: false, reason: 'COUPON_NOT_FOUND' };
  if (!coupon.is_active) return { ok: false, reason: 'COUPON_INACTIVE' };
  if (coupon.expires_at && coupon.expires_at < now) return { ok: false, reason: 'COUPON_EXPIRED' };
  if (coupon.starts_at && coupon.starts_at > now) return { ok: false, reason: 'COUPON_NOT_YET_VALID' };
  if (coupon.usage_limit != null && coupon.used_count >= coupon.usage_limit) return { ok: false, reason: 'COUPON_EXHAUSTED' };
  if (subtotalPaisa < (coupon.min_order_paisa ?? 0)) return { ok: false, reason: 'COUPON_MIN_ORDER' };

  const result = await db.prepare(
    `UPDATE coupons SET used_count = used_count + 1
     WHERE code = ?1 AND (usage_limit IS NULL OR used_count < usage_limit)`
  ).bind(code).run();

  if (result.meta.changes !== 1) return { ok: false, reason: 'COUPON_RACE_LOST' };

  return {
    ok: true,
    discountPaisa: calculateCouponDiscount(
      subtotalPaisa,
      coupon.discount_type,
      coupon.discount_amount_paisa,
      coupon.discount_percent,
      coupon.max_discount_paisa
    )
  };
}

export async function releaseCouponUsageAtomic(
  db: D1Database,
  code: string
): Promise<void> {
  await db.prepare(
    `UPDATE coupons
     SET used_count = used_count - 1
     WHERE code = ?1 AND used_count > 0`
  ).bind(code).run();
}
```

---

## 15. Server-Side Price Authority

`checkout.ts` must load current product/variant snapshots from D1 before calculating any amount. The browser cart may send `variantId` and `qty` only. Any browser-supplied `unit_price_paisa`, `subtotal_paisa`, `discount_paisa`, `delivery_paisa`, or `total_paisa` is discarded.

```typescript
// src/lib/checkout-pricing.ts
export type CheckoutCartItem = {
  variantId: string;
  qty: number;
};

export type VariantSnapshot = {
  variant_id: string;
  product_id: string;
  product_name: string;
  size: string | null;
  color: string | null;
  sku: string;
  price_paisa: number;
};

export async function loadVariantSnapshots(
  db: D1Database,
  items: CheckoutCartItem[]
): Promise<Map<string, VariantSnapshot>> {
  const ids = [...new Set(items.map(item => item.variantId))];
  if (ids.length === 0 || ids.length > 10) throw new Error('INVALID_CART_SIZE');

  const placeholders = ids.map((_, index) => `?${index + 1}`).join(', ');
  const rows = await db.prepare(
    `SELECT
      v.id AS variant_id,
      p.id AS product_id,
      p.name AS product_name,
      v.size,
      v.color,
      v.sku,
      COALESCE(v.price_paisa, p.price_paisa) AS price_paisa
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.id IN (${placeholders})
       AND v.is_deleted = 0
       AND p.status = 'published'`
  ).bind(...ids).all<VariantSnapshot>();

  const map = new Map<string, VariantSnapshot>();
  for (const row of rows.results ?? []) {
    if (!Number.isInteger(row.price_paisa) || row.price_paisa < 0) {
      throw new Error(`INVALID_DB_PRICE:${row.variant_id}`);
    }
    map.set(row.variant_id, row);
  }
  return map;
}

export function calculateAuthoritativeSubtotal(
  items: CheckoutCartItem[],
  snapshots: Map<string, VariantSnapshot>
): number {
  let subtotalPaisa = 0;
  for (const item of items) {
    const snapshot = snapshots.get(item.variantId);
    if (!snapshot) throw new Error(`VARIANT_NOT_FOUND:${item.variantId}`);
    if (!Number.isInteger(item.qty) || item.qty <= 0) throw new Error('INVALID_QTY');
    subtotalPaisa += snapshot.price_paisa * item.qty;
  }
  return subtotalPaisa;
}

export function assertNoClientMoneyTrust(body: any): void {
  const ignored = [
    'unit_price_paisa',
    'subtotal_paisa',
    'discount_paisa',
    'delivery_paisa',
    'total_paisa'
  ];
  for (const key of ignored) {
    if (key in (body ?? {})) console.warn(`[checkout] ignored client money field: ${key}`);
  }
}
```

### Checkout Money Flow (Critical Pattern)

```typescript
// src/pages/api/checkout.ts — money section
const rawBody = await request.json();
assertNoClientMoneyTrust(rawBody);

const items = parseCartItems(rawBody.items); // accepts variantId + qty only
const snapshots = await loadVariantSnapshots(env.DB, items);

if (snapshots.size !== new Set(items.map(i => i.variantId)).size) {
  return Response.json({ error: 'One or more items are unavailable' }, { status: 400 });
}

const subtotalPaisa = calculateAuthoritativeSubtotal(items, snapshots);
const deliveryPaisa = await calculateDeliveryPaisa(env.DB, rawBody.shipping_zone, subtotalPaisa);

let discountPaisa = 0;
if (rawBody.coupon_code) {
  const coupon = await applyCouponAtomic(env.DB, rawBody.coupon_code, subtotalPaisa, now);
  if (!coupon.ok) return Response.json({ error: coupon.reason }, { status: 400 });
  discountPaisa = coupon.discountPaisa;
}

const totalPaisa = Math.max(0, subtotalPaisa + deliveryPaisa - discountPaisa);
```

---

## 16. Order Number Format

```typescript
// src/lib/orders.ts
export function generateOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `ZB-${date}-${hex}`;
}
```

Format: `ZB-YYYYMMDD-XXXXXX` (6 hex chars from 3 random bytes). Retry up to 3x on UNIQUE constraint collision.

---

## 17. Inventory Reservation-First Engine

Checkout reserves stock by increasing `reserved_quantity` only if available stock is enough. It does not deduct final quantity. For multi-variant carts, if any item fails, every successful reservation from the batch is released.

```typescript
// src/lib/inventory.ts
export async function reserveVariants(
  db: D1Database,
  items: Array<{ variantId: string; qty: number }>,
  now: string
): Promise<{ ok: true } | { ok: false; failedVariantId: string }> {
  if (items.length === 0) return { ok: false, failedVariantId: 'EMPTY_CART' };

  for (const item of items) {
    if (!item.variantId || !Number.isInteger(item.qty) || item.qty <= 0) {
      return { ok: false, failedVariantId: item.variantId || 'INVALID_ITEM' };
    }
  }

  const reserveStmts = items.map(item =>
    db.prepare(
      `UPDATE inventory_items
       SET reserved_quantity = reserved_quantity + ?1, updated_at = ?3
       WHERE variant_id = ?2
         AND is_available = 1
         AND (quantity - reserved_quantity) >= ?1`
    ).bind(item.qty, item.variantId, now)
  );

  const results = await db.batch(reserveStmts);
  const failedIndex = results.findIndex(result => result.meta.changes !== 1);

  if (failedIndex === -1) return { ok: true };

  // Compensating release for successful reservations
  const successfulItems = items.filter((_, index) => results[index]?.meta.changes === 1);
  if (successfulItems.length > 0) {
    const releaseStmts = successfulItems.map(item =>
      db.prepare(
        `UPDATE inventory_items
         SET reserved_quantity = reserved_quantity - ?1, updated_at = ?3
         WHERE variant_id = ?2 AND reserved_quantity >= ?1`
      ).bind(item.qty, item.variantId, now)
    );
    await db.batch(releaseStmts);
  }

  return { ok: false, failedVariantId: items[failedIndex].variantId };
}
```

### Guardrails

- Never create orders before `reserveVariants()` returns `ok: true`.
- `stock_reservations` expire exactly 30 minutes after creation.
- Reservation cleanup releases expired active reservations and marks them `expired`.
- Cleanup is bounded + chunked (25 rows per D1 batch to stay within 50-statement limit).
- If compensating release fails, the error is logged but does not block the response.

### Expired Reservation Cleanup

```typescript
export async function cleanExpiredReservations(db: D1Database, maxRows = 200): Promise<void> {
  const now = nowSql();

  const expired = await db.prepare(
    `SELECT id, variant_id, quantity FROM stock_reservations
     WHERE status = 'active' AND expires_at < ?1
     LIMIT ?2`
  ).bind(now, maxRows).all<{ id: string; variant_id: string; quantity: number }>();

  const rows = expired.results ?? [];
  if (rows.length === 0) return;

  const CHUNK_ROWS = 25;
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    const chunk = rows.slice(i, i + CHUNK_ROWS);
    const stmts = [
      ...chunk.map(row =>
        db.prepare(
          `UPDATE inventory_items
           SET reserved_quantity = reserved_quantity - ?1, updated_at = ?3
           WHERE variant_id = ?2 AND reserved_quantity >= ?1`
        ).bind(row.quantity, row.variant_id, now)
      ),
      ...chunk.map(row =>
        db.prepare(
          `UPDATE stock_reservations SET status = 'expired', updated_at = ?2 WHERE id = ?1`
        ).bind(row.id, now)
      )
    ];
    await db.batch(stmts);
  }
}
```

---

## 18. Guest Checkout Flow

### Complete Flow

1. Validate request payload, cart line count, quantities, and idempotency key.
2. Normalize Bangladesh phone with `normalizeBangladeshPhone()`.
3. Reject carts with more than 10 line items to protect D1 per-request query budget.
4. Load all product/variant snapshots with one SELECT using an IN list, including `product_name`, `size`, `color`, `sku`, and authoritative `price_paisa`.
5. Calculate subtotal, delivery, coupon discount, and total in INTEGER paisa on the server only. Ignore all client money fields.
6. Claim idempotency (insert row with status `processing` — unique constraint prevents duplicates).
7. Run FraudBD short-timeout risk check or create `fraud_polls` for async review.
8. Call `reserveVariants()` once for the full cart.
9. Only after reservation success, use `insertReservedOrderWithRetry()` to atomically insert `orders`, `order_items` (with D1 price snapshots), and `stock_reservations` in a single `db.batch()`.
10. Complete idempotency (if this fails, the order still exists; log the error but return success).
11. If any step after idempotency claim fails, release claimed coupon usage, release stock reservations (if reserved), and mark idempotency as failed.

### Error Codes

| Code | HTTP Status | Condition |
|------|-------------|-----------|
| `MISSING_IDEMPOTENCY_KEY` | 400 | No idempotency key provided |
| `DUPLICATE_CHECKOUT` | 409 | Idempotency key already claimed |
| `INVALID_PHONE` | 400 | Phone normalization failure |
| `EMPTY_CART` | 400 | No items in cart |
| `CART_TOO_LARGE` | 400 | More than 10 line items |
| `INVALID_CART` | 400 | Missing variantId or invalid item |
| `INVALID_QUANTITY` | 400 | Non-positive or non-integer quantity |
| `VARIANT_UNAVAILABLE` | 409 | Snapshot count mismatch (variant unavailable) |
| `PRICING_ERROR` | 409 | D1 pricing data error |
| `COUPON_*` | 409 | Coupon validation failure (NOT_FOUND, INACTIVE, EXPIRED, EXHAUSTED, RACE_LOST, etc.) |
| `FRAUD_BLOCKED` | 403 | FraudBD score >= 80 |
| `OUT_OF_STOCK` | 409 | Stock reservation failure |
| `CHECKOUT_FAILED` | 500 | Internal server error |

---

## 19. FraudBD Risk Routing

FraudBD is an external risk signal only. D1 stores the raw response and internal decision; FraudBD never becomes the order source of truth.

| Risk score/condition | Internal decision | Action |
|---------------------|-------------------|--------|
| 0–30 | `approved` | Allow COD and normal staff workflow |
| 31–79 | `review` | Create order but require manager review before courier confirmation |
| 80–100 | `blocked` | Disable COD and request prepaid UddoktaPay or manager override |
| Timeout/error | `review` | Do not block automatically; create manager review queue |

Cron-only polling is coarse-grained. `next_poll_at` values such as 30 seconds or 60 seconds are eligibility timestamps only; actual execution occurs on the next scheduled cron tick.

---

## 20. UddoktaPay Payment Integration

UddoktaPay is optional for online payment and mandatory for high-risk prepaid routing. Browser redirects never mark an order paid. Paid status requires webhook authenticity + server-to-server verification + amount match.

### Payment Initiation (Atomic Claim Pattern)

```typescript
// src/pages/api/payments/create.ts — critical race prevention
// Atomically claim the order before calling provider
const claimResult = await env.DB.prepare(
  `UPDATE orders SET payment_status = 'processing', updated_at = ?2
   WHERE id = ?1 AND payment_status IN ('created','pending')`
).bind(orderId, now).run();

if (claimResult.meta.changes !== 1) {
  return Response.json({ error: 'Payment initiation already in progress' }, { status: 409 });
}

// Provider checkout call...
// On provider failure, reset:
await env.DB.prepare(
  `UPDATE orders SET payment_status = 'pending', updated_at = ?2 WHERE id = ?1 AND payment_status = 'processing'`
).bind(orderId, now).run();
```

### Webhook Verification Flow

1. Authenticate webhook via `RT-UDDOKTAPAY-API-KEY` header (timing-safe comparison).
2. Verify payment status server-to-server via UddoktaPay's `/api/verify-payment`.
3. Reject if verified status is not `COMPLETED`/`paid`.
4. Reject if verified amount does not match charged amount (INSERT mismatch alert).
5. Insert `payment_event` with `INSERT OR IGNORE` + `UNIQUE(invoice_id, event_type, status)` for idempotency.
6. If duplicate event (changes = 0), return success (already processed).
7. Forward-only: mark payment as `paid` (reject if already confirmed).
8. If active reservations exist: deduct from reserved stock and confirm reservations.
9. If reservations expired/missing: attempt direct atomic deduction from available stock.
10. If any direct deduction fails: `paid_over_allocated` — set order status, compensate successful deductions, create manager alert.

### Forward-Only Payment Status Update

```sql
UPDATE payments
SET status = 'paid', verified_at = ?1, updated_at = ?1
WHERE invoice_id = ?2
  AND status IN ('created','pending','processing');
```

### Direct Fallback Deduction After Reservation Expiry

```sql
UPDATE inventory_items
SET quantity = quantity - ?1, updated_at = ?3
WHERE variant_id = ?2
  AND is_available = 1
  AND (quantity - reserved_quantity) >= ?1;
```

---

## 21. Staff Authentication and RBAC

- Customer checkout has no login.
- Staff sessions use HttpOnly, Secure, SameSite=Strict cookies.
- Only HMAC-SHA256 session token hashes are stored in D1.
- Every authenticated request re-reads session and staff role from D1 before permission checks.
- Directory-level route splitting is not authorization; every SSR page, API route, and Astro action must enforce server-side RBAC.

### Session Token HMAC

```typescript
// src/lib/sessions.ts
export async function hashSessionToken(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
```

### RBAC Roles

| Role | Tier | Access |
|------|------|--------|
| `super_admin` | Owner-tier | Full system access (alias of owner) |
| `owner` | Owner-tier | Full system access — every permission implicitly |
| `manager` | Business | Daily operations: products, categories, inventory, orders, fraud view, media, reports |
| `salesman` | Business | Sales dashboard + COD order creation/updates |
| `packing` | Business | Packing queue + courier handoff (pack/ship) |
| `support` | Business | Order search + support notes |

### Authoritative Staff Session Resolution

```typescript
// src/lib/rbac.ts
export async function getCurrentStaffUser(context: APIContext): Promise<StaffUser | null> {
  const env = cloudflareEnv as { DB?: D1Database; SESSION_SECRET?: string };
  if (!env?.DB || !env.SESSION_SECRET) return null;

  const sessionToken = readSessionCookie(context.request);
  if (!sessionToken) return null;

  const tokenHash = await hashSessionToken(sessionToken, env.SESSION_SECRET);
  const now = nowSql();

  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.staff_user_id, u.role, u.full_name
     FROM staff_sessions s
     JOIN staff_users u ON u.id = s.staff_user_id
     WHERE s.token_hash = ?1
       AND s.is_revoked = 0
       AND s.expires_at > ?2
       AND s.absolute_expires_at > ?2
       AND u.is_active = 1`
  ).bind(tokenHash, now).first<{ session_id: string; staff_user_id: string; role: string; full_name: string }>();

  if (!row) return null;

  return { id: row.staff_user_id, role: row.role as StaffRole, fullName: row.full_name, sessionId: row.session_id };
}
```

---

## 22. API Routes and Stock Badge

| Route | Purpose | Protection |
|-------|---------|------------|
| `POST /api/checkout` | Guest checkout | Rate limit (20/60s), idempotency, D1 atomic reservation |
| `POST /api/orders/track` | Order tracking | Rate limit (30/60s), phone normalization |
| `POST /api/payments/create` | Create payment | Server-side order validation, atomic claim |
| `POST /api/payments/webhook` | Payment webhook | Provider API key verification + server-to-server verify + idempotency |
| `GET /api/payments/status/:id` | Payment status lookup | D1 read |
| `GET /api/stock/:variantId` | Stock badge | CDN cache (30s/60s), rate limit, zero KV write |
| `POST /api/fraud/check` | Fraud risk assessment | Rate limit (30/60s) |
| `POST /api/staff/login` | Staff login | Origin check + rate limit (10/60s) |
| `POST /api/staff/*` | Staff mutations | Rate limit + session + RBAC + CSRF |

### Stock Badge API

```typescript
// src/pages/api/stock/[variantId].ts
export const prerender = false;

import type { APIContext } from 'astro';
import { env as cloudflareEnv } from 'cloudflare:workers';

export async function GET(context: APIContext): Promise<Response> {
  const { params } = context;
  const env = cloudflareEnv as { DB: D1Database };
  const variantId = params.variantId;

  if (!variantId || typeof variantId !== 'string') {
    return Response.json({ error: 'Invalid variant ID' }, { status: 400 });
  }

  const row = await env.DB.prepare(
    `SELECT (quantity - reserved_quantity) AS available
     FROM inventory_items
     WHERE variant_id = ?1 AND is_available = 1`
  ).bind(variantId).first<{ available: number }>();

  const available = Math.max(0, row?.available ?? 0);

  return new Response(JSON.stringify({ available, source: 'd1-cdn-cached' }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=30, s-maxage=60'
    }
  });
}
```

---

## 23. KV and Cloudflare Budget Strategy

| KV use | Allowed write trigger | Rule |
|--------|----------------------|------|
| Site settings cache | Admin settings update only | Safe low-frequency writes |
| Product listing cache | Admin publish/update/archive only | No per-view writes |
| Rate-limit counters | Bounded keys with TTL | Monitor usage; compact keys |
| AI budget counters | After AI API usage only | Hard daily/monthly caps |
| Optional full stock snapshot | Manual admin restock or low-frequency scheduled job | Not required for stock badge API |
| Stock badge cache miss | Never | Public stock badge must not write KV. Use CDN-cached D1 response |
| Checkout stock | Never | Checkout uses D1 only |

---

## 24. Worker CPU and D1 Query Budget

- MVP cart hard cap: maximum 10 line items. Return `CART_TOO_LARGE` for 11+ line items.
- Use one SELECT with IN list to load variant snapshots.
- Use `db.batch()` for reservation updates, order_items inserts, stock_reservations inserts, and audit writes where possible.
- Paginate staff dashboards. Never `SELECT *` without LIMIT in staff list views.
- Chunk admin exports and maintenance tasks (25 rows per D1 batch for cleanup).
- Measure checkout and webhook CPU time under load; move heavy processing to scheduled jobs where safe.

---

## 25. Tinify + R2 Media Pipeline

- Tinify is upload-time only.
- Always store original or fallback media in R2 even if compression fails.
- Record compression status (`is_compressed`) in `product_images`.
- Retry uncompressed images via daily maintenance cron (`retryUncompressedImages` in `tinify.ts`).
- Never block staff upload solely because Tinify is down.

---

## 26. Security Controls

- Strict CORS allowlist for production, www/admin domain, and local development only.
- HSTS (`max-age=31536000; includeSubDomains; preload`), CSP, frame-ancestors (`'none'`), Referrer-Policy, Permissions-Policy, `X-Content-Type-Options`, `X-Frame-Options`.
- Rate limits: checkout (20/60s), order tracking (30/60s), login (10/60s), stock badge, fraud, AI support.
- All keys are Cloudflare secrets (`wrangler secret put`).
- Audit stock, payment, refund, fraud override, login, product publish/archive, and staff role changes.
- Use output escaping for all user-supplied text in staff dashboards and customer-facing pages.

### Security Headers (Set by Middleware)

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

### Middleware Request Pipeline

```typescript
// src/middleware.ts
export const onRequest: MiddlewareHandler = async (context, next) => {
  const { request } = context;
  const url = new URL(request.url);
  const runtimeEnv = cloudflareEnv as { CACHE?: KVNamespace; PUBLIC_SITE_URL?: string; SESSION_SECRET?: string };

  // 1. Origin validation for login
  if (url.pathname === '/api/staff/login' && !originAllowed(request, runtimeEnv?.PUBLIC_SITE_URL)) {
    return withSecurityHeaders(Response.json({ error: 'Invalid origin' }, { status: 403 }));
  }

  // 2. Rate limiting (KV-backed sliding window)
  const limited = await rateLimit(context, url.pathname);
  if (limited) return withSecurityHeaders(limited);

  // 3. Staff mutation CSRF verification
  if (STAFF_MUTATION_PATHS.test(url.pathname) && !SAFE_METHODS.has(request.method) && !CSRF_EXEMPT_PATHS.has(url.pathname)) {
    const cookieToken = getCookieValue(request.headers.get('Cookie'), 'csrf-token');
    const headerToken = request.headers.get('X-CSRF-Token');

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return withSecurityHeaders(Response.json({ error: 'Invalid CSRF token' }, { status: 403 }));
    }

    const secret = runtimeEnv?.SESSION_SECRET;
    if (!secret || !(await verifyCsrfToken(cookieToken, secret))) {
      return withSecurityHeaders(Response.json({ error: 'Invalid CSRF token signature' }, { status: 403 }));
    }
  }

  return withSecurityHeaders(await next());
};
```

---

## 27. CSRF Protection Implementation

All non-GET staff/admin mutations must pass CSRF, not only API routes. The CSRF token must be a JS-readable independent nonce signed with HMAC. It must never contain the raw staff session token.

### Token Format

```
csrfNonce (32 random bytes hex) . HMAC-SHA256(csrfNonce, SESSION_SECRET)
```

### Implementation

```typescript
// src/lib/security.ts
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export function generateRandomHex(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256Hex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createCsrfToken(secret: string): Promise<string> {
  const nonce = generateRandomHex(32);
  const hmac = await hmacSha256Hex(nonce, secret);
  return `${nonce}.${hmac}`;
}

export async function verifyCsrfToken(token: string, secret: string): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [nonce, hmac] = parts;
  if (!nonce || !hmac) return false;
  const expected = await hmacSha256Hex(nonce, secret);
  return timingSafeEqualHex(expected, hmac);
}
```

### Safe Cookie Pattern (Staff Login)

```typescript
// Login sets two separate cookies:
const sessionToken = generateSessionToken();
// ... insert session hash into D1 ...

// 1. HttpOnly session cookie (not readable by JavaScript)
headers.append('Set-Cookie', serializeCookie('staff-session', sessionToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
  path: '/',
  maxAge: SESSION_TTL_SECONDS
}));

// 2. JS-readable CSRF cookie (independent nonce, NOT the session token)
const csrfToken = await createCsrfToken(env.SESSION_SECRET);
headers.append('Set-Cookie', serializeCookie('csrf-token', csrfToken, {
  httpOnly: false,
  secure: true,
  sameSite: 'Strict',
  path: '/',
  maxAge: SESSION_TTL_SECONDS
}));

// Never build csrf-token from sessionToken. Never expose sessionToken outside staff-session.
```

---

## 28. SEO, Meta Pixel, and Performance

- Static product pages include title, meta description, canonical, Open Graph, and product schema at build time.
- Use Tinify-optimized R2 media with width/height attributes.
- Use Astro islands only for cart, checkout, stock badge, staff dashboards, and theme toggle.
- Islands hydrate with `client:idle` (non-critical, after page load).
- Meta Pixel events: PageView, ViewContent, AddToCart, InitiateCheckout, Purchase/Lead.
- Sitemap and robots.txt generated during build.

---

## 29. Build and Deployment Workflow

### Local Development

```bash
# Prerequisites: Node.js 20+, Cloudflare account, Wrangler
git clone <repo>
cd zabir-boutiques
npm install
cp .env.example .env.local
# Edit .env.local with your Cloudflare credentials

# Run D1 migrations locally
npm run db:migrate:local

# Seed sample data (optional)
npx tsx scripts/seed.ts

# Start development server
npm run dev
```

### Scripts (from package.json)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Astro dev server |
| `npm run build` | Generate D1 snapshots + Astro production build |
| `npm run build:snapshots` | Generate D1 snapshots only |
| `npm run build:with-snapshots` | Snapshots + build (used by CI and deploy) |
| `npm run build:skip-snapshots` | Astro build without regenerating snapshots |
| `npm run preview` | Preview production build locally |
| `npm run typecheck` | `astro check` + `tsc --noEmit` |
| `npm test` | Run Vitest test suite once |
| `npm run db:migrate:local` | Apply migrations to local D1 |
| `npm run db:migrate:prod` | Apply migrations to remote D1 |
| `npm run deploy` | Build (with snapshots) + deploy to Cloudflare Pages |

### Production Deployment

**Cloudflare Pages native Git integration** (recommended):
1. Push to `main` — Cloudflare auto-builds + deploys
2. PRs automatically get preview URLs

**Manual CLI:**
```bash
CF_ACCOUNT_ID=xxx CF_D1_DATABASE_ID=xxx CF_D1_READ_TOKEN=xxx npm run build:with-snapshots
wrangler pages deploy dist --project-name zabir-boutiques
```

### CI/CD (GitHub Actions)

On every push and PR:
- TypeScript type checking (`npm run typecheck`)
- 122 Vitest tests (`npm test`)
- Build verification (`npm run build:with-snapshots`, with D1 snapshots if secrets are available)

---

## 30. Scheduled Jobs and Cron Dispatch

Cron triggers are declared in `wrangler.jsonc` (`triggers.crons`) and routed by `src/lib/cron-dispatch.ts`. The cron entry point is `src/entry-cloudflare.ts` (Worker scheduled handler), NOT a Pages Function.

| Job | Frequency | Purpose |
|-----|-----------|---------|
| Reservation cleanup + FraudBD poll | Every 10 minutes | Release expired reservations, poll eligible fraud_polls |
| Daily maintenance | Daily 03:00 UTC | Session cleanup, Tinify retry, idempotency expiry cleanup |
| D1 backup to R2 | Weekly Sunday 04:00 UTC | Export key business tables to R2 |
| Log archive | Monthly 1st 05:00 UTC | Archive old payment_events/fraud_checks/audit logs to R2 |

```typescript
// src/entry-cloudflare.ts
import { dispatchCron } from './lib/cron-dispatch';
import type { Env } from './env';

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron;
    console.log(`[cron] Triggered: ${cron}`);
    ctx.waitUntil(dispatchCron(cron, env as any));
  },
} satisfies ExportedHandler<Env>;
```

```typescript
// src/lib/cron-dispatch.ts
export const CRON_HANDLERS: Record<string, CronHandler> = {
  '*/10 * * * *': async (env) => {
    const { cleanExpiredReservations } = await import('./inventory');
    const { pollPendingFraudChecks, sweepTimedOutFraudPolls } = await import('./fraud');
    await cleanExpiredReservations(env.DB);
    await pollPendingFraudChecks(env.DB, env.FRAUDBD_API_KEY);
    await sweepTimedOutFraudPolls(env.DB);
  },
  '0 3 * * *': async (env) => {
    const { cleanExpiredSessions } = await import('./sessions');
    const { retryUncompressedImages } = await import('./tinify');
    const { cleanExpiredIdempotencyKeys } = await import('./maintenance/idempotency');
    await cleanExpiredSessions(env.DB);
    await retryUncompressedImages(env.DB, env.MEDIA, env.TINIFY_API_KEY);
    await cleanExpiredIdempotencyKeys(env.DB);
  },
  '0 4 * * 0': async (env) => {
    const { backupD1ToR2 } = await import('./maintenance/backup');
    await backupD1ToR2(env.DB, env.BACKUPS);
  },
  '0 5 1 * *': async (env) => {
    const { archiveOldEvents } = await import('./maintenance/archive');
    await archiveOldEvents(env.DB, env.BACKUPS);
  }
};
```

---

## 31. Testing Protocol

**122 tests across 14 files** covering:

- **Phone tests**: 017, +880, 880, 10-digit 1XXXXXXXXX, malformed, foreign numbers.
- **Regex tests**: every code file uses real ASCII caret `^` where needed; no circumflex `ˆ` remains.
- **Checkout tests**: missing fields, invalid cart, negative quantity, duplicate idempotency key, out of stock.
- **Price tampering tests**: send `unit_price_paisa: 1` with internally consistent client subtotal/total; checkout must persist D1 `price_paisa` and reject or ignore client money.
- **Discount tampering tests**: send `discount_paisa` close to total; checkout must calculate discount only through `applyCouponAtomic()`.
- **Order item snapshot tests**: `order_items.unit_price_paisa` must equal the D1 variant `price_paisa` loaded during checkout.
- **CSRF exposure tests**: `csrf-token` cookie must not contain the raw session token or any reversible segment of it.
- **XSS session-hardening tests**: reading `csrf-token` must not be enough to derive `staff-session`; `staff-session` remains HttpOnly.
- **Cart cap test**: 11 line items returns `CART_TOO_LARGE`.
- **Race tests**: 10 parallel Workers reserve last 1 unit; exactly 1 ok:true, 9 ok:false.
- **Multi-variant failure test**: item 1 and 3 succeed, item 2 fails; both successful reservations are released.
- **Coupon race test**: 20 checkouts, 1-use coupon; exactly 1 claim succeeds.
- **Payment tests**: duplicate webhook does not double-confirm or double-deduct.
- **Expired reservation paid webhook test**: if stock available, direct deduction succeeds; if unavailable, order becomes `paid_over_allocated`.
- **CSRF tests**: non-GET `/api/staff/*` and `/staff/*` without valid token returns 403; valid token passes.
- **Cron build test**: no imports from `../env.d` or `../scripts/*` in runtime code.
- **Schema naming test**: no `revoked`/`is_read` references remain if canonical names are `is_revoked`/`is_acknowledged`.

---

## 32. Disaster Recovery and Backup

- **RTO target**: 1 hour for business-critical admin/order access.
- **RPO target**: 24 hours initially; upgrade to daily backup if order volume grows.
- **Backups stored in R2**: `backups/d1/weekly/YYYY-MM-DD-zabir-db.json`.
- **Keep last 8 weekly backups minimum**.
- **Never restore directly to production** without staging verification.

---

## 33. Developer Guardrails

- Public storefront pages use `prerender = true` unless dynamic is unavoidable.
- Checkout/admin/API routes use `prerender = false`.
- D1 is the only source of truth.
- Use SQLite syntax only.
- Generate UUIDs in runtime code.
- Store money as INTEGER paisa only.
- `checkout.ts` may accept only `variantId`, `qty`, `shipping_zone`, `coupon_code`, customer identity, address, note, and `payment_method` from the browser; never accept price authority from the browser.
- Never compare a client subtotal to another client subtotal. `TOTAL_MISMATCH` is meaningful only when server-computed totals are compared against payment provider/server records.
- `order_items` must store server-loaded `price_paisa` snapshots, not `unitPricePaisa` from the request body.
- `csrf-token` format is `csrfNonce.hmac(csrfNonce)`; it must never be `sessionToken.hmac(sessionToken)`.
- Normalize phone before all downstream use.
- Never trust KV stock at checkout.
- Never write KV on public stock badge cache miss.
- Use server-to-server UddoktaPay verification before paid status.
- Use `INSERT OR IGNORE` and `UNIQUE(invoice_id, event_type, status)` for webhook idempotency.
- Use `hashSessionToken()` for staff sessions.
- All non-GET staff/admin mutations require session + RBAC + CSRF.
- Use `timingSafeEqualHex()` for HMAC comparison.
- Never import runtime cron jobs from root `scripts/`. Runtime maintenance code lives under `src/lib/maintenance/`.
- Never create order rows before `reserveVariants()` succeeds.
- `order_items` must capture snapshots at checkout time.
- Do not commit `src/data/*.json` snapshot artifacts.
- Bind runtime env via `import { env } from 'cloudflare:workers'`, not deprecated `context.locals.runtime.env`.

---

## 34. Source Notes

- Astro Cloudflare adapter documentation: <https://docs.astro.build/en/guides/integrations-guide/cloudflare/>
- Cloudflare Workers limits documentation: <https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare D1 limits documentation: <https://developers.cloudflare.com/d1/platform/limits/>
- Cloudflare Workers KV limits documentation: <https://developers.cloudflare.com/kv/platform/limits/>
- Cloudflare Pages/Functions bindings documentation: <https://developers.cloudflare.com/pages/functions/bindings/>
- UddoktaPay documentation: <https://docs.uddoktapay.com/>
- FraudBD API documentation: <https://fraudbd.com/api-documentation>

---

*End of Zabir Boutiques AI Commerce Master Plan — Client Edition v6.8C*

*Production Reconciled — Accurate as of June 2026*
