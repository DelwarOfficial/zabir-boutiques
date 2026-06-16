# Page 1

Zabir Boutiques Dev Prompt v7.0  |  Page 1
DEVELOPMENT PROMPT
Zabir Boutiques
AI Commerce Platform
Pro Development Prompt v7.0 — 100% Master Plan Compliance
Based on: Full Red-Team Codebase Review of github.com/DelwarOfficial/zabir-boutiques
Aligned to: Zabir Boutiques AI Commerce Master Plan v7.0
This document is a production-grade development prompt for rebuilding Zabir Boutiques to 100% compliance
with the Master Plan v7.0. It incorporates findings from a deep red-team review of the existing codebase (v6.8D),
identifies every gap between current implementation and the v7.0 specification, and provides exact
implementation instructions with file paths, code patterns, Cloudflare configurations, and acceptance criteria.

---

# Page 2

Zabir Boutiques Dev Prompt v7.0  |  Page 2
1. Red-Team Codebase Assessment
The following assessment is derived from a line-by-line review of every source file in the existing codebase at commit
HEAD. It identifies what exists, what is partially implemented, and what is entirely missing relative to the Master Plan
v7.0.
1.1 What Exists and Is Sound
Checkout flow (src/pages/api/checkout.ts) — Server-authoritative pricing, idempotency, FraudBD integration,
coupon atomic claim/release. Core logic is production-quality.
Money library (src/lib/money.ts) — INTEGER paisa throughout with assertPaisa guards. No floating-point money.
Well-designed.
RBAC system (src/lib/rbac.ts) — Comprehensive 8-role permission matrix with super_admin vs owner distinction.
Platform-control vs business-level separation. Strong.
Security (src/lib/security.ts) — HMAC-SHA256 CSRF tokens, timing-safe comparison, cryptographically random
nonce generation. Solid foundation.
Session management (src/lib/sessions.ts) — HMAC-SHA256 token hashing, D1 session storage with absolute and
sliding expiry. Clean implementation.
Audit log (src/lib/audit.ts) — Hash-chained append-only audit log with integrity verification, checkpoints, and
triggers preventing UPDATE/DELETE. Production-grade.
Middleware (src/middleware.ts) — CSRF double-submit, origin validation on login, KV rate limiting (7 rules), central
auth guard, comprehensive security headers. Well-structured.
D1 Schema (db/migrations/0001_initial_v6_8a_schema.sql) — 21 tables with CHECK constraints on
payment_method, payment_status, order_status, money fields. FK with RESTRICT. Append-only audit triggers.
Password handling (src/lib/password.ts) — PBKDF2 with 100K iterations + pepper. Transparent legacy HMAC
migration. Constant-time comparison.
Inventory reservation (src/lib/inventory.ts) — Reserve-first with compensating release on partial failure. Bounded
chunked cleanup. Good pattern.
1.2 Critical Gaps (Must Fix)
Gap
Current State
Required Fix
Priori
ty
Astro output mode is
'static'
checkout.ts has prerender=false but
astro.config is missing from repo. Must be
output:'hybrid'. Without it, all server
routes may fail.
Set output:'hybrid' in astro.config.mjs. Verify
all server routes have prerender=false.
Critical
No Durable Objects for
stock serialization
reserveVariants() uses D1 batch UPDATE
which races under concurrency. Two
Workers can both pass (quantity -
reserved_quantity) >= qty check before
either writes.
Create VariantInventoryDO class. Route all
reserveVariants() calls through DO per
variant. DO serializes requests.
Critical
No Cloudflare Queues
Payment webhooks processed
synchronously in the Worker. If webhook
processing fails after response, payment is
lost. No retry mechanism.
Create payment-webhooks, order-emails,
image-processing, fraud-scoring, d1-backup
queues in wrangler.jsonc.
Critical

---

# Page 3

