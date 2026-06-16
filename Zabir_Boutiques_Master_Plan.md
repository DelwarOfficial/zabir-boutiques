Zabir Boutiques
Master Plan
Production-Ready Technical & Business Architecture
SOURCE OF TRUTH
Cloudflare-native e-commerce platform for Bangladesh F-
commerce. Server-authoritative pricing, serialized inventory, multi-
layered security, and sub-second mobile performance.
June 2026
Z.ai


---

Zabir Boutiques Master Plan  |  Page 1
Table of Contents
5
1. Executive Summary
6
2. Technology Stack and Architecture
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 6
2.1 Framework Configuration
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 6
2.2 Cloudflare Service Matrix
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 7
2.3 Deployment Topology
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 7
2.4 Absolute Guardrails
9
3. Data Architecture
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 9
3.1 D1 Schema with Enforced Constraints
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 9
3.2 KV Usage Map
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 10
3.3 R2 Configuration
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 10
3.4 Durable Objects for Concurrency Control
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 11
3.5 Queues for Async Processing
12
4. UI/UX Design System and Accessibility
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 12
4.1 Design Token System
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 12
4.2 Tailwind CSS Configuration
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 12
4.3 Responsive Design Strategy
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 13
4.4 Accessibility (WCAG 2.1 AA Compliance)
14
5. Component Architecture
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 14
5.1 React Islands Strategy
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 14
5.2 Component Library Structure
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 15
5.3 State Management
16
6. Checkout and Payment Flow
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 16
6.1 Guest Checkout Flow
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 17
6.2 Payment Verification and Reconciliation
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 17
6.3 Stock Reservation Lifecycle
18
7. Order Lifecycle and Operations
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 18
7.1 Order State Machine


---

Zabir Boutiques Master Plan  |  Page 2
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 18
7.2 Return and Refund Flow
19
8. Staff Workflows and RBAC
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 19
8.1 Role-Based Access Control
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 19
8.2 In-Store Order Creation
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 19
8.3 Staff-Assisted Phone/Messenger Orders
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 19
8.4 Shipping Label Generation
21
9. Security Architecture
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 21
9.1 Authentication and Session Management
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 21
9.2 WAF and Rate Limiting
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 21
9.3 Turnstile Bot Protection
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 21
9.4 Zero Trust Access
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 22
9.5 Content Security Policy
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 22
9.6 Secrets Management
23
10. Caching and CDN Strategy
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 23
10.1 Cache API Implementation Pattern
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 23
10.2 Cache Purging Rules
24
11. SEO Architecture
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 24
11.1 Structured Data (JSON-LD)
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 24
11.2 URL Structure
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 24
11.3 Meta Tags and Open Graph
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 24
11.4 Sitemap and Robots
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 24
11.5 Mobile-First Optimization
26
12. Performance Budgets
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 26
12.1 Mobile-Specific Optimization
27
13. Search Architecture
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 27
13.1 Phase 1: D1 Full-Text Search (Launch)
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 27
13.2 Phase 2: Workers AI Semantic Search (Post-Launch)
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 27
13.3 Phase 3: Managed Search Service (Scale)
28
14. Image Pipeline


---

Zabir Boutiques Master Plan  |  Page 3
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 28
14.1 Upload Flow
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 28
14.2 Image Resizing Variants
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 28
14.3 Responsive Image Delivery
29
15. Email and Notification System
30
16. Inventory Management
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 30
16.1 Inventory Model
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 30
16.2 Inventory Reconciliation
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 30
16.3 Flash Sale Strategy
31
17. Observability and Monitoring
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 31
17.1 Logging Architecture
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 31
17.2 Metrics (Workers Analytics Engine)
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 31
17.3 Alerting Rules
33
18. Environment Separation and CI/CD
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 33
18.1 Environment Architecture
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 33
18.2 CI/CD Pipeline
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 33
18.3 Database Migrations
34
19. Disaster Recovery
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 34
19.1 Recovery Objectives
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 34
19.2 Backup Strategy
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 34
19.3 Restoration Procedure
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 34
19.4 Incident Response
36
20. Compliance and Privacy
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 36
20.1 Data Protection Framework
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 36
20.2 PCI Considerations
37
21. AI Integration
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 37
21.1 Service Architecture
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 37
21.2 Budget Enforcement
38
22. Implementation Phases and Milestones
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 38
22.1 Phase 1: Core Commerce (Weeks 1-6)


---

Zabir Boutiques Master Plan  |  Page 4
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 38
22.2 Phase 2: Operational Excellence (Weeks 7-12)
 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 39
22.3 Phase 3: Growth and Optimization (Weeks 13-18)
40
23. Absolute Guardrails and Handoff


---

Zabir Boutiques Master Plan  |  Page 5
1. Executive Summary
Zabir Boutiques is a Cloudflare-native e-commerce platform built for the Bangladesh F-commerce market. The
platform operates on a COD-first model with server-authoritative pricing, serialized inventory control, and
multi-layered security. Every architectural decision prioritizes zero overselling, payment integrity, and sub-second
page loads on mobile devices over 3G connections, which represent the dominant access pattern in the target
market. This document is the single source of truth for all implementation decisions. Every requirement is
actionable, every constraint is enforceable, and every design choice is justified by a specific operational risk it
mitigates.
The platform uses Astro 6 with hybrid output mode, deploying to Cloudflare Pages with Workers for server-side
execution. Static routes (product pages, category listings, marketing pages) are pre-rendered at build time for
maximum edge cache efficiency. Dynamic routes (checkout, staff dashboard, API endpoints) execute in
Cloudflare Workers with bindings to D1 (relational data), R2 (object storage), KV (session and feature flags),
Durable Objects (concurrency gates), and Queues (async processing). React 19 Islands provide selective hydration
for interactive components, with a strict budget of five islands per public page. Tailwind CSS handles all styling
through a centralized design token system, ensuring visual consistency across every component and page.
Property
Specification
Platform
Cloudflare Pages + Workers (edge compute, global CDN)
Framework
Astro 6 (output: hybrid) + @astrojs/cloudflare adapter
UI Layer
React 19 Islands (client:idle / client:visible) + Tailwind CSS
Database
Cloudflare D1 (SQLite-compatible, edge-deployed)
Storage
Cloudflare R2 (S3-compatible object storage, zero egress)
Concurrency
Durable Objects (VariantInventoryDO, CartDO, BudgetCounterDO, IdempotencyDO)
Async Processing
Cloudflare Queues (payment-webhooks, order-emails, image-processing, fraud-scoring,
d1-backup)
Payments
UddoktaPay (primary), SSLCommerz (fallback)
Fraud Detection
FraudBD (async, 3s timeout, allow-with-review fallback)
Security
WAF + Turnstile + Rate Limiting + Zero Trust Access + CSP + CSRF HMAC
Observability
Logpush + Workers Analytics Engine + 9 custom metrics + 4-tier alerting
Region
Bangladesh (COD-first, +880 phone normalization, 95%+ mobile traffic)


---

