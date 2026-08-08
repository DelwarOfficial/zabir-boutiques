# Attack Surface

## Public APIs

| Method/path | Authority | Main controls | Gap |
|---|---|---|---|
| `POST /api/checkout` | cart cookie or body `session_id` | Turnstile, middleware rate limit, idempotency | body can select session; VAT/config and reservation drift |
| `POST /api/buy-now/session` | none | Turnstile/session cookies | binding contract incomplete |
| `POST /api/buy-now/submit` | Buy Now cookies | origin, Turnstile, idempotency | body variant override; redirects from Origin |
| `POST /api/checkout/validate-coupon` | none | none | client subtotal trusted; no coupon-specific limiter |
| `POST /api/payments/create` | none | IP rate limit | arbitrary order lookup/initiation; redirect input trusted |
| `GET /api/payments/status/:id` | none | none | payment/order/invoice/amount disclosure |
| `POST /api/payments/webhook` | HMAC | raw-body HMAC, D1 ingress claim | optional IPN key; generic headers; async fallback loss |
| `POST /api/orders/track` | tracking inputs | rate limit | enumeration depends on input entropy |
| `GET /api/stock/:variantId` | none | endpoint logic | verify coarse band and per-session key |
| `GET/DELETE /api/me/*` | phone verification state | route-specific | customer ownership must be rechecked per route |
| `POST /api/staff/login` | none | origin, rate limit, Turnstile | arbitrary `totp_code` skips Turnstile |
| password reset endpoints | none/token | rate limits | sibling tokens survive successful reset |

## Staff APIs

Middleware authenticates `/staff/*` and `/api/staff/*` (`src/middleware.ts:64-82`) and applies CSRF to mutations (`:84-90`). Route-level RBAC is common. Step-up is inconsistent: role-permission assignment and user reset use it, while returns approval, invoice void, API-key mutation, role mutation, settings, cache purge, inventory adjustment, and TOTP disable do not.

## Webhooks, Queues, Cron

- Payment webhook is sole inbound webhook. No signed courier webhook route exists.
- Six queues are bound; `sitemap-generation` absent. Only three queues have DLQs; no DLQ consumer/drainer exists.
- Cron schedules are multiplexed through `src/lib/cron-dispatch.ts`; no DO/DB lease prevents overlapping ticks.
- No public `/__scheduled` route was found.

## Integrations

Provider folders exist for payments, email, FraudBD, AI, image optimization, courier, Turnstile, and Cloudflare cache. Most clients use timeouts, ProviderHealthDO, and API audit logging. Gaps include incomplete mock-environment enforcement, no courier webhook authenticity layer, direct environment fallbacks, and hardcoded/provider-specific base URLs. Cloudflare outbound email remains implemented despite plan requiring written enablement confirmation.

## Secrets

Secret names are typed in `src/env.d.ts`; values are not present in `wrangler.jsonc`. Runtime existence cannot be confirmed read-only without Cloudflare access. `VAT_RATE_PERCENT` remains typed and used despite retirement. Required rotation runbooks referenced by the plan are absent.