Zabir Boutiques Dev Prompt v7.0  |  Page 3
Gap
Current State
Required Fix
Priori
ty
No payment
reconciliation cron
Webhook failures leave paid orders in
'pending' indefinitely. No mechanism to
detect or fix this.
Add 15-minute reconciliation cron that
queries UddoktaPay status API for orders in
pending state.
Critical
No Turnstile bot
protection
Checkout and login have no bot detection.
Automated bulk ordering and credential
stuffing are unblocked.
Add Turnstile to checkout (invisible) and staff
login (managed). Verify token server-side.
Critical
No WAF rules
configured
No Cloudflare WAF managed ruleset or
custom rules mentioned anywhere in
codebase.
Enable WAF managed ruleset. Add custom
rules for staff routes, checkout rate limiting,
bot challenges.
Critical
No observability stack
Zero Logpush, Analytics Engine, or custom
metrics. Production incidents invisible.
Configure Logpush to R2. Add Workers
Analytics Engine for 9 business metrics. Set up
alerting.
Critical
No return/refund flow
Order state machine has no 'returned' or
'refunded' states. No API endpoints for
returns. Stock not restocked on return.
Add return request, approval, restock, and
refund API endpoints. Extend order state
machine.
Critical
Stock reservation TTL
is 30 minutes
Code sets expires_at to now+30min, but
cleanup cron runs every 10min.
Reservations can persist 40min past
creation.
Reduce reservation TTL to 10min. Run
cleanup every 5min. Or use DO-based timers.
High
No Zero Trust for staff
routes
Staff routes protected only by cookie auth.
No IP restriction, no device posture.
Configure Cloudflare Zero Trust Access for
/api/staff/* and /staff/* routes.
High
No search architecture
No product search capability. D1 LIKE is
insufficient for production.
Implement FTS5 for Phase 1. Plan Workers AI
semantic search for Phase 2.
High
No email system
No order confirmation, shipping
notification, or password reset emails.
Integrate Resend API. Add order-emails
queue. Create React Email templates.
High
No SEO: no sitemap,
no JSON-LD, no
canonical URLs
Product pages lack structured data, meta
tags, and sitemap.xml generation.
Add JSON-LD Product schema to all product
pages. Generate sitemap via cron. Add
canonical URLs.
High
No Cache API usage
src/lib/cache.ts has only KV helpers. No
Cloudflare Cache API implementation. No
stale-while-revalidate.
Implement Cache API with SWR for product
pages. Add cache-tag purging.
High
No environment
separation
wrangler.jsonc has single D1, R2, KV
bindings. No dev/staging/prod isolation.
Add environment-specific bindings via
wrangler.jsonc env sections. Separate D1
databases.
High
CSP has unsafe-inline
for scripts
middleware.ts sets script-src 'self'
'unsafe-inline'. XSS risk. TODO comment
acknowledges this.
Migrate to Astro 6 built-in CSP with script
hashing. Remove unsafe-inline.
High
No image optimization
pipeline
No Cloudflare Image Resizing. No
WebP/AVIF. No responsive srcset. Tinify
mentioned in cron but no upload flow.
Configure Image Resizing with 5 variants. Add
responsive srcset. Implement direct R2
upload.
High
Idempotency uses D1
INSERT race
claimIdempotency() uses INSERT which
races across Workers. Two Workers could
both insert before either catches the
UNIQUE error.
Route idempotency through IdempotencyDO
for atomic claim. Or use INSERT OR IGNORE
with check.
Medium

---

# Page 4

Zabir Boutiques Dev Prompt v7.0  |  Page 4
2. Implementation Instructions
The following sections provide exact implementation instructions for each component required by the Master Plan
v7.0. Each instruction specifies the file path, the exact code or configuration to add, and the acceptance criteria.
2.1 Astro Configuration Fix
File: astro.config.mjs
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
output: 'hybrid', // NOT 'static' - enables per-route server rendering
adapter: cloudflare({
runtime: { mode: 'advanced' },
routes: { extend: { exclude: ['/api/*'] } }
}),
integrations: [react()],
vite: { plugins: [tailwindcss()] }
});
Acceptance: All routes with prerender=false execute in Workers. Static pages serve from CDN. Build succeeds
without errors.
2.2 Wrangler Configuration — Full Service Matrix
File: wrangler.jsonc — Add Durable Objects, Queues, Cron Triggers
{
"durable_objects": {
"bindings": [
{ "name": "VARIANT_INVENTORY", "class_name": "VariantInventoryDO" },
{ "name": "CART", "class_name": "CartDO" },
{ "name": "BUDGET_COUNTER", "class_name": "BudgetCounterDO" },
{ "name": "IDEMPOTENCY", "class_name": "IdempotencyDO" }
]
},
"queues": {
"producers": [
{ "queue": "payment-webhooks", "binding": "PAYMENT_WEBHOOKS" },
{ "queue": "order-emails", "binding": "ORDER_EMAILS" },
{ "queue": "image-processing", "binding": "IMAGE_PROCESSING" },
{ "queue": "fraud-scoring", "binding": "FRAUD_SCORING" },
{ "queue": "d1-backup", "binding": "D1_BACKUP" }
],
"consumers": [
{ "queue": "payment-webhooks", "max_batch_size": 5, "max_retries": 5, "dead_letter_queue":
"payment-webhooks-dlq" },
{ "queue": "order-emails", "max_batch_size": 10, "max_retries": 3 },
{ "queue": "image-processing", "max_batch_size": 5, "max_retries": 3 },
{ "queue": "fraud-scoring", "max_batch_size": 10, "max_retries": 2 },
{ "queue": "d1-backup", "max_batch_size": 1, "max_retries": 2 }
]
},
"triggers": {
"crons": ["*/5 * * * *","*/15 * * * *","0 */6 * * *","0 2 * * *","*/30 * * * *","0 3 * * *","0 0 1 *
*","0 9 * * 1"]
}
}