Zabir Boutiques Master Plan  |  Page 6
2. Technology Stack and Architecture
2.1 Framework Configuration
The platform uses Astro 6 with output mode set to 'hybrid'. This is a critical configuration choice: hybrid mode
enables per-route control over server rendering. Routes default to pre-rendered static HTML unless explicitly
marked with 'export const prerender = false'. This ensures maximum CDN cache efficiency for content pages
while enabling full server-side execution for checkout, payment verification, staff workflows, and API endpoints.
Using 'static' output mode would break all server routes and is strictly forbidden.
astro.config.mjs:
output: 'hybrid'
adapter: cloudflare({ runtime: { mode: 'advanced' } })
// Static routes: prerender = true (default)
// Server routes: export const prerender = false
2.2 Cloudflare Service Matrix
Every architectural concern maps to a specific Cloudflare service. This matrix prevents ad-hoc decisions during
implementation and defines the complete platform footprint.
Concern
Cloudflare Service
Configuration
Compute
Pages + Functions
Astro hybrid output; Functions for server routes
Relational Data
D1
Primary DB for orders, products, users, inventory
Object Storage
R2
Product images; public bucket with custom domain
cdn.zabirboutiques.com
Key-Value
Cache
KV
Session tokens (TTL 8h), feature flags, URL redirects
Concurrency
Control
Durable Objects
Stock serialization per variant; cart per session; budget counters
Async
Processing
Queues
Payment webhooks, order emails, image processing, fraud scoring
Image
Optimization
Image Resizing
WebP/AVIF on-the-fly; 5 variants (150px to 1600px)
Bot Protection
Turnstile
Invisible on checkout; managed on staff login
WAF / Security
WAF + Rate Limiting
OWASP Core + custom rules for staff/payment routes
Staff Access
Zero Trust Access
Email-based identity for /api/staff/* routes
Observability
Logpush + Analytics
Engine
Logs to R2; 9 custom business metrics
Email
Email Routing + Workers
Transactional via Resend; inbound via Email Workers


---

Zabir Boutiques Master Plan  |  Page 7
Concern
Cloudflare Service
Configuration
CI/CD
Pages Git Integration
Auto-deploy main; preview deploys from branches
DNS / CDN
CDN + Cache API
Edge caching with stale-while-revalidate; cache-tag purging
Cron Jobs
Cron Triggers
Stock cleanup 5min, backup 6h, reconciliation 15min, sitemap daily
AI
Workers AI + DeepSeek
Product descriptions, recommendations; DeepSeek for complex tasks
2.3 Deployment Topology
The application deploys to Cloudflare Pages via GitHub integration. The main branch deploys to production; all
other branches create preview deployments with isolated bindings. Static assets serve directly from the CDN edge.
Server routes execute in Cloudflare Functions with bindings to D1, R2, KV, Durable Objects, and Queues. R2
product images are served via cdn.zabirboutiques.com with Cloudflare CDN caching and Image Resizing for
automatic format negotiation and responsive variants.
1. Developer pushes to GitHub branch
2. Cloudflare Pages triggers build via Git integration
3. Astro build generates static HTML + Functions bundle
4. Build-time product snapshots fetched from D1 (escape hatch: build:skip-snapshots for CI without DB
access)
5. Preview deployment created for non-main branches; production deployment on main merge
6. Rollback available via Pages dashboard (one-click revert to any previous deployment)
7. Cache purge triggered via API after product catalog updates
2.4 Absolute Guardrails
These guardrails are non-negotiable constraints enforced at the infrastructure level. Violations must fail builds,
reject requests, or trigger alerts.
ID
Guardrail
Enforcement
Owner
G1
Only SQLite-compatible syntax (D1). No
PostgreSQL-only features.
Build-time SQL linter in CI
Backend Lead
G2
All writes through Pages Function routes.
Frontend never writes directly.
Route-level middleware rejects writes on
public routes
Backend Lead
G3
All money values use INTEGER paisa. No
floating-point money fields.
D1 CHECK constraints + app-layer
validation
Backend Lead
G4
Checkout ignores browser-supplied prices.
Server-authoritative only.
Checkout API parses only variant_id +
quantity from client
Checkout Lead
G5
All D1 CHECK constraints enforced at the
database level.
Schema migration CI test with invalid
inserts
DBA


---

Zabir Boutiques Master Plan  |  Page 8
ID
Guardrail
Enforcement
Owner
G6
UddoktaPay payments verified server-to-server
with HMAC signature.
Webhook handler validates HMAC
before processing
Payments Lead
G7
Stock reservations serialized through Durable
Objects.
DO gateway middleware on
reserveVariants()
Inventory Lead
G8
All API keys in Cloudflare Secrets. Rotate
quarterly.
Secrets audit cron + quarterly rotation
calendar
DevOps
G9
No PII in logs. Structured logging only.
Logpush filter strips PII before
persistence
Security Lead
G1
0
All staff routes behind Zero Trust Access +
RBAC.
Zero Trust policy + middleware RBAC
check
Security Lead
G1
1
Build fails if snapshot generation fails (escape
hatch: build:skip-snapshots).
CI pipeline exit code check
DevOps
G1
2
D1 snapshot files excluded from Git.
.gitignore enforcement + pre-commit
hook
DevOps


---

Zabir Boutiques Master Plan  |  Page 9
3. Data Architecture
3.1 D1 Schema with Enforced Constraints
All CHECK constraints are enforced at the D1 schema level. Application-layer validation provides user-friendly
error messages, but the database is the final authority on data integrity. CI tests verify every constraint by
attempting invalid inserts and asserting rejection. Money values are stored as INTEGER paisa (1 BDT = 100
paisa) to eliminate floating-point arithmetic errors. The available quantity for each variant is a computed column,
ensuring it is always consistent: available = stock - reserved - sold.
-- Core tables with enforced constraints
CREATE TABLE variants (
id TEXT PRIMARY KEY,
product_id TEXT NOT NULL REFERENCES products(id),
sku TEXT NOT NULL UNIQUE,
price_paisa INTEGER NOT NULL CHECK(price_paisa >= 0),
stock INTEGER NOT NULL CHECK(stock >= 0),
reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0),
sold INTEGER NOT NULL DEFAULT 0 CHECK(sold >= 0),
available INTEGER GENERATED ALWAYS AS (stock - reserved - sold) STORED
);
CREATE TABLE orders (
id TEXT PRIMARY KEY,
subtotal_paisa INTEGER NOT NULL CHECK(subtotal_paisa >= 0),
delivery_paisa INTEGER NOT NULL CHECK(delivery_paisa >= 0),
discount_paisa INTEGER NOT NULL DEFAULT 0 CHECK(discount_paisa >= 0),
total_paisa INTEGER NOT NULL CHECK(total_paisa >= 0),
advance_paisa INTEGER NOT NULL DEFAULT 0 CHECK(advance_paisa >= 0),
balance_paisa INTEGER NOT NULL DEFAULT 0 CHECK(balance_paisa >= 0),
payment_method TEXT NOT NULL CHECK(payment_method IN
('cod','uddoktapay','partial_prepay','in_store')),
payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN
('pending','partially_paid','paid','refunded','partially_refunded')),
order_status TEXT NOT NULL DEFAULT 'created' CHECK(order_status IN ('created','confirmed
','processing','shipped','delivered','cancelled','returned','refunded'))
);
CREATE TABLE coupons (
code TEXT PRIMARY KEY,
type TEXT NOT NULL CHECK(type IN ('fixed','percent')),
value_paisa INTEGER NOT NULL CHECK(value_paisa > 0),
used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count >= 0),
is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1))
);
CREATE TABLE idempotency_keys (
key TEXT PRIMARY KEY,
order_id TEXT REFERENCES orders(id),
response_body TEXT,
expires_at INTEGER NOT NULL -- TTL 24 hours
);
3.2 KV Usage Map


---

Zabir Boutiques Master Plan  |  Page 10
KV is eventually consistent and must only be used for data that tolerates stale reads. All KV namespaces are
separated per environment (dev/staging/prod). Session data uses KV with a TTL of 8 hours, providing automatic
cleanup of expired sessions without requiring a background sweep. Feature flags are stored without TTL and
propagate within approximately 60 seconds of update, which is acceptable for operational toggles.
Namespace
Key Pattern
Value
TTL
Consistency
SESSION
session:{token_has
h}
Staff session JSON
8 hours
Stale reads acceptable
FEATURE_
FLAGS
flag:{name}
boolean / JSON
config
None (manual)
Propagates in ~60s
REDIRECTS
redirect:{old_path}
target URL
None (manual)
Bulk upload via API
RATE_LIMI
T
rl:{ip}:{endpoint}
Request count
1 minute
window
Approximate; DO for strict
CART_SESS
ION
cart:{session_id}
Cart JSON
30 days
Stale acceptable; D1 is source of
truth
3.3 R2 Configuration
•
Buckets: zabir-product-images (prod), zabir-product-images-staging, zabir-product-images-dev
•
Custom Domain: cdn.zabirboutiques.com (mapped to R2 public bucket)
•
CORS: Enabled for zabirboutiques.com and staging.zabirboutiques.com for direct browser uploads
•
Lifecycle: Image versions retained 90 days; expired versions auto-deleted
•
Image Resizing: 5 variants: thumbnail (150px), card (400px), detail (800px), zoom (1600px), og-image
(1200x630)
•
Format Negotiation: Auto WebP/AVIF based on Accept header; fallback to JPEG
3.4 Durable Objects for Concurrency Control
Durable Objects provide single-threaded, strongly consistent execution for operations that cannot tolerate race
conditions. Each DO class handles a specific concurrency concern, and all DOs are namespace-separated per
environment.
DO Class
Object ID
Responsibility
Storage
VariantInventoryD
O
variant:{variant
_id}
Serializes stock reservations; prevents overselling
current_stock,
reserved_count,
reservation_queue
CartDO
cart:{session_id}
Manages cart state per session; prevents cart
corruption
items[], last_updated
BudgetCounterDO
budget:{service}
:{period}
Consistent budget counters for AI API calls
daily_used, monthly_used,
limits


---

Zabir Boutiques Master Plan  |  Page 11
DO Class
Object ID
Responsibility
Storage
IdempotencyDO
idem:{key}
Atomic idempotency key claiming
claimed, order_id,
response, expires_at
The VariantInventoryDO is the most critical component. Every checkout request for a variant passes through its
DO, which processes reservations sequentially. If available stock is insufficient, the DO immediately rejects the
reservation without touching D1. Only after the DO confirms a reservation does the checkout flow write to D1.
This guarantees zero overselling even under extreme concurrency (flash sales, promotional drops with hundreds of
simultaneous checkout attempts).
3.5 Queues for Async Processing
Queue
Producer
Consumer
Retry
DLQ Action
payment-web
hooks
UddoktaPay
callback
Verify HMAC, update order
status
5x exponential (1s-60s)
Alert + manual
reconciliation
order-emails
Order creation
flow
Send email via Resend API
3x backoff (5s-30s)
Alert + staff
notification
image-proces
sing
Staff product
upload
Compress (Tinify) + R2 upload
3x backoff (10s-60s)
Alert + fallback to
original
fraud-scoring
Checkout flow
(async)
FraudBD API call + risk update
2x (skip if FraudBD
down)
Auto-approve with
review flag
d1-backup
Cron Trigger
(6h)
D1 export to R2 backup bucket
2x backoff (30s)
Alert on backup
failure


---

Zabir Boutiques Master Plan  |  Page 12
4. UI/UX Design System and Accessibility
4.1 Design Token System
All visual properties are centralized into a design token system managed through Tailwind CSS configuration and
CSS custom properties. This ensures that every component across the platform uses the same colors, spacing,
typography, and border radii. Tokens are organized into three tiers: global (brand colors, font families), alias
(semantic mappings like surface-primary, text-muted), and component (specific button padding, input borders).
Modifying a global token propagates consistently across the entire application without manual updates to
individual components.
Token Category
Examples
Usage
Colors
--color-primary, --color-accent, --color-surface
Brand identity, UI elements, backgrounds
Typography
--font-heading, --font-body, --font-mono
Headings use Inter, body uses system stack,
code uses JetBrains Mono
Spacing
--space-xs (4px) through --space-3xl (48px)
Consistent padding, margins, gaps using 4px
base unit
Borders
--radius-sm (4px), --radius-md (8px), --radius-lg
(16px)
Card corners, button borders, input fields
Shadows
--shadow-sm, --shadow-md, --shadow-lg
Elevation hierarchy for cards, modals,
dropdowns
Breakpoints
sm:640px, md:768px, lg:1024px, xl:1280px
Responsive layout thresholds
4.2 Tailwind CSS Configuration
Tailwind CSS is the sole styling framework. All styles use utility classes or component abstractions defined in the
Tailwind config. Custom CSS is forbidden except for CSS custom property declarations and Astro-scoped
component styles that cannot be expressed via Tailwind utilities. The tailwind.config.ts file extends the default
theme with the project's design tokens, ensuring that every utility class respects the design system.
// tailwind.config.ts (key extensions)
theme: {
extend: {
colors: { primary: 'var(--color-primary)', accent: 'var(--color-accent)' },
fontFamily: { heading: ['Inter', 'sans-serif'], body: ['system-ui', 'sans-serif'] },
borderRadius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)' }
}
}
4.3 Responsive Design Strategy
Bangladesh mobile traffic exceeds 95% of total visits. The platform is designed mobile-first with progressive
enhancement for larger screens. All layouts are built for 360px width as the baseline, then enhanced at md (768px)
and lg (1024px) breakpoints. Touch targets are minimum 44x44px. Product images use responsive srcset with


---

Zabir Boutiques Master Plan  |  Page 13
WebP/AVIF format negotiation. The checkout flow is a single-column layout on mobile with sticky order
summary, transitioning to a two-column layout on desktop. All interactive elements are designed for thumb-zone
accessibility on mobile devices.
4.4 Accessibility (WCAG 2.1 AA Compliance)
The platform must meet WCAG 2.1 Level AA compliance. This is not optional and applies to all user-facing
pages including the staff dashboard. Accessibility testing is integrated into CI using axe-core automated checks
and manual keyboard navigation audits on every PR that modifies UI components.
Requirement
Implementation
Testing
Color Contrast
Minimum 4.5:1 for text, 3:1 for large text and UI
components
Automated axe-core scan in CI
Keyboard
Navigation
All interactive elements reachable via Tab; focus
indicators visible
Manual audit per component PR
Screen Reader
Support
ARIA labels on all interactive elements; landmark regions
on every page
NVDA/VoiceOver manual testing
Image Alt Text
All product images require alt text before save;
AI-generated suggestions
Schema validation on product create
Form Labels
Every input has visible label and programmatic
association (for/id)
axe-core + manual review
Focus
Management
Modal traps focus; route changes announce to screen
readers; skip links
Keyboard navigation audit
Motion Sensitivity
Respect prefers-reduced-motion; no auto-playing
animations
CSS media query + JS check
Error
Identification
Form errors associated with fields via aria-describedby;
error summary
axe-core form validation check


---

Zabir Boutiques Master Plan  |  Page 14
5. Component Architecture
5.1 React Islands Strategy
Astro Islands enable selective hydration of interactive components while keeping the rest of the page as static
HTML. Every hydrated island adds JavaScript to the page, so the strategy minimizes islands and uses the lightest
hydration directive for each. The maximum number of islands per public page is five. The staff dashboard is
exempt from this limit as it is a full SPA, but it is code-split per route with lazy loading.
Component
Hydratio
n
Rationale
Bundle Target
Add to Cart Button
client:idle
Above-fold, interactive after page loads
Under 5KB gzip
Cart Drawer
client:idle
Opens on cart interaction; not needed on initial paint
Under 10KB gzip
Product Image
Gallery
client:idle
Thumbnail switching and zoom; deferred interaction
Under 8KB gzip
Checkout Form
client:load
Critical interactive element on checkout page only
Under 15KB gzip
Search Bar
(autocomplete)
client:idle
Interactive search with 300ms debounce
Under 8KB gzip
Product
Recommendations
client:visib
le
Below-fold; hydrate when scrolled into view
Under 6KB gzip
Staff Dashboard
client:load
Entirely interactive application, code-split per route
Under 50KB gzip per
route
5.2 Component Library Structure
All components are organized in a flat structure under src/components/ with clear naming conventions. Each
component is self-contained with its own TypeScript types, and uses Tailwind utility classes exclusively.
Components are categorized into primitives (Button, Input, Badge), composites (ProductCard, CartItem,
OrderRow), and layouts (ProductGrid, CheckoutFlow, StaffDashboard). Shared hooks for data fetching, cart
operations, and form validation are in src/hooks/.
Category
Components
Shared Logic
Primitives
Button, Input, Select, Badge, Modal, Spinner, Toast
useFocusTrap, useClickOutside,
useKeyboard
Product
ProductCard, ProductGallery, VariantSelector,
PriceDisplay
useCartActions, useProductData
Cart
CartItem, CartDrawer, CartSummary, CouponInput
useCart, useCouponValidation
Checkout
CheckoutForm, DeliveryAddress, PaymentSelector,
OrderSummary
useCheckout, usePhoneValidation


---

Zabir Boutiques Master Plan  |  Page 15
Category
Components
Shared Logic
Staff
OrderTable, OrderDetail, ProductEditor,
CouponManager, ReturnHandler
useStaffAuth, useRBAC, useAuditLog
Layout
Header, Footer, Navigation, MobileMenu, Breadcrumb
useNavigation, useBreakpoint
5.3 State Management
Global state is minimized. Cart state uses CartDO on the server with a local React context for optimistic UI
updates. Staff session state is managed via HttpOnly cookies and a React context that fetches session data on
mount. No Redux, Zustand, or other global state libraries are used. Component-level state uses React's built-in
useState and useReducer. Server state (product data, order data) is fetched via Astro's server-side rendering and
passed as props, not stored in client-side state.


---

Zabir Boutiques Master Plan  |  Page 16
6. Checkout and Payment Flow
The checkout flow is the highest-risk path in the platform. Every step is designed to be server-authoritative,
idempotent, and race-condition-free. The flow incorporates Durable Objects for stock serialization and
Cloudflare Queues for async processing. Client-supplied prices are completely ignored; the server is the sole
authority for all monetary calculations.
6.1 Guest Checkout Flow
1. Validate idempotency key (header Idempotency-Key or body idempotency_key). Query IdempotencyDO:
if claimed with existing order, return cached response (replay protection); if claimed and processing, return
202 Accepted with retry-after header.
2. Normalize phone to E.164 (+880) using libphonenumber-js. Accepted formats: 01XXXXXXXXX,
+8801XXXXXXXXX, 8801XXXXXXXXX. Reject invalid formats with specific error messages.
3. Parse cart: extract variant_id + quantity only. Client-supplied prices, subtotals, and totals are completely
ignored.
4. Load authoritative variant snapshots from D1: price_paisa, stock, product details. Verify all variants exist
and are active.
5. Compute subtotal + delivery fee server-side from D1 price_paisa. Delivery fee by zone (inside/outside
Dhaka).
6. Claim idempotency key atomically via IdempotencyDO. Prevents duplicate concurrent processing across
Worker isolates.
7. Apply coupon atomically (if provided). Validate: active, date range, usage limits, min order. D1 UPDATE
with WHERE used_count less than usage_limit_total for atomic claim. Enforce max_discount_paisa cap.
8. Compute total = subtotal + delivery_paisa - discount_paisa. Enforce minimum total of 0.
9. Evaluate prepayment rule: 2 or fewer items + COD requires no prepayment. More than 2 items + COD
rejects with 402 PREPAYMENT_REQUIRED. Client retries with payment_method: 'partial_prepay' (50%
advance via UddoktaPay, 50% COD). Full uddoktapay payment has no split. In-store orders are exempt.
10. Check FraudBD risk score (skip for in-store). Async via fraud-scoring Queue. Timeout: 3 seconds. If
FraudBD unavailable, allow with order_status: 'pending_review'. Thresholds: low (0-40) auto-approve,
medium (41-70) manual review, high (71-100) auto-reject.
11. Reserve stock via VariantInventoryDO for each variant. DO processes sequentially per variant. If any
variant has insufficient stock, entire reservation rolls back and checkout fails with 409 CONFLICT.
12. Create order with D1 atomic batch: order record + order_items + stock_reservations (expires_at = now
+ 10 min). Update variant reserved count.
13. Store advance_paisa and balance_paisa. For partial_prepay: advance = total/2, balance = remainder. For
COD: advance = 0, balance = total. For uddoktapay: advance = total, balance = 0.
14. Complete idempotency: store order_id and serialized response in IdempotencyDO with 24-hour TTL for
replay on retry.


---

Zabir Boutiques Master Plan  |  Page 17
15. Enqueue order-confirmation email via order-emails Queue.
16. If payment required (uddoktapay or partial_prepay), initiate UddoktaPay payment with idempotency
key. Store transaction ID in order metadata.
6.2 Payment Verification and Reconciliation
Webhook Processing
•
Endpoint: POST /api/payments/webhook (UddoktaPay callback URL)
•
Signature Verification: HMAC-SHA256 of payload using webhook secret from Cloudflare Secrets
•
Idempotency: Event ID stored in D1 payment_events table. Duplicate events return 200 OK without
processing
•
Processing: Enqueue to payment-webhooks Queue for async processing. Immediate 200 OK to UddoktaPay
•
Order Update: On successful payment, update order payment_status and order_status. For partial_prepay,
set payment_status to 'partially_paid'
Payment Reconciliation Cron (every 15 minutes)
•
Query D1 for orders with payment_status = 'pending' older than 30 minutes
•
Call UddoktaPay status check API for each order
•
Update D1 order status based on UddoktaPay authoritative state
•
If UddoktaPay confirms payment but order was not updated, fix inconsistency and alert
•
If UddoktaPay shows no payment after 2 hours, auto-cancel order and release stock
6.3 Stock Reservation Lifecycle
•
Reservation TTL: 10 minutes from creation
•
Cleanup Cron: Every 5 minutes (runs reserveExpirationCheck)
•
Process: Cron queries D1 for expired reservations. For each: release reserved quantity, delete record, log
event
•
Idempotency: Cleanup is idempotent; re-processing an already-released reservation is a no-op
•
Monitoring: Alert if expired reservation count exceeds 50 in a single run


---

Zabir Boutiques Master Plan  |  Page 18
7. Order Lifecycle and Operations
7.1 Order State Machine
The complete order state machine defines all valid states, allowed transitions, triggers, and side effects. Invalid
state transitions are rejected at the API level and logged as potential bugs or security events. The state machine is
implemented as a validation function that is called before every order update.
State
Allowed
Transitions
Trigger
Side Effects
created
confirmed,
cancelled
Staff confirms or auto-confirm (paid
orders)
Deduct stock from reserved to sold
confirmed
processing,
cancelled
Staff begins fulfillment
Send shipping notification email
processing
shipped, cancelled
Staff hands off to courier
Generate tracking number
shipped
delivered, returned
Courier delivery confirmation
COD balance collection for partial_prepay
delivered
returned
Customer return request within
return window
N/A (final state for non-returns)
cancelled
(terminal)
Staff or customer cancellation
Release reserved stock; refund if prepaid
returned
refunded
Staff approves return
Restock items; initiate refund for prepaid
refunded
(terminal)
Refund processed via UddoktaPay
Update financial records; restock complete
7.2 Return and Refund Flow
Return rates for COD orders in Bangladesh F-commerce can exceed 20-30%. A complete return flow is essential
for operational sustainability and financial accuracy.
•
Return Request: Customer contacts support (phone/Messenger/WhatsApp). Staff creates return via POST
/api/staff/returns with order_id, items, reason
•
Return Approval: Owner or manager reviews and approves/rejects via POST /api/staff/returns/{id}/approve
or /reject
•
Stock Restock: On approval, variant stock incremented and reserved count decremented. Logged in
stock_adjustments audit table
•
Refund Processing: For prepaid amounts, initiate refund via UddoktaPay API. For partial_prepay, refund
advance_paisa. For COD-only, no refund needed
•
Return Window: 7 days from delivery. Configurable via feature flag in KV


---

Zabir Boutiques Master Plan  |  Page 19
8. Staff Workflows and RBAC
8.1 Role-Based Access Control
The RBAC model defines four staff roles with explicit permissions. Every API route enforces RBAC via
middleware. Permission changes are logged in the audit system. The Owner role has irrevocable access to all
operations; other roles can be modified by the Owner at any time.
Permission
Owner
Manager
Staff
Viewer
orders.view
Yes
Yes
Yes
Yes
orders.create (in_store/phone)
Yes
Yes
Yes
No
orders.confirm
Yes
Yes
Yes
No
orders.cancel
Yes
Yes
Own orders
No
orders.refund
Yes
Yes
No
No
coupons.create
Yes
No
No
No
coupons.deactivate
Yes
No
No
No
products.create
Yes
Yes
Yes
No
products.update
Yes
Yes
Yes
No
products.delete
Yes
No
No
No
staff.manage
Yes
No
No
No
reports.view
Yes
Yes
No
Yes
returns.approve
Yes
Yes
No
No
8.2 In-Store Order Creation
•
API: POST /api/staff/orders/create with channel: 'in_store'
•
RBAC: orders.create permission required
•
Flow: Server-authoritative pricing. Auto-confirmed (order_status: 'confirmed'). Stock deducted immediately.
No COD/UddoktaPay initiation. No fraud check. Orders with more than 2 items auto-upgrade from COD to
partial_prepay
8.3 Staff-Assisted Phone/Messenger Orders
•
API: POST /api/staff/orders/create with channel: 'phone' | 'messenger' | 'whatsapp'
•
Flow: Same checkout pipeline as guest. Includes idempotency, fraud scoring, and prepayment rules. Staff
enters customer details on their behalf.
8.4 Shipping Label Generation


---

Zabir Boutiques Master Plan  |  Page 20
•
API: GET /api/staff/orders/{id}/label (RBAC: orders.view)
•
Format: Self-contained HTML+SVG with auto-print dialog. Includes QR code (base64 SVG) containing
order ID and tracking URL
•
Layout: 210mm x 99mm per label. Thermal printer format (4x6 inch) via ?format=thermal
•
Courier Templates: Configurable templates per courier partner (Pathao, Steadfast, Redx)


---

Zabir Boutiques Master Plan  |  Page 21
9. Security Architecture
Security is implemented in depth with multiple layers: network-level (Cloudflare), application-level (middleware),
and data-level (D1 constraints). No single layer is sufficient on its own; the combination provides defense in
depth.
9.1 Authentication and Session Management
Property
Specification
Session Storage
HttpOnly, Secure, SameSite=Strict cookies. Only HMAC-SHA256 hash stored
server-side
Session Idle Timeout
30 minutes of inactivity
Session Absolute Timeout
8 hours from creation
Session Revocation
KV-backed blacklist. On logout/compromise, add session hash with TTL
Concurrent Sessions
Maximum 2 active sessions per staff account
Login Rate Limiting
5 attempts/minute per IP; 10/minute per email; 15-min lockout after 5 failures
Password Requirements
Minimum 10 characters; 1 uppercase, 1 number, 1 special character
Multi-Factor Auth
TOTP-based 2FA optional (enforced for Owner). Web Crypto API for secret
generation
CSRF Protection
Double-submit cookie with HMAC: nonce cookie (SameSite=Strict, HttpOnly,
Secure) + nonce in request header. Key rotated monthly
9.2 WAF and Rate Limiting
•
Staff Routes: Block non-BD IPs on /api/staff/* (override via Zero Trust). Challenge suspicious user agents
•
Checkout: Rate limit 20 requests/minute per IP on POST /api/checkout
•
Login: Rate limit 5 requests/minute per IP on POST /api/staff/login. Block after 5 failures for 15 minutes
•
Coupon Application: Rate limit 5 attempts/minute per session. Lock for 30 minutes after 5 failed attempts
•
Product Pages: Rate limit 100 requests/minute per IP. Challenge likely-bot traffic
•
API General: Rate limit 60 requests/minute per IP on all /api/* routes
9.3 Turnstile Bot Protection
•
Guest Checkout: Invisible mode. Server-side token verification before processing
•
Staff Login: Managed mode (interactive challenge only when bot score uncertain)
•
Coupon Application: Invisible mode
•
Contact Forms: Managed mode
9.4 Zero Trust Access


---

Zabir Boutiques Master Plan  |  Page 22
All /api/staff/* routes are protected by Cloudflare Zero Trust Access in addition to cookie-based authentication.
Zero Trust requires email-based identity verification (one-time PIN sent to staff email). Device posture checks
verify security requirements (OS version, disk encryption). This eliminates the need for VPN on staff networks.
9.5 Content Security Policy
Content-Security-Policy:
default-src 'self';
script-src 'self' https://challenges.cloudflare.com/turnstile/;
style-src 'self' 'unsafe-inline';
img-src 'self' https://cdn.zabirboutiques.com data:;
connect-src 'self' https://api.uddoktapay.com https://api.fraudbd.com;
frame-src https://challenges.cloudflare.com/turnstile/;
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
9.6 Secrets Management
•
Storage: All API keys in Cloudflare Workers Secrets (encrypted at rest)
•
Rotation: Quarterly schedule via Wrangler CLI with zero-downtime deployment
•
Environment Separation: Separate secrets per environment. Never share across environments
•
Audit: Log all secret read access via Analytics Engine. Alert on unexpected patterns
•
Emergency Revocation: Single-command revocation via Wrangler. Auto-trigger alert


---

Zabir Boutiques Master Plan  |  Page 23
10. Caching and CDN Strategy
Caching is the single most impactful performance optimization on Cloudflare. Without it, every request executes
a Worker and queries D1, burning CPU time and adding latency. The caching strategy uses Cloudflare Cache API
with stale-while-revalidate for frequently accessed content, and cache-tag-based purging for targeted invalidation.
Content Type
Cache Strategy
TTL
Purge Trigger
Product Detail
Pages
Cache API +
stale-while-revalidate
1 hour (stale: 1 day)
Product update, price/stock change
Category Listings
Cache API + SWR
30 min (stale: 2 hours)
Product added/removed from category
Static Assets
(JS/CSS)
Forever (immutable)
1 year
New deployment (content-hash filenames)
R2 Product
Images
CDN edge cache
7 days
Image update (R2 object overwrite)
API: Product
Listing
Cache API
5 minutes
Catalog change
API:
Checkout/Orders
Never cache
N/A
N/A
Homepage
Cache API + SWR
10 min (stale: 1 hour)
Product/featured item change
Sitemap.xml
Static file on R2
24 hours
Daily cron regeneration
10.1 Cache API Implementation Pattern
const cache = caches.default;
const cacheKey = new Request(url, { method: 'GET' });
const cached = await cache.match(cacheKey);
if (cached) return cached; // Cache hit
// Cache miss: fetch from D1, build response
const response = new Response(html, {
headers: {
'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
'Cache-Tag': `product-${productId},category-${categoryId}`,
'Content-Type': 'text/html;charset=utf-8'
}
});
await cache.put(cacheKey, response.clone());
return response;
10.2 Cache Purging Rules
•
Product Update: Purge cache tag product-{id} + category-{categoryId}
•
New Product: Purge cache tag category-{categoryId} + 'homepage'
•
Stock Change: Only if stock reaches zero (affects availability). Purge product-{id}
•
Full Purge: Available via admin dashboard as emergency option. Use sparingly


---

Zabir Boutiques Master Plan  |  Page 24
11. SEO Architecture
Organic search is typically the highest-ROI acquisition channel for e-commerce. The SEO architecture ensures
every page is crawlable, indexable, and optimized for rich results. Given that Bangladesh mobile traffic exceeds
95%, mobile-first indexing compliance is mandatory.
11.1 Structured Data (JSON-LD)
Page Type
Schema
Required Properties
Product Detail
Product
name, image, description, sku, offers (price, priceCurrency, availability, url), brand
Category
Listing
ItemList
numberOfItems, itemListElement (Product references)
Homepage
Organization
name, url, logo, contactPoint, sameAs
All Pages
BreadcrumbList
itemListElement with position, name, item for each level
Order Tracking
Order (limited)
orderNumber, orderStatus, orderDate
11.2 URL Structure
•
Product: /products/{slug} (e.g., /products/silk-saree-red) - never use /products/{id}
•
Category: /categories/{slug} (e.g., /categories/sarees)
•
Convention: Lowercase, hyphens (not underscores), short and descriptive
•
Canonical: Every page has a canonical URL. Products accessible from categories always canonicalize to
/products/{slug}
11.3 Meta Tags and Open Graph
•
Title: Product Name | Category | Zabir Boutiques (under 60 characters)
•
Description: Unique per product. Under 160 characters. Includes key details
•
og:title, og:image, og:description: Set on every product and category page for WhatsApp/Facebook sharing
•
og:image: Use 400px variant from R2 CDN for fast social media previews
11.4 Sitemap and Robots
•
Sitemap: Auto-generated daily via Cron Trigger. Uploaded to R2 as /sitemap.xml. Max 50,000 URLs per
sitemap
•
robots.txt: Allow /products/*, /categories/*. Disallow /api/*, /staff/*. Reference sitemap URL
•
Google Search Console: Verify domain. Submit sitemap. Monitor crawl errors and index coverage
11.5 Mobile-First Optimization
Google uses mobile-first indexing. All pages must be optimized for 3G connections (typical in many Bangladesh
regions). Images use responsive srcset with WebP/AVIF format negotiation. JavaScript is minimized via Astro


---

Zabir Boutiques Master Plan  |  Page 25
Islands architecture. Critical CSS is inlined. Non-critical resources are deferred. Target LCP under 2.5 seconds on
Fast 3G throttling.


---

Zabir Boutiques Master Plan  |  Page 26
12. Performance Budgets
Performance budgets are enforced at the CI level. Any PR that exceeds a budget threshold fails the build. This
prevents gradual performance degradation as features are added. Budgets are measured using Lighthouse CI on
the product detail page and checkout page for every PR.
Metric
Target
CI
Threshold
Measurement
Largest Contentful Paint
(LCP)
Under 2.5s
Under 3.0s
Lighthouse CI on product detail page
Interaction to Next Paint
(INP)
Under 200ms
Under 300ms
Chrome UX Report + synthetic monitoring
Cumulative Layout Shift
(CLS)
Under 0.1
Under 0.15
Lighthouse CI
Time to First Byte (TTFB)
Under 800ms
Under
1200ms
Cloudflare Workers Analytics
Total Page Weight
Under
500KB
Under
700KB
Lighthouse CI budget
JavaScript Bundle (per
island)
Under 30KB
gzip
Under 50KB
gzip
Bundlewatch in CI
Maximum Islands per Page
5
7
Astro build output analysis
Worker CPU Time
(checkout)
Under 30ms
Under 50ms
Workers Analytics Engine
12.1 Mobile-Specific Optimization
•
Image Strategy: Responsive srcset with 150px, 400px, 800px variants. WebP/AVIF via Image Resizing.
Lazy loading for below-fold images
•
JavaScript: Maximum 5 React Islands per page. client:idle for non-critical, client:visible for below-fold. No
client:load except above-fold interactive elements
•
CSS: Tailwind CSS with Astro-scoped styles. Critical CSS inlined. System font stack for body, web font for
headings only
•
3G Optimization: Target under 3s LCP on Fast 3G. Test with Chrome DevTools 3G throttling in CI


---

Zabir Boutiques Master Plan  |  Page 27
13. Search Architecture
Product search is a primary user journey. D1's LIKE operator is insufficient for production search. The platform
implements a tiered search strategy starting with D1 full-text search and scaling to Workers AI for semantic
search as the catalog grows.
13.1 Phase 1: D1 Full-Text Search (Launch)
•
Implementation: SQLite FTS5 virtual table on products (name, description, category, tags)
•
Features: Tokenized search, ranking by relevance, prefix matching for autocomplete
•
Limitations: No typo tolerance, no semantic understanding, Bengali language support limited
•
Autocomplete: KV-backed prefix index (updated on product changes). Top 8 suggestions in under 50ms
13.2 Phase 2: Workers AI Semantic Search (Post-Launch)
•
Implementation: Text embeddings via Workers AI (bge-small model) during product creation
•
Storage: Embeddings stored in KV (product_id to vector mapping)
•
Query: Embed search query, find nearest neighbors via cosine similarity
•
Benefits: Semantic understanding (e.g., 'wedding dress' matches 'bridal saree'), typo tolerance, multilingual
13.3 Phase 3: Managed Search Service (Scale)
•
Trigger: When catalog exceeds 10,000 products or search latency exceeds 200ms
•
Options: Typesense (self-hosted on Workers), Algolia (managed), or Meilisearch
•
Sync: Cloudflare Queue triggers search index update on product changes


---

Zabir Boutiques Master Plan  |  Page 28
14. Image Pipeline
14.1 Upload Flow
1. Staff selects images via dashboard. Browser uploads directly to R2 via pre-signed URL (CORS enabled)
2. Upload triggers image-processing Queue message
3. Queue consumer compresses original via Tinify API (fallback: no compression, store original)
4. Compressed original stored as R2 object: products/{product_id}/{variant}/{filename}
5. Cloudflare Image Resizing generates variants on first request (lazy) and caches at edge
14.2 Image Resizing Variants
Variant
Width
Use Case
Format
Quality
thumbnail
150px
Cart, admin lists
WebP / AVIF / JPEG
75%
card
400px
Category grids, search results
WebP / AVIF / JPEG
80%
detail
800px
Product detail page main image
WebP / AVIF / JPEG
85%
zoom
1600px
Product detail page zoom view
WebP / AVIF / JPEG
90%
og-image
1200x630
Social media sharing (Open Graph)
JPEG
85%
14.3 Responsive Image Delivery
img srcset= cdn.../width=150,format=webp/{path} 150w,
cdn.../width=400,format=webp/{path} 400w,
cdn.../width=800,format=webp/{path} 800w
sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
src= cdn.../width=800,format=webp/{path}
alt={product_name} loading=lazy decoding=async width=800 height=800


---

Zabir Boutiques Master Plan  |  Page 29
15. Email and Notification System
Transactional emails are essential for order confirmation, shipping notifications, and password reset flows. The
system uses Resend as the primary email provider, triggered via Cloudflare Queues for reliable async delivery
with retry logic.
Email Type
Trigger
Queue
Template
Frequency Limit
Order
Confirmation
Order creation
order-emails
order-confirmed
1 per order
Payment
Confirmation
Webhook: payment
success
payment-webho
oks
payment-confirmed
1 per payment event
Shipping
Notification
Order status to 'shipped'
order-emails
order-shipped
1 per status change
Delivery
Confirmation
Order status to
'delivered'
order-emails
order-delivered
1 per status change
Password Reset
Staff: reset request
order-emails
password-reset
3 per hour per email
Abandoned Cart
(1h)
Cart untouched for 1
hour
order-emails
abandoned-cart-1h
1 per cart
Abandoned Cart
(24h)
Cart untouched for 24
hours
order-emails
abandoned-cart-24h
1 per cart
Return
Confirmation
Staff: return approved
order-emails
return-confirmed
1 per return
•
Email Provider: Resend (primary) via API. Cloudflare Email Workers for inbound routing
•
Template Engine: React Email templates rendered at build time. Stored as HTML in R2
•
Tracking: Email delivery status tracked in D1 email_log table. Bounce handling via Resend webhook


---

Zabir Boutiques Master Plan  |  Page 30
16. Inventory Management
16.1 Inventory Model
Inventory is tracked at the variant level. The available quantity is a computed value ensuring it is always
consistent: available = stock - reserved - sold. This prevents drift between displayed and actual availability.
•
stock: Total units received (incremented on restock, decremented on sale confirmation)
•
reserved: Units reserved by active checkout sessions (incremented on reservation, decremented on expiry or
confirmation)
•
sold: Units confirmed sold (incremented on order confirmation)
•
available: GENERATED ALWAYS AS (stock - reserved - sold) STORED - always accurate
16.2 Inventory Reconciliation
•
Process: Daily cron counts all order_items with confirmed status. Compares aggregate to variants.stock -
variants.sold. Flags discrepancies above 2 units
•
Stock Adjustments: All manual adjustments logged in stock_adjustments table: variant_id, delta, reason,
adjusted_by, timestamp
•
Low Stock Alerts: Alert when available count drops below 5 units. Daily digest of low-stock items to owner
16.3 Flash Sale Strategy
•
Durable Object Queue: VariantInventoryDO processes reservations sequentially. Zero overselling
guaranteed
•
Virtual Queue: For extreme traffic (more than 100 concurrent checkouts for same variant), implement
virtual queue in DO with position and estimated wait time
•
Cache Strategy: Pre-cache product pages. Serve stock status from DO (strongly consistent) rather than D1
•
Graceful Degradation: If Worker CPU limits approached, return simplified pages. Essential: stock
accuracy, checkout. Non-essential: recommendations, AI features


---

Zabir Boutiques Master Plan  |  Page 31
17. Observability and Monitoring
Production observability is non-negotiable for a payment-processing platform. The system implements structured
logging, custom business metrics, distributed tracing, and automated alerting. Without observability, production
incidents are invisible until customer complaints arrive.
17.1 Logging Architecture
•
Cloudflare Logpush: Workers logs to R2 (raw JSON) and/or external SIEM
•
Log Format: Structured JSON: timestamp, request_id, route, status_code, duration_ms, error_type,
user_type, payment_method
•
PII Scrubbing: Logpush filter strips phone numbers, addresses, payment details before persistence
•
Log Retention: 90 days hot in R2, 1 year in cold storage
•
Audit Log: Separate D1 table (audit_log) for all staff actions. Append-only, cannot be deleted
17.2 Metrics (Workers Analytics Engine)
Metric
Type
Dimensions
Alert Threshold
orders_created
counter
payment_method, channel,
fraud_score_bucket
Drop more than 50% from hourly
baseline
revenue_paisa
counter
payment_method, channel
Zero revenue for 30 min during
business hours
checkout_attempts
counter
result (success/failed/abandoned)
Failure rate above 20% for 15 min
payment_webhook_late
ncy_ms
histogra
m
provider (uddoktapay)
p99 above 5000ms for 10 min
stock_reservation_failu
res
counter
variant_id
Any variant above 10 failures/minute
d1_query_duration_ms
histogra
m
query_type, route
p99 above 2000ms for 10 min
fraud_score_api_latenc
y_ms
histogra
m
provider (fraudbd)
p99 above 3000ms or timeout rate
above 10%
worker_cpu_time_ms
histogra
m
route
p99 above 50ms for 15 min
cache_hit_rate
gauge
content_type
Below 70% for product pages during
peak
17.3 Alerting Rules
•
Critical (page immediately): Payment webhook failure above 5%, D1 unavailable for more than 2 min,
security breach detected


---

Zabir Boutiques Master Plan  |  Page 32
•
High (notify within 15 min): Order creation failure above 20%, FraudBD timeout above 20%, worker error
rate above 5%
•
Medium (notify within 1 hour): Cache hit rate below 50%, stock reservation expiry backlog above 50,
revenue anomaly
•
Low (daily digest): Slow query trends, AI budget consumption, new user registration patterns


---

Zabir Boutiques Master Plan  |  Page 33
18. Environment Separation and CI/CD
18.1 Environment Architecture
Property
Production
Staging
Development
Domain
zabirboutiques.com
staging.zabirboutiques.com
dev.zabirboutiques.com
D1 Database
zabir-prod-db
zabir-staging-db
zabir-dev-db
R2 Bucket
zabir-product-images
zabir-product-images-staging
zabir-product-images-dev
KV Namespaces
SESSION-PROD,
FEATURE-PROD
SESSION-STAGING, etc.
SESSION-DEV, etc.
Durable Objects
Prod namespace
Staging namespace
Dev namespace
Queue Names
payment-webhooks-prod
payment-webhooks-staging
payment-webhooks-dev
Secrets
Real API keys
Test/sandbox keys
Sandbox/mock keys
Data
Real production data
Anonymized prod copy
(weekly)
Seed data + fixtures
UddoktaPay Mode
Production API
Sandbox API
Sandbox + mock
18.2 CI/CD Pipeline
1. Push to any branch triggers build on Cloudflare Pages
2. Build: astro build (with D1 snapshot generation; build:skip-snapshots for CI)
3. Test: Unit tests (Vitest), integration tests against D1 local, schema constraint validation
4. Preview: Non-main branches deploy to preview URL with staging-level bindings
5. Review: Manual review required for production. At least one approval
6. Deploy: Merge to main triggers production deployment via Cloudflare Pages
7. Rollback: One-click rollback via Cloudflare Pages dashboard to any previous deployment
8. Cache Purge: Post-deploy hook purges cache tags for static asset paths
18.3 Database Migrations
•
Tool: Custom migration runner using Wrangler D1 execute
•
Process: Numbered SQL files (001_create_products.sql, 002_add_coupons.sql)
•
CI Validation: Migration dry-run against D1 local. Test all CHECK constraints reject invalid data
•
Staging First: Migrations run on staging before production. 24-hour soak period
•
Rollback: Each migration has a paired rollback migration. Rollback tested in CI


---

Zabir Boutiques Master Plan  |  Page 34
19. Disaster Recovery
19.1 Recovery Objectives
Metric
Target
Notes
RPO (Recovery Point
Objective)
6 hours
Maximum acceptable data loss. Aligned with backup
frequency
RTO (Recovery Time
Objective)
2 hours
Maximum acceptable downtime. Time to restore from
backup
Backup Frequency
Every 6 hours
D1 export to R2 backup bucket via Cron Trigger
Backup Retention
30 days daily, 12
months monthly
Dailies in R2 Standard; monthlies in R2 Infrequent Access
Backup Verification
Weekly
Restore staging from latest backup; run integrity tests
19.2 Backup Strategy
•
D1 Export: Cron Trigger every 6 hours runs 'wrangler d1 export' to R2 bucket zabir-backups
•
Backup Format: SQL dump (full database) + JSON metadata (timestamp, D1 version, row counts)
•
Cross-Region: R2 backup bucket replicated to secondary region for geographic redundancy
•
Verification: Weekly automated restore to staging. Schema integrity tests and row count validation
19.3 Restoration Procedure
1. Identify the most recent valid backup from R2 (check metadata)
2. Create new D1 database or clear existing one
3. Run 'wrangler d1 execute --file=backup.sql' to restore data
4. Verify row counts against backup metadata
5. Run schema integrity tests
6. Update Cloudflare bindings if new D1 database was created
7. Purge all caches (full purge required after data restoration)
8. Smoke test critical flows: product page load, checkout, staff login
9. Monitor error rates for 30 minutes post-restoration
19.4 Incident Response
•
Severity Levels: P1 (revenue-impacting: payments down, checkout broken), P2 (degraded: slow, partial
failures), P3 (minor: UI bugs)
•
P1 Response: Immediate page. Acknowledge within 15 min. Communicate every 30 min. Post-mortem
within 48 hours


---

Zabir Boutiques Master Plan  |  Page 35
•
Escalation: If unresolved within 1 hour, escalate to Cloudflare support. If data corruption suspected, stop all
writes
•
Post-Mortem: Required for all P1 and P2 incidents. Document timeline, root cause, fix, prevention


---

Zabir Boutiques Master Plan  |  Page 36
20. Compliance and Privacy
20.1 Data Protection Framework
While Bangladesh does not have GDPR-equivalent legislation as of 2026, the Digital Security Act 2023 and
emerging data protection frameworks require responsible PII handling. If the platform processes data through
non-BD Cloudflare PoPs, GDPR may apply to EU visitors. The platform adopts GDPR-aligned practices
proactively.
Principle
Implementation
Enforcement
Data
Minimization
Collect only: name, phone, delivery address. No email for
guest checkout
API validation rejects unnecessary
fields
Encryption at
Rest
D1 encrypted by Cloudflare. R2 objects encrypted with
SSE-S3
Platform default
Encryption in
Transit
HTTPS enforced. HSTS enabled. No HTTP access
Cloudflare SSL/TLS: Full (strict)
Data Retention
Customer data: 3 years. Orders: 7 years. Payment records: 7
years. Logs: 90 days
Automated deletion cron (quarterly)
Right to Access
GET /api/me/data (customer downloads their data)
Rate limited: 1 request per day
Right to
Deletion
DELETE /api/me/data (anonymizes PII, preserves order
integrity)
30-day processing window
Consent
Management
Cookie consent banner (essential + analytics). Privacy policy
in footer
Consent state in KV; analytics
blocked until consent
PII Access
Logging
Audit log for all staff views of customer PII
D1 append-only audit_log table
20.2 PCI Considerations
•
No card data logging: Logpush filter strips card number patterns. Verified in CI
•
UddoktaPay integration: Use hosted payment page (redirect) only. Never create custom card input forms
•
Self-assessment: Complete PCI DSS Self-Assessment Questionnaire A annually
•
Regular audit: Quarterly review of integration code to ensure no PCI scope expansion


---

Zabir Boutiques Master Plan  |  Page 37
21. AI Integration
21.1 Service Architecture
AI is used for product description generation and recommendations. Workers AI is the primary provider (lower
latency, no external API call), with DeepSeek as fallback for complex tasks that exceed Workers AI model
capabilities.
Feature
Primary
Fallback
Budget
Product
Descriptions
Workers AI (text
generation)
DeepSeek API
50 generations/day
Product
Recommendations
Workers AI (embeddings
+ cosine)
Category-based
fallback
Unlimited (local computation)
Semantic Search
Workers AI (bge-small
embeddings)
FTS5 text search
Unlimited (local computation)
21.2 Budget Enforcement
•
Counter: BudgetCounterDO provides strongly consistent budget tracking per service per day/month
•
Daily Limit: 50 AI generations per day. Monthly limit: 1,000. Configurable via KV feature flags
•
Soft Limit: At 80% of daily budget, log warning. At 100%, block further requests with user-friendly message
•
Content Moderation: All AI-generated content goes through moderation pipeline. Staff must review and
approve before content goes live
•
Prompt Injection Protection: System prompts hardened. User input sanitized. Detection layer flags
suspicious prompts


---

Zabir Boutiques Master Plan  |  Page 38
22. Implementation Phases and Milestones
The implementation is organized into three phases, each delivering a fully functional increment of the platform.
Every phase ends with a deployable product that provides real business value. Phase boundaries are defined by
capability milestones, not arbitrary time boxes. The sequence prioritizes revenue-generating functionality first,
then operational efficiency, then growth capabilities.
22.1 Phase 1: Core Commerce (Weeks 1-6)
Phase 1 delivers the minimum viable platform that can accept real orders, process payments, and manage
inventory. This is the revenue-critical phase. Every feature in Phase 1 directly enables the business to operate
online.
Milestone
Features
Priority
Weeks
M1: Product
Catalog
Product CRUD, variant management, image upload
to R2, category pages, slug-based URLs, build-time
snapshots
P0 - Critical
1-2
M2: Guest
Checkout
Complete checkout flow (16 steps), D1 schema with
enforced constraints, idempotency via
IdempotencyDO, phone normalization (+880)
P0 - Critical
2-3
M3: Payment
Integration
UddoktaPay primary integration, webhook
processing via Queues, HMAC verification,
payment reconciliation cron (15 min)
P0 - Critical
3-4
M4: Inventory
Control
VariantInventoryDO for stock serialization, stock
reservation lifecycle (10-min TTL), cleanup cron (5
min), available computed column
P0 - Critical
4-5
M5: Staff
Dashboard v1
Staff auth (HttpOnly cookies), basic RBAC
(Owner/Manager/Staff), order list and detail views,
order confirmation and cancellation
P0 - Critical
5-6
22.2 Phase 2: Operational Excellence (Weeks 7-12)
Phase 2 adds the operational capabilities that make the platform sustainable at scale: fraud detection, full
observability, search, email notifications, and the complete order lifecycle including returns and refunds.
Milestone
Features
Priority
Weeks
M6: Security
Hardening
WAF rules, Turnstile on checkout/login, Zero Trust
Access for staff, CSP headers, rate limiting, CSRF
HMAC
P0 - Critical
7-8
M7:
Observability
Stack
Logpush to R2, Analytics Engine with 9 custom
metrics, 4-tier alerting, structured logging, PII
scrubbing
P1 - High
8-9


---

Zabir Boutiques Master Plan  |  Page 39
Milestone
Features
Priority
Weeks
M8: Search and
Discovery
FTS5 full-text search, KV-backed autocomplete,
JSON-LD structured data, sitemap generation cron,
robots.txt
P1 - High
9-10
M9: Email and
Notifications
Resend integration via Queues, order
confirmation/shipping/delivery emails, abandoned
cart reminders, React Email templates
P1 - High
10-11
M10: Order
Lifecycle
Complete
8-state state machine, return/refund flow, shipping
label generation, FraudBD integration, staff-assisted
phone orders
P1 - High
11-12
22.3 Phase 3: Growth and Optimization (Weeks 13-18)
Phase 3 adds growth capabilities: AI integration, performance optimization, advanced caching, environment
hardening, and disaster recovery. These features enable the platform to scale beyond initial launch traffic and
prepare for long-term growth.
Milestone
Features
Priority
Weeks
M11: AI
Integration
Workers AI for product descriptions,
BudgetCounterDO for daily/monthly limits,
DeepSeek fallback, content moderation pipeline,
prompt injection protection
P2 - Medium
13-14
M12:
Performance
Optimization
Cache API with SWR + cache-tag purging, image
pipeline (5 variants, WebP/AVIF), performance
budgets in CI, Bundlewatch, Lighthouse CI
P2 - Medium
14-15
M13:
Environment
Hardening
Full environment separation (dev/staging/prod),
CI/CD pipeline with preview deploys, database
migration runner, 24-hour soak on staging
P2 - Medium
15-16
M14: Disaster
Recovery
D1 backup cron to R2 (6-hour frequency),
cross-region replication, restoration procedure,
incident response playbooks, post-mortem templates
P2 - Medium
16-17
M15:
Compliance and
Polish
GDPR-aligned data protection, cookie consent, PII
access logging, PCI self-assessment, accessibility
audit (WCAG 2.1 AA), inventory reconciliation
P2 - Medium
17-18


---

Zabir Boutiques Master Plan  |  Page 40
23. Absolute Guardrails and Handoff
This document is the implementation contract. The following rules are absolute and must be followed by every
developer and AI coding agent working on the project. Violations indicate a misunderstanding of the architecture
and must be caught in code review.
•
Never move price authority to the browser. The server is the sole source of truth for all monetary calculations.
•
Never create orders before reservation success. Stock must be reserved before the order record is written.
•
Never use floating-point for money. All monetary values are INTEGER paisa. Enforced by D1 CHECK
constraints.
•
Never skip D1 CHECK constraints. They are enforced at the database level, not just application level.
•
All D1 writes go through Pages Function routes. Frontend public pages must never write directly to D1, R2,
or KV.
•
Use Cloudflare Secrets for all API keys. Never commit secrets to Git. Rotate quarterly.
•
Keep generated D1 snapshot files out of Git. Use .gitignore + pre-commit hooks.
•
All Durable Object interactions must handle the single-threaded nature: no concurrent mutations within the
same DO.
•
All payment webhooks must verify HMAC signatures. Never trust unverified webhook payloads.
•
All staff routes require Zero Trust Access + RBAC middleware. No exceptions.
•
No PII in logs. Use structured logging with PII scrubbing in Logpush filters.
•
Cache tags must be purged on any product catalog change. Stale cache is acceptable for up to 5 minutes
maximum.
•
Schema migrations must be tested on staging for 24 hours before production deployment.
•
Every new React Island must have a budget size estimate and approval before implementation.
•
Flash sale events require pre-warming: cache priming, DO instantiation, and queue capacity planning.
•
Astro output mode must be 'hybrid'. Never use 'static' or 'server' output modes.
•
All images must use responsive srcset with WebP/AVIF format negotiation and lazy loading.
•
Accessibility (WCAG 2.1 AA) is mandatory for all user-facing pages, including staff dashboard.
