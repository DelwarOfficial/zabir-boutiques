---
name: cloudflare-zabir
description: >
  Project-specific Cloudflare guidance for Zabir Boutiques. Use when changing or
  reviewing this repo's Cloudflare Worker/Astro SSR runtime, wrangler bindings,
  D1, R2, KV, Durable Objects, Queues, Workers AI, Analytics Engine, Turnstile,
  cron jobs, deploy scripts, or production-readiness work. Verified against
  zhuima/awesome-cloudflare originals.
---

# Zabir Boutiques Cloudflare Skill

Use with the general `cloudflare`, `workers-best-practices`, `durable-objects`,
`wrangler`, and `cloudflare-email-service` skills. This file is project truth;
official Cloudflare docs win on API syntax/limits.

## Objective
Teach an AI agent to implement Cloudflare capabilities in THIS codebase using
verified patterns from `zhuima/awesome-cloudflare`, without copying untrusted code.

## Verified Project Context (VERIFIED from repo)
- App: Astro SSR commerce platform on Cloudflare Workers. Node >=24.12.0.
- Runtime: `astro.config.mjs` → `output:"server"`, `@astrojs/cloudflare`,
  `runtime:{mode:"advanced"}`.
- Entry: `src/entry-cloudflare.ts` composes Astro SSR fetch + cron + queue +
  top-level DO exports.
- Deploy: `npm run deploy` → `npx wrangler deploy --cwd dist/server --no-bundle`.
- Bindings (VERIFIED in wrangler.jsonc / env.d.ts):
  D1 `DB`; KV `CACHE`,`SESSION`; R2 `MEDIA`,`BACKUPS`,`LOGS`,
  `EMAIL_TEMPLATES`,`REPORTS`; Workers AI `AI` (remote); Analytics Engine
  `ANALYTICS` (`zabir_metrics`); 7 DOs (`VARIANT_INVENTORY_DO`,`IDEMPOTENCY_DO`,
  `AI_BUDGET`,`WAF_RULES`,`CART_DO`,`DIRECT_CHECKOUT_DO`,`PROVIDER_HEALTH_DO`);
  6 Queues (`PAYMENT_WEBHOOKS`,`ORDER_EMAILS`,`IMAGE_PROCESSING`,`FRAUD_AUDIT`,
  `D1_BACKUP`,`CART_ACTIVITY`); Turnstile (`TURNSTILE_SITE_KEY`,
  `TURNSTILE_SECRET_KEY`); email via raw Resend fetch.
- Cron: 3 triggers (`*/5`,`*/15`,`0 *`) multiplexed in `src/lib/cron-dispatch.ts`.
- RBAC: exactly 5 roles (`super_admin`,`owner`,`manager`,`staff`,`viewer`).
- Cart: CartDO authority; localStorage `zb_cart_v68a` is cache only.

## Supported Use Cases
- Analytics Engine metrics + optional R2 archival.
- R2 product-image upload/serve with D1 metadata.
- Payment/provider webhook ingestion with HMAC signature verification + idempotency.
- Queue-based async work (email, image processing, fraud audit, D1 backup).
- DO-backed inventory reservation, idempotency, cart, AI budget, WAF/provider health.
- Turnstile on public checkout/buy-now.
- Monitoring/status-page patterns (internal, separate Worker).

## Unsupported / Out-of-Scope
- Copying whole external repos into the project (license + architecture risk).
- Adding proxy/VPN, temp-mail, or shortlink SaaS features (not commerce needs).
- Replacing custom RBAC with a third-party IdP dependency.
- Using Pages Functions instead of Astro SSR advanced runtime.

## Relevant Cloudflare Products
Workers, Assets, D1, KV, R2, Durable Objects, Queues, Workers AI, Analytics
Engine, Turnstile, Cron Triggers, Email Routing, Observability.

## Selected Awesome Cloudflare Entries (VERIFIED)
Each opened + evaluated. License/maintenance verified on GitHub.