---

# Page 5

Zabir Boutiques Dev Prompt v7.0  |  Page 5
Acceptance: wrangler deploy succeeds. Durable Objects, Queues, and Cron Triggers visible in Cloudflare dashboard.
2.3 Durable Objects Implementation
File: src/do/variant-inventory-do.ts
export class VariantInventoryDO implements DurableObject {
private state: DurableObjectState;
private stock: number = 0;
private reserved: number = 0;
private initialized: boolean = false;
constructor(state: DurableObjectState, env: Env) {
this.state = state;
this.state.blockConcurrencyWhile(async () => {
const stored = await this.state.storage.get(["stock","reserved"]);
this.stock = (stored.get("stock") as number) ?? 0;
this.reserved = (stored.get("reserved") as number) ?? 0;
this.initialized = true;
});
}
async fetch(request: Request): Promise {
const url = new URL(request.url);
const action = url.pathname.slice(1); // "reserve" | "release" | "sync"
const body = await request.json() as { qty: number };
const available = this.stock - this.reserved;
if (action === "reserve") {
if (body.qty > available) return Response.json({ ok: false, available });
this.reserved += body.qty;
await this.state.storage.put({ stock: this.stock, reserved: this.reserved });
return Response.json({ ok: true, available: this.stock - this.reserved });
}
if (action === "release") {
this.reserved = Math.max(0, this.reserved - body.qty);
await this.state.storage.put({ stock: this.stock, reserved: this.reserved });
return Response.json({ ok: true });
}
if (action === "sync") { // Sync from D1 source of truth
this.stock = body.qty; // body.qty = D1 quantity value
await this.state.storage.put({ stock: this.stock, reserved: this.reserved });
return Response.json({ ok: true });
}
return Response.json({ error: "unknown action" }, { status: 400 });
}
}
Integration: Modify src/lib/inventory.ts reserveVariants() to route through VariantInventoryDO. DO is the
concurrency gate; D1 remains the source of truth. After DO confirms reservation, write to D1 as before.
Sync Strategy: On DO creation, fetch current stock from D1. On any D1 stock update (restock, adjustment), sync DO
via /sync endpoint.
File: src/do/idempotency-do.ts
export class IdempotencyDO implements DurableObject {
private state: DurableObjectState;
private keys: Map<string, { status: string; orderId?: string; response?: string; expiresAt: number
}> = new Map();
constructor(state: DurableObjectState) { this.state = state; }
async fetch(request: Request): Promise {
const body = await request.json() as any;
const key = body.key;

---

# Page 6

Zabir Boutiques Dev Prompt v7.0  |  Page 6
const now = Date.now();
const existing = this.keys.get(key);
if (existing && existing.expiresAt > now) {
if 
(existing.status 
=== 
"complete") 
return 
Response.json({ 
ok: 
true, 
replay: 
true,
...JSON.parse(existing.response ?? "{}") });
return Response.json({ ok: false, code: "PROCESSING" }, { status: 409 });
}
// Claim
this.keys.set(key, { status: "processing", expiresAt: now + 24*60*60*1000 });
return Response.json({ ok: true, claimed: true });
}
}
Acceptance: Two concurrent checkout requests for the same variant with the same idempotency key return exactly
one order. No duplicate orders.

---

# Page 7

