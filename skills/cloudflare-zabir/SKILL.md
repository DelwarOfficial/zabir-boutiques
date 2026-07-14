---
name: cloudflare-zabir
description: >
  Project-specific Cloudflare guidance for Zabir Boutiques. Use when changing or
  reviewing this repo's Cloudflare Worker/Astro SSR runtime, wrangler bindings,
  D1, R2, KV, Durable Objects, Queues, Workers AI, Analytics Engine, Turnstile,
  cron jobs, deploy scripts, or production-readiness work.
---

# Zabir Boutiques Cloudflare Skill

Use this skill with the general `cloudflare`, `workers-best-practices`, `durable-objects`, `wrangler`, and `cloudflare-email-service` skills when task touches their domain. This file is project truth; official Cloudflare docs still win on API syntax and platform limits.

## Project Shape

- App: Astro SSR commerce platform on Cloudflare Workers.
- Runtime: `astro.config.mjs` uses `output: "server"`, `@astrojs/cloudflare`, `runtime: { mode: "advanced" }`.
- Worker entry: `src/entry-cloudflare.ts` composes Astro SSR `fetch`, scheduled cron, queue handler, and top-level Durable Object exports.
- Deploy config: `wrangler.jsonc` root = production; `env.staging` and `env.dev` override bindings.
- Main deploy: `npm run deploy` builds snapshots/PWA/Astro, then `npx wrangler deploy --cwd dist/server --no-bundle`.
- Node engine: `>=24.12.0`; package manager commands use npm.

## Cloudflare Bindings

- D1: `DB` (`zabir-db`, staging/dev variants).
- KV: `CACHE`, `SESSION`.
- R2: `MEDIA`, `BACKUPS`, `LOGS`, `EMAIL_TEMPLATES`, `REPORTS`.
- Workers AI: `AI` with `remote: true`.
- Analytics Engine: `ANALYTICS`, dataset `zabir_metrics`.
- Durable Objects: `VARIANT_INVENTORY_DO`, `IDEMPOTENCY_DO`, `AI_BUDGET`, `WAF_RULES`, `CART_DO`, `DIRECT_CHECKOUT_DO`, `PROVIDER_HEALTH_DO`.
- Queues: `PAYMENT_WEBHOOKS`, `ORDER_EMAILS`, `IMAGE_PROCESSING`, `FRAUD_AUDIT`, `D1_BACKUP`, `CART_ACTIVITY`.
- Public vars: `PUBLIC_SITE_URL`, `PUBLIC_SITE_NAME`, `TURNSTILE_SITE_KEY`.
- Secrets must use `wrangler secret put`, not `vars`: payment providers, fraud API, AI keys, session/audit/password peppers, `TURNSTILE_SECRET_KEY`, Resend keys, courier keys.

## Non-Negotiable Guardrails

- V7 Master Plan is constitutional source for architecture and guardrails.
- RBAC roles are exactly `super_admin`, `owner`, `manager`, `staff`, `viewer`.
- CartDO is server authority for cart state. LocalStorage is cache/UX only.
- Cart localStorage key is `zb_cart_v68a`; version key is `zb_cart_version`.
- Prepayment threshold uses `totalQuantity` (sum of quantities), not line count.
- Public checkout and buy-now must require Turnstile token when `TURNSTILE_SECRET_KEY` exists.
- Email uses raw `fetch` to Resend REST API; do not add Resend SDK unless explicitly required.
- Runtime D1 access is mostly raw `env.DB.prepare()` SQL. Drizzle schemas organize types/schema, but do not assume Drizzle runtime query layer.
- Do not add backward-compatibility paths unless persisted data, shipped behavior, external consumers, or explicit requirement demands it.
- Do not copy code from external repos into this project. Use reviewed repos as patterns only.

## Durable Object Rules

- DO classes must be imported and top-level exported from `src/entry-cloudflare.ts`.
- Every new DO class needs `durable_objects.bindings` entry and a new `migrations` tag with `new_sqlite_classes`; never edit a published migration tag.
- Use DOs for per-key authority and contention: inventory reservation, idempotency, cart concurrency, direct checkout session, AI budget, WAF/provider health state.
- Public cart mutation must pass `clientVersion` through `/api/cart` to CartDO for optimistic concurrency.
- `replace_all` cart operation should stay one CartDO operation, not clear+loop.
- Inventory fallback paths exist for missing DO bindings in dev. Production should bind DOs; do not normalize missing production DO as healthy.

## D1 Rules

- Migrations live in `db/migrations/*.sql`; schemas live in `src/db/schema/*.ts`.
- Include `products_fts` when auditing DB shape; not represented as normal Drizzle table.
- Use parameterized SQL with `prepare().bind()`.
- Keep audit/event tables append-only unless maintenance/archive path explicitly owns deletion.
- For inventory/order flows, preserve reservation semantics: reserve first, create order/invoice, confirm later in payment/staff flow or release on expiry/cancel.
- Verify migrations with project scripts: `npm run db:migrate:local`, `npm run migrate:status`, and relevant tests.

## Queues Rules