| Entry | Repo | License | Sel. reason | Verdict |
|---|---|---|---|---|
| counterscale | benvinegar/counterscale | MIT | Analytics Engine + R2 archival for `zabir_metrics` | ADOPT PATTERN |
| webhook-debugger | brancogao/webhook-debugger | MIT | HMAC sig verify + D1 store for payment webhooks | PATTERN-ONLY |
| imgUU | yestool/imgUU | MIT | Astro SSR + R2 + D1 image wiring (best Astro match) | ADOPT PATTERN |
| PixR2 | WangQueXL/PixR2 | MIT | Lightweight R2+KV image host | PATTERN-ONLY |
| CloudFlare-ImgBed | MarSeventh/CloudFlare-ImgBed | MIT | R2 REST upload/WebDAV reference | PATTERN-ONLY |
| Sink | miantiao-me/Sink (canonical ccbikai/Sink) | AGPL-3.0 | Analytics Engine + KV serverless analytics | PATTERN-ONLY (no copy) |
| UptimeFlare | lyc8503/UptimeFlare | Apache-2.0 | Status-page/uptime + D1 + Cron | PATTERN-ONLY (CVE caution) |
| melody-auth | ValueMelody/melody-auth | MIT | RBAC/MFA/JWT-rotation/brute-force reference | PATTERN-ONLY |
| cloudflare_temp_email | dreamhunter2333/cloudflare_temp_email | MIT | Email Routing + Turnstile + AI + R2 attach | PATTERN-ONLY |
| Cloudflare-WeChat-Notifier | krapnikkk/Cloudflare-WeChat-Notifier | MIT | Hono + D1 + Queues + AES-GCM + idempotency | PATTERN-ONLY |
| llmkit | smigolsmigol/llmkit | MIT | AI gateway budget/rate-limit (vs our DO budget) | PATTERN-ONLY |
| gemini-balance-do | zaunist/gemini-balance-do | WTFPL | DO key-pool (not budget) | PATTERN-ONLY / REJECT copy |
| create-microservices-app | microservices-sh/create-microservices-app | MIT | Workers+D1 auth/payment/email module patterns | PATTERN-ONLY |

Rejected: `analytics_with_cloudflare` (stale, D1-only), `cf-workers-status-page`
(abandoned 2021, Flareact), `ssl-certificate-monitor` (open API → SSRF),
temp-mail/proxy/VPN tools (off-topic/security).

## Reusable Architectural Patterns
1. Analytics Engine: write `env.ANALYTICS.writeDataPoint({indexes,blobs,doubles})`;
   counterscale shows long-term R2 archival via Apache Arrow when AE retention
   insufficient. (INFERRED: we keep AE as primary; R2 archival optional.)
2. R2 image: presigned/controlled PUT from Worker; D1 row for metadata +
   ownership; imgUU proves Astro SSR + R2 + D1 wiring. Avoid public listing.
3. Webhook: verify provider HMAC server-side → enqueue to Queue → consumer
   idempotency via `IDEMPOTENCY_DO` → apply. webhook-debugger = HMAC+D1 pattern.
4. Queue + notify: Hono Worker + D1 + Queues + AES-GCM secret-at-rest +
   `dedupeKey` idempotency (Cloudflare-WeChat-Notifier maps to our queue design).
5. AI budget: our `AI_BUDGET` DO atomic increment-and-check is native; llmkit
   does proxy-layer pre-estimate; gemini-balance-do is a key-pool (not budget).
6. RBAC/MFA: melody-auth reference only; our 5-role model stays custom.
7. Status/monitoring: UptimeFlare D1 schema + geo checks + incident history;
   keep server-only config out of any client bundle (CVE-2026-29779 lesson).

## Required Packages & Configuration
- Already present: `@astrojs/cloudflare`, `astro`, `drizzle-orm`, `wrangler`,
  `vitest`, `workers-types`. No new deps required for these patterns.
- Do NOT add Resend SDK (use raw fetch). Do NOT add proxies/VPN libs.
- Community Hono examples are patterns; our runtime stays Astro advanced.