Zabir Boutiques Dev Prompt v7.0  |  Page 7
2.4 Queue Consumer Implementations
File: src/queues/payment-webhook-consumer.ts
export default {
async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
for (const msg of batch.messages) {
try {
const { invoiceId } = msg.body;
// Verify HMAC signature (already done at webhook endpoint)
// Verify payment server-to-server with UddoktaPay
const 
verified 
= 
await 
verifyUddoktaPayment(invoiceId, 
env.UDDOKTAPAY_API_KEY,
env.UDDOKTAPAY_BASE_URL);
if (verified.status === "paid") {
// Update order payment_status in D1
// Deduct stock from reserved if full payment
// Mark stock_reservations as confirmed
}
msg.ack();
} catch (err) {
console.error("[payment-webhook-consumer]", err);
msg.retry({ delaySeconds: 5 });
}
}
}
};
Acceptance: Webhook failures are retried up to 5 times with exponential backoff. Failed messages go to DLQ for
manual review. Payment never silently lost.
File: src/queues/order-email-consumer.ts
Provider: Resend API. Template: React Email rendered to HTML.
Acceptance: Order confirmation email sent within 60 seconds of order creation. Template includes order number,
items, total, delivery estimate.
2.5 Cron Triggers — Complete Schedule
// Updated src/lib/cron-dispatch.ts
export const CRON_HANDLERS: Record<string, CronHandler> = {
"*/5 * * * *": async (env) => {
// Stock cleanup: release expired reservations (10min TTL)
const { cleanExpiredReservations } = await import("./inventory");
await cleanExpiredReservations(env.DB, 200);
},
"*/15 * * * *": async (env) => {
// Payment reconciliation: check UddoktaPay for pending orders
const { reconcilePendingPayments } = await import("./maintenance/reconciliation");
await reconcilePendingPayments(env.DB, env.UDDOKTAPAY_API_KEY, env.UDDOKTAPAY_BASE_URL);
},
"0 */6 * * *": async (env) => {
// D1 backup to R2
const { backupD1ToR2 } = await import("./maintenance/backup");
await backupD1ToR2(env.DB, env.BACKUPS);
},
"0 2 * * *": async (env) => {
// Sitemap generation
const { generateSitemap } = await import("./maintenance/sitemap");
await generateSitemap(env.DB, env.MEDIA);
},
// ... remaining handlers
};

---

# Page 8

Zabir Boutiques Dev Prompt v7.0  |  Page 8
2.6 Cache API Implementation
File: src/lib/cache-api.ts
const CACHE_TTL: Record<string, { maxAge: number; staleWhileRevalidate: number }> = {
product_detail: { maxAge: 3600, staleWhileRevalidate: 86400 }, // 1hr / 1 day
category_listing: { maxAge: 1800, staleWhileRevalidate: 7200 }, // 30min / 2hr
homepage: { maxAge: 600, staleWhileRevalidate: 3600 }, // 10min / 1hr
api_product: { maxAge: 300, staleWhileRevalidate: 600 }, // 5min / 10min
};
export 
async 
function 
cachedFetch(request: 
Request, 
type: 
keyof 
typeof 
CACHE_TTL):
Promise<Response> {
const cache = caches.default;
const cached = await cache.match(request);
if (cached) return cached;
// Fetch from origin, cache, return
const response = await fetch(request); // or build response from D1
const ttl = CACHE_TTL[type];
const headers = new Headers(response.headers);
headers.set("Cache-Control", `public, max-age=${ttl.maxAge}, s-maxage=${ttl.staleWhileRevalidate},
stale-while-revalidate=${ttl.staleWhileRevalidate}`);
const cachedResponse = new Response(response.body, { ...response, headers });
await cache.put(request, cachedResponse.clone());
return cachedResponse;
}
export async function purgeCacheTag(tag: string): Promise<void> {
// Use Cloudflare API to purge by cache tag
// POST https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache
// Body: { "tags": [tag] }
}
Acceptance: Product page served from cache on repeat visit. Cache purged within 5 minutes of product update.
Cache hit rate above 70% for product pages.
2.7 SEO Implementation
File: src/pages/products/[slug].astro — Add JSON-LD
<script type="application/ld+json set:html={JSON.stringify({
"@context": "https://schema.org",
"@type": "Product",
"name": product.name,
"image": product.images.map(i => i.url),
"description": product.description,
"sku": product.sku,
"offers": {
"@type": "Offer",
"price": (product.price_paisa / 100).toFixed(2),
"priceCurrency": "BDT",
"availability": product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
"url": `${Astro.site}products/${product.slug}`
}
})} />
Also add: Canonical URL, og:title, og:image, og:description, meta description, BreadcrumbList schema to every
page.
Sitemap: Create src/lib/maintenance/sitemap.ts. Generate XML from D1 products/categories. Upload to R2. Serve
at /sitemap.xml.
2.8 Order State Machine — Complete

---

# Page 9