- Queue producers and consumers are configured in `wrangler.jsonc`; route batches in `src/entry-cloudflare.ts` via `baseQueueName()` so `-staging`/`-dev` suffixes still process.
- Producers may no-op when queue binding missing for dev. Consumer failures should `retry()` with clear delay and log through `safeLog`.
- `payment-webhooks` has DLQ; add DLQs deliberately for other high-risk queues if failure domain warrants it.
- Queue message bodies must be small, typed, and re-load sensitive/order state from D1 by id.
- Do not put secrets, full PII payloads, or raw provider blobs into queues unless retention and scrub path are clear.

## Cron Rules

- `wrangler.jsonc` currently deploys exactly 3 triggers: `*/5 * * * *`, `*/15 * * * *`, `0 * * * *`.
- `src/lib/cron-dispatch.ts` multiplexes hourly trigger into daily, 6-hourly, weekly, and monthly work by UTC time.
- Dashboard cron schedules can conflict with Wrangler deploy. Remove dashboard schedules before deploying config-managed triggers.
- Keep `wrangler.jsonc`, README cron docs, and `src/lib/cron-dispatch.ts` aligned when editing schedules.

## R2/KV/Analytics Rules

- R2 `MEDIA` stores product images and generated sitemap; `BACKUPS` stores D1 backups/archive; `LOGS`, `EMAIL_TEMPLATES`, `REPORTS` are separate retention domains.
- Avoid public unauthenticated listing for R2 objects. Use explicit object keys and signed/controlled routes when needed.
- KV is cache/session/budget helper, not source of truth for orders, carts, inventory, or payments.
- Analytics Engine is for business metrics, AI cost, WAF events, money-tampering detection, and rate-limit errors. Missing `ANALYTICS` should degrade safely, not break user flows.

## Security Rules

- CSP generation lives in `src/lib/security/csp.ts`; keep header values flat strings without invalid newlines.
- Middleware owns auth, RBAC, CSRF, rate limiting, CSP, and staff session resolution.
- Staff route permissions live in `src/lib/staff-route-rbac.ts`; update central map when adding `/api/staff/*` endpoints.
- Never log raw PII/secrets; use `safeLog`/PII scrubber.
- Turnstile fail-closed only when `TURNSTILE_SECRET_KEY` configured; tests/dev may omit secret.
- Webhook handlers must verify provider signatures/status server-side and use idempotency.

## External Pattern Sources Reviewed

Use these as inspiration only after checking current upstream docs/license/security. Do not import code directly.

- `benvinegar/counterscale`: useful Analytics Engine + R2 retention/reporting patterns; MIT.
- `brancogao/webhook-debugger`: useful webhook capture/replay/signature-debugging concepts; MIT.
- `yestool/imgUU`: useful Astro SSR + R2 + D1 image-management ideas; config/deps older, pattern-only.
- `WangQueXL/PixR2`: useful R2 image/share concepts; simple Worker deployment model not project-compatible.
- `miantiao-me/Sink`: useful URL analytics/security ideas; stack/licensing make it pattern-only.
- `lyc8503/UptimeFlare`: useful status/monitoring concepts; historical CVE means security-review-only pattern source.
- `smigolsmigol/llmkit`: useful AI gateway/budget ideas; project already has `BudgetCounterDO` and `ai_budget_limits` patterns.

## Change Workflow

1. Inspect current files before proposing Cloudflare changes: `wrangler.jsonc`, `astro.config.mjs`, `src/entry-cloudflare.ts`, `src/env.d.ts`, touched DO/queue/cron files.
2. Check official Cloudflare docs or load relevant Cloudflare skill before relying on platform syntax.
3. Prefer smallest correct change; preserve Astro advanced runtime and Worker entry composition.
4. Update all binding surfaces together: `wrangler.jsonc`, env typings, Worker exports/imports, tests/mocks, deploy docs.
5. For config changes, verify both root production and `env.staging`/`env.dev` blocks.
6. For D1 changes, add SQL migration and update schema/type helpers only when needed.
7. For DO changes, add migration tag and tests around concurrency/idempotency.
8. For queue/cron changes, verify route names, suffix normalization, retries, and DLQ behavior.

## Verification Commands

- Type/Astro check: `npx astro check`.
- Unit tests: `npx vitest run`.
- Drift audit: `npm run audit:drift`.
- Build: `npm run build`.
- Wrangler dry run: `npx wrangler deploy --dry-run` or after build `npx wrangler deploy --cwd dist/server --no-bundle --dry-run`.
- Local migrations: `npm run db:migrate:local`.

Expected current baseline after recent fixes: `npx astro check` has 0 errors; `npx vitest run` passes 44 files / 421 tests.

## Deploy/Rollback Checklist

- Confirm secrets exist in target env; never move secrets into `vars` or committed files.
- Confirm D1 migrations applied before Worker code depends on new tables/columns.
- Confirm queues and DLQs exist in account before deploy.
- Confirm DO migrations are append-only and class exports match bindings.
- Run Wrangler dry run after build because deployed config comes from `dist/server/wrangler.json`.
- For cron changes, remove conflicting dashboard schedules first.
- Rollback path: redeploy previous known-good Worker, preserve D1/DO schema compatibility, and avoid destructive migration rollback unless explicit tested rollback script exists.