## Environment Variables & Secrets (VERIFIED env.d.ts)
Public vars: `PUBLIC_SITE_URL`, `PUBLIC_SITE_NAME`, `TURNSTILE_SITE_KEY`.
Secrets via `wrangler secret put`: payment keys, fraud API, AI keys,
`SESSION_SECRET`, `API_KEY_PEPPER`, `AUDIT_LEDGER_SECRET`, `PASSWORD_PEPPER`,
`TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, courier keys.
Never put secrets in `vars` or committed files.

## Step-by-Step Implementation Workflow
1. Inspect current files first (wrangler.jsonc, astro.config.mjs,
   entry-cloudflare.ts, env.d.ts, target DO/queue/cron file).
2. Load relevant Cloudflare skill / official docs for API syntax.
3. Prefer smallest correct change; preserve Astro advanced runtime + entry.
4. Update all binding surfaces together: wrangler, env typings, exports,
   tests/mocks, docs.
5. D1: add SQL migration + schema helper only if needed.
6. DO: add migration tag (append-only) + tests for concurrency/idempotency.
7. Queue/cron: verify route names, `-staging/-dev` suffix normalization,
   retries, DLQ.
8. Verify: `npx astro check`, `npx vitest run`, `npm run audit:drift`.

## Project-Specific File Locations
- `src/entry-cloudflare.ts` — DO exports + fetch/cron/queue routing.
- `src/lib/cron-dispatch.ts` — cron multiplexing.
- `src/queues/consumers.ts` — queue producers/consumers.
- `src/do/*.ts` — DO implementations.
- `src/lib/inventory.ts`, `src/lib/orders.ts` — reservation/order flow.
- `src/lib/do-client.ts` — DO helpers + missing-DO fallback warning.
- `src/pages/api/checkout.ts`, `src/pages/api/buy-now/submit.ts` — Turnstile +
  idempotency + reservation.
- `src/lib/email.ts` — Resend raw fetch.
- `src/lib/security/csp.ts`, `src/middleware.ts`, `src/lib/staff-route-rbac.ts`.
- `db/migrations/*.sql`, `src/db/schema/*.ts`.

## Code & Configuration Examples (patterns, not copies)
DO export (entry-cloudflare.ts):
  export { VariantInventoryDO, IdempotencyDO, BudgetCounterDO, WafRules,
           CartDO, DirectCheckoutSessionDO, ProviderHealthDO };
Queue suffix normalization:
  function baseQueueName(q){ return q.replace(/-(staging|dev)$/,""); }
Analytics write:
  env.ANALYTICS.writeDataPoint({ indexes:["orders"], doubles:[revenuePaisa] });
Webhook HMAC (pattern from webhook-debugger):
  verify HMAC-SHA256(rawBody, secret, headerSig) BEFORE enqueue; store only
  minimal fields; set retention/delete policy on raw payloads.
R2 put (pattern from imgUU):
  await env.MEDIA.put(key, body, { httpMetadata, customMetadata:{ownerId} });

## Security & Privacy Requirements
- CSP flat strings (no invalid newlines) in `src/lib/security/csp.ts`.
- Middleware owns auth/RBAC/CSRF/rate-limit/CSP.
- Never log raw PII/secrets; use `safeLog`/PII scrubber.
- Turnstile fail-closed only when `TURNSTILE_SECRET_KEY` set.
- Webhook handlers: verify signature + idempotency; never trust client money.
- UptimeFlare CVE lesson: server-only config (WAF/AI-cost/money secrets) must
  NOT reach client bundles. Enforce server-only access in Astro SSR.
- Cloudflare-WeChat-Notifier flaw: never pass admin tokens in URL query strings.
- gemini-balance-do flaw: strip all hardcoded default keys before any reuse.
- AGPL-3.0 (Sink): do NOT copy code into proprietary commerce.
- Raw webhook payload storage → define retention + encryption.

## Performance & Cost Considerations
- Analytics Engine: near-zero cost at scale; sample if high-volume.
- R2: use cache-friendly keys; avoid listing; lifecycle rules for old images.
- DO: per-key coordination minimizes D1 contention; budget DO prevents runaway AI cost.
- Queues: batch sizes already tuned in wrangler; DLQ for payment-webhooks.
- counterscale R2 archival adds storage cost only if enabled.

## Compatibility Limitations
- All selected repos are standalone Workers/Next.js/Nuxt/Pages, NOT Astro SSR.
  Treat as architectural patterns only.
- imgUU/PixR2/CloudFlare-ImgBed use GitHub-OAuth or open upload — not for
  customer-facing commerce without auth change.
- melody-auth SAML is Node-only (irrelevant to Workers).
- create-microservices-app deploy commands proxy a control plane — do NOT
  describe as live deploy unless wrangler verified.

## Testing & Validation
- `npx astro check` (target: 0 errors).
- `npx vitest run` (baseline: 44 files / 421 tests).
- `npm run audit:drift` (44 D-checks).
- `npm run db:migrate:local` for D1 changes.
- Manual: deploy `--dry-run` after build; verify queue/cron routing in staging.

## Deployment & Rollback Checklist
- Secrets exist in target env; never in `vars`/committed files.
- D1 migrations applied before code depends on new tables/columns.
- Queues + DLQs exist; DO migrations append-only; exports match bindings.
- Wrangler dry-run after build (config from dist/server/wrangler.json).
- Cron: remove conflicting Dashboard schedules first.
- Rollback: redeploy known-good Worker; keep D1/DO schema compatible; avoid
  destructive migration rollback unless tested script exists.

## Official Cloudflare Documentation References
- Analytics Engine: https://developers.cloudflare.com/analytics-engine/
- Durable Objects: https://developers.cloudflare.com/durable-objects/
- Workers AI: https://developers.cloudflare.com/workers-ai/
- Queues: https://developers.cloudflare.com/queues/
- R2: https://developers.cloudflare.com/r2/
- D1: https://developers.cloudflare.com/d1/
- Turnstile: https://developers.cloudflare.com/turnstile/
- Email Routing / cloudflare-email-service skill
- Wrangler: https://developers.cloudflare.com/workers/wrangler/
Prefer official methods when community projects use outdated approaches
(e.g., official R2 S3 SDK over hand-rolled PUT; official D1 over stale Hono D1
samples; official Workers AI binding over proxy gateways unless multi-provider needed).