Zabir Boutiques Dev Prompt v7.0  |  Page 9
File: src/lib/order-state-machine.ts
Define the complete order state machine with all transitions, guards, and side effects:
type 
OrderStatus 
=
"created"|"confirmed"|"processing"|"shipped"|"delivered"|"cancelled"|"returned"|"refunded";
type PaymentStatus = "created"|"pending"|"processing"|"paid"|"partially_paid"|"failed"|"cancelled"
|"expired"|"refunded"|"partially_refunded";
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
created: ["confirmed", "cancelled"],
confirmed: ["processing", "cancelled"],
processing: ["shipped", "cancelled"],
shipped: ["delivered", "returned"],
delivered: ["returned"],
cancelled: [], // terminal
returned: ["refunded"],
refunded: [], // terminal
};
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
return TRANSITIONS[from]?.includes(to) ?? false;
}
export async function transitionOrder(db: D1Database, orderId: string, to: OrderStatus, actor:
StaffUser, note?: string): Promise<void> {
const order = await db.prepare("SELECT status FROM orders WHERE id = ?1").bind(orderId).first();
if (!order || !canTransition(order.status as OrderStatus, to)) throw new Error("Invalid
transition");
await db.prepare("UPDATE orders SET status = ?2, updated_at = ?3 WHERE id = ?1").bind(orderId, to,
nowSql()).run();
// Side effects: restock on cancel/return, refund on refund, send emails
await writeAuditLog(db, { action: `order.transition.${to}`, entityId: orderId, ... });
}
Acceptance: Invalid transitions are rejected. All transitions logged in audit. Stock restocked on cancel/return.
Refund triggered on refund transition.
2.9 Return and Refund Endpoints
File: src/pages/api/staff/returns/index.ts
POST /api/staff/returns — Create return request. RBAC: orders.update. Fields: order_id, items[], reason
POST /api/staff/returns/{id}/approve — Approve return. RBAC: payments.refund. Side effects: restock items in D1,
initiate refund via UddoktaPay for prepaid amounts, update order status to 'returned'
POST /api/staff/returns/{id}/reject — Reject return. RBAC: orders.update. Update order status remains 'delivered'
Acceptance: Approved returns auto-restock inventory. Refund triggered for prepaid amounts. All actions logged in
audit.
2.10 Email System
File: src/lib/email.ts
import Resend from "resend";
export async function sendOrderConfirmation(env: Env, order: any): Promise<void> {
const resend = new Resend(env.RESEND_API_KEY);
await resend.emails.send({
from: "Zabir Boutiques <orders@zabirboutiques.com>",
to: order.phone.includes("@") ? order.phone : undefined, // Email if available
subject: `Order Confirmed - ${order.order_number}`,
html: renderOrderConfirmationHtml(order),

---

# Page 10

Zabir Boutiques Dev Prompt v7.0  |  Page 10
});
}
Add to env.d.ts: RESEND_API_KEY: string
Add to wrangler.jsonc secrets: RESEND_API_KEY
2.11 Image Pipeline
Current state: Tinify cron exists but no upload flow or Image Resizing. Required changes:
R2 Public Bucket: Configure custom domain cdn.zabirboutiques.com for MEDIA bucket
Staff Upload: Pre-signed URL upload direct to R2 from browser (CORS enabled)
Image Resizing: Use Cloudflare Image Resizing via /cdn-cgi/image/ URL path. No server-side resizing needed.
Responsive Delivery: srcset with 150w, 400w, 800w, 1600w variants. format=webp, format=avif
Lazy Loading: loading='lazy' decoding='async' on all below-fold images. width/height set to prevent CLS.
2.12 Environment Separation
// wrangler.jsonc — add environment blocks
"env": {
"staging": {
"d1_databases": [{ "binding": "DB", "database_name": "zabir-db-staging", "database_id": "..." }],
"kv_namespaces": [{ "binding": "CACHE", "id": "..." }, { "binding": "SESSION", "id": "..." }],
"r2_buckets": [{ "binding": "MEDIA", "bucket_name": "zabir-media-staging" }],
"vars": { "PUBLIC_SITE_URL": "https://staging.zabirboutiques.com" }
},
"dev": { ... }
}

---

# Page 11

Zabir Boutiques Dev Prompt v7.0  |  Page 11
3. Database Migrations Required
The following migrations bridge the gap between the current schema (0001-0009) and the v7.0 specification.
Migra
tion
Description
Action
Rationale
0010
Add 'returned' and 'refunded'
to order status CHECK
ALTER TABLE orders RENAME TO orders_old; CREATE
TABLE orders (...with new status values); INSERT INTO
orders SELECT * FROM orders_old; DROP TABLE
orders_old;
Must fix before returns work
0011
Add 'partially_refunded' to
payment_status CHECK
Same rename-and-recreate pattern for payments table
Required for partial refund
tracking
0012
Add stock_adjustments audit
table
CREATE TABLE stock_adjustments (id TEXT PRIMARY KEY,
variant_id TEXT, delta INTEGER NOT NULL, reason TEXT,
adjusted_by TEXT, created_at TEXT NOT NULL);
Required for inventory
reconciliation
0013
Add email_log table
CREATE TABLE email_log (id TEXT PRIMARY KEY, order_id
TEXT, email_type TEXT NOT NULL, recipient TEXT, status
TEXT, sent_at TEXT, error_message TEXT);
Required for email tracking
0014
Add return_requests table
CREATE TABLE return_requests (id TEXT PRIMARY KEY,
order_id TEXT REFERENCES orders(id), items_json TEXT
NOT NULL, reason TEXT, status TEXT CHECK(status IN
('pending','approved','rejected','completed')),
reviewed_by TEXT, created_at TEXT);
Required for return flow
0015
Add sitemap metadata table
CREATE TABLE sitemap_metadata (id TEXT PRIMARY KEY,
url TEXT NOT NULL, last_modified TEXT, priority REAL
DEFAULT 0.5, change_frequency TEXT DEFAULT 'weekly');
Required for SEO sitemap
generation
0016
Add customer_consent table
CREATE TABLE customer_consent (id TEXT PRIMARY KEY,
session_id TEXT, consent_type TEXT NOT NULL, granted
INTEGER NOT NULL DEFAULT 0, granted_at TEXT,
ip_address TEXT);
Required for privacy compliance

---

# Page 12

Zabir Boutiques Dev Prompt v7.0  |  Page 12
4. Security Hardening Checklist
Item
Implementation
Rationale
Turnstile on Checkout
Add invisible Turnstile widget to GuestCheckout.tsx. Verify token
server-side in checkout.ts before processing.
Prevents automated checkout bots and
bulk ordering scripts
Turnstile on Staff Login
Add managed Turnstile widget to staff/login.astro. Verify in login.ts.
Prevents credential stuffing attacks
WAF Managed Ruleset
Enable Cloudflare WAF managed ruleset (OWASP Core). No code
change; dashboard configuration.
Blocks SQL injection, XSS, SSRF, and
common attack patterns
Custom WAF Rules
Rule 1: Block non-BD IPs on /api/staff/*. Rule 2: Challenge bots on
/api/checkout. Rule 3: Rate limit coupon attempts.
Network-level defense for staff routes
and checkout
Zero Trust Access
Configure Cloudflare Zero Trust for /staff/* and /api/staff/* routes.
Require email OTP for staff access.
Eliminates need for VPN; device posture
verification
CSP Script Hashing
Replace 'unsafe-inline' with Astro 6 built-in CSP using script hashing.
Remove TODO in middleware.ts.
Eliminates XSS vector from inline scripts
Session Idle Timeout
Current: 24-hour sliding. Required: 30-minute idle + 8-hour absolute.
Update login.ts cookie Max-Age and session validation.
Limits damage from compromised
sessions
Session Revocation
Add KV-backed session blacklist. On logout, add token hash to KV with
TTL. Check blacklist in requireAuth().
Enables immediate session termination
2FA for Owner Role
Add TOTP-based 2FA option. Enforce for owner/super_admin roles. Use
Web Crypto API for secret generation.
Protects highest-privilege accounts
Coupon Brute-Force
Protection
Add rate limit: 5 attempts per minute per session. Lock for 30 minutes
after 5 failures. Log attempts in audit.
Prevents coupon code enumeration
PII Scrubbing in Logs
Add Logpush filter to strip phone numbers and addresses before
persistence. Configure in Cloudflare dashboard.
Prevents PII exposure in log storage
HMAC Webhook
Verification
Current: API key header check. Required: Add HMAC-SHA256 body
signature verification for UddoktaPay webhooks.
Prevents webhook forgery

---

# Page 13

Zabir Boutiques Dev Prompt v7.0  |  Page 13
5. Performance and SEO Checklist
Item
Implementation
Impact
Cache API for Product
Pages
Implement src/lib/cache-api.ts with SWR. Cache product HTML for 1hr,
stale for 1 day.
Eliminates D1 query on every request;
70%+ cache hit rate
R2 Custom Domain for
Images
Configure cdn.zabirboutiques.com mapping to R2 MEDIA bucket with
CDN caching.
Edge-cached images; 7-day TTL; no
Worker execution for images
Image Resizing
Variants
Configure Cloudflare Image Resizing: thumbnail (150px), card (400px),
detail (800px), zoom (1600px), og-image (1200x630).
WebP/AVIF auto-negotiation; 50-70%
size reduction
Responsive srcset
Add srcset to all product images with 150w, 400w, 800w, 1600w
variants. sizes attribute for responsive layout.
Browser downloads optimal size; saves
bandwidth on mobile
Lazy Loading
Add loading='lazy' decoding='async' to below-fold images. Set
width/height for CLS prevention.
Reduces initial page weight; prevents
layout shift
JSON-LD Product
Schema
Add to src/pages/products/[slug].astro: Product, Offer, BreadcrumbList
schema.
Google rich snippets with price,
availability, ratings
Sitemap Generation
Create src/lib/maintenance/sitemap.ts. Daily cron generates
sitemap.xml from D1. Upload to R2.
Search engine crawlability for all
product pages
Canonical URLs
Add link rel='canonical' to every page. Product pages always
canonicalize to /products/{slug}.
Prevents duplicate content;
consolidates page authority
Open Graph Tags
Add og:title, og:image, og:description to every product and category
page. og:image uses 400px variant.
WhatsApp/Facebook rich previews
(critical in Bangladesh)
robots.txt
Allow /products/*, /categories/*. Disallow /api/*, /staff/*. Reference
sitemap.xml.
Controls search engine crawl behavior
Core Web Vitals
Budgets
LCP under 2.5s, INP under 200ms, CLS under 0.1. Test in CI with
Lighthouse CI.
Prevents gradual performance
degradation
Bundle Size
Monitoring
Add Bundlewatch to CI. Threshold: under 50KB gzip per React island.
Max 5 islands per page.
Controls JavaScript payload on mobile

---

# Page 14

Zabir Boutiques Dev Prompt v7.0  |  Page 14
6. Observability Implementation
6.1 Logpush Configuration
// Cloudflare Dashboard > Logpush > Create Job
Destination: R2 bucket "zabir-logs"
Dataset: Workers (all fields)
Filter: Remove fields matching phone, address, payment_card patterns
Format: JSON
Frequency: Every 30 seconds
Retention: 90 days in R2 Standard, 1 year in R2 Infrequent Access
6.2 Workers Analytics Engine
File: src/lib/analytics.ts
export async function trackMetric(env: Env, event: {
name: string; // e.g. "orders_created"
doubles: Record<string, number>; // e.g. { revenue_paisa: 150000 }
indexes: string[]; // e.g. ["payment_method:cod", "channel:web"]
}): Promise<void> {
env.ANALYTICS?.writeDataPoint({
indexes: [event.name, ...event.indexes],
doubles: Object.values(event.doubles),
blobs: Object.keys(event.doubles),
});
}
Add to env.d.ts: ANALYTICS: AnalyticsEngineDataset
Add to wrangler.jsonc: analytics_engine_datasets: [{ binding: 'ANALYTICS' }]
6.3 Critical Metrics and Alerts
Metric
Alert Condition
Channel
orders_created
Drop > 50% from hourly baseline
Page immediately
revenue_paisa
Zero for 30 min during business hours
Page immediately
payment_webhook_failures
Failure rate > 5%
Page immediately
checkout_failures
Failure rate > 20% for 15 min
Notify within 15 min
stock_reservation_expiry
Expired count > 50 per cleanup run
Notify within 1 hour
d1_query_duration_ms
p99 > 2000ms for 10 min
Notify within 15 min
cache_hit_rate
Below 70% for product pages
Daily digest

---

# Page 15

Zabir Boutiques Dev Prompt v7.0  |  Page 15
7. Prioritized Implementation Sequence
Implementation is sequenced to minimize risk. Each phase builds on the previous one. No phase should begin until the
previous phase passes all acceptance criteria in staging.
Phase 1: Critical Fixes (Week 1-2)
1. Fix Astro output mode to 'hybrid'
2. Create VariantInventoryDO and integrate into reserveVariants()
3. Create IdempotencyDO and replace D1-based idempotency
4. Add Cloudflare Queues (payment-webhooks, order-emails)
5. Add payment reconciliation cron (15 min)
6. Reduce reservation TTL to 10 min, cleanup cron to 5 min
7. Add Turnstile to checkout and staff login
8. Enable WAF managed ruleset + custom rules
9. Add session idle timeout (30 min) and absolute timeout (8 hr)
Phase 2: Security and Observability (Week 3)
1. Configure Logpush to R2
2. Add Workers Analytics Engine for business metrics
3. Configure alerting for critical metrics
4. Add Zero Trust Access for staff routes
5. Replace CSP unsafe-inline with script hashing
6. Add KV session revocation blacklist
7. Add coupon brute-force rate limiting
Phase 3: Caching and Performance (Week 4)
1. Implement Cache API with SWR for product pages
2. Configure R2 custom domain for images
3. Set up Cloudflare Image Resizing with 5 variants
4. Add responsive srcset to all product images
5. Add Core Web Vitals budgets in CI
6. Add Bundlewatch for JavaScript bundle monitoring
Phase 4: SEO and Email (Week 5)
1. Add JSON-LD Product schema to product pages
2. Add canonical URLs, Open Graph tags, meta descriptions
3. Create sitemap generation cron
4. Create robots.txt

---

# Page 16

Zabir Boutiques Dev Prompt v7.0  |  Page 16
5. Integrate Resend for transactional emails
6. Add order confirmation, shipping, and delivery email templates
7. Add email_log table and tracking
Phase 5: Order Lifecycle and Returns (Week 6)
1. Create order state machine with all transitions
2. Add 'returned' and 'refunded' to order status enum
3. Create return request/approval/rejection endpoints
4. Add auto-restock on approved returns
5. Add refund flow for prepaid amounts via UddoktaPay
6. Create stock_adjustments audit table
7. Add inventory reconciliation cron (daily)
Phase 6: Search and AI (Week 7)
1. Create FTS5 virtual table for product search
2. Add search endpoint with autocomplete (KV-backed prefix index)
3. Add BudgetCounterDO for AI budget tracking
4. Add content moderation pipeline for AI-generated content
5. Configure Workers AI as primary, DeepSeek as fallback
Phase 7: Environment and CI/CD (Week 8)
1. Add staging and dev environment bindings to wrangler.jsonc
2. Set up Cloudflare Pages Git integration
3. Add preview deployments for feature branches
4. Create D1 migration runner with rollback support
5. Add environment-specific secrets rotation
6. Add disaster recovery procedures and documentation
7. Weekly backup verification on staging

---

# Page 17

Zabir Boutiques Dev Prompt v7.0  |  Page 17
8. Acceptance Criteria — Gate Check
The platform must pass ALL of the following criteria before production deployment. Each criterion maps to a specific
section of the Master Plan v7.0.
ID
Criterion
Test
Phase
G1
No overselling under
concurrency
Simulate 50 concurrent checkouts for the same variant with 10 units. Result:
exactly 10 orders succeed, 40 fail with OUT_OF_STOCK. Zero inventory drift.
Phase 1
G2
Payment never lost on
webhook failure
Simulate webhook failure. Verify payment-webhooks queue retries. Verify
reconciliation cron catches orphaned payments within 30 minutes.
Phase 1
G3
No duplicate orders from
retries
Submit same idempotency key 10 times concurrently. Result: exactly 1 order
created. All retries return cached response.
Phase 1
G4
Expired reservations cleaned
up
Create reservation with 10-min TTL. Verify cron releases stock within 15
minutes of expiry.
Phase 1
G5
Staff login blocks brute force
Attempt 10 rapid login failures. Verify rate limit triggers (429). Verify Turnstile
challenge on suspicious traffic.
Phase 2
G6
Audit log tamper-evident
Verify audit chain hash integrity. Attempt UPDATE on audit_log row. Verify
trigger blocks it.
Phase 2
G7
Cache hit rate above 70%
Load test product pages. Verify cache hit rate above 70% after warm-up.
Verify stale-while-revalidate returns fresh content within TTL.
Phase 3
G8
LCP under 2.5s on mobile
Run Lighthouse CI on product detail page with 3G throttling. Verify LCP under
2.5s, CLS under 0.1, INP under 200ms.
Phase 3
G9
Google rich snippets visible
Verify Product schema renders in Google Rich Results Test. Verify price,
availability, and image appear in preview.
Phase 4
G10
Order confirmation email
sent
Create order. Verify confirmation email received within 60 seconds. Verify
email contains correct order number and items.
Phase 4
G11
Return flow restocks
inventory
Approve a return for a delivered order. Verify variant stock incremented.
Verify refund triggered for prepaid amount.
Phase 5
G12
Search returns relevant
results
Search for 'saree'. Verify results include products with 'saree' in
name/description. Verify autocomplete works within 50ms.
Phase 6
G13
Staging mirrors production
Deploy to staging. Verify all bindings (D1, R2, KV, Queues, DOs) are isolated.
Verify sandbox UddoktaPay integration.
Phase 7
G14
Backup and restore works
Trigger backup cron. Verify D1 export in R2. Restore to staging. Verify all row
counts match.
Phase 7
Zabir Boutiques Pro Development Prompt v7.0 | June 2026