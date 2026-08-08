# Zabir Boutiques V8 — Red-Team Final Report

**Audit date:** 2026-08-09
**Engagement:** Read-only red-team review (no code mutated)
**Repo HEAD:** `30fa4ab` (2026-08-08 23:58:17 +0600); working tree dirty on `README.md`, `src/lib/idempotency.ts`, `tests/idempotency-stuck-claim.test.ts` (T-27 stuck-claim fix — not yet committed)
**Migration head:** `0047_create_goods_receipts.sql` (conflict C1 with V8 plan head `0039`)
**Source of truth:** `Zabir_Boutiques_Master_Plan_V8_Part-1.md`, `Part-2.md`, `V8_MIGRATION_PLAN.md`, `README.md`, architecture diagram, traceability matrix
**Auditor method:** Every cited `file:line` re-read at HEAD; severity calibrated to business impact in BDT; CWE attached per finding.

> **Prime directive honored.** No source, config, test, migration, doc, or dependency file was created, modified, or deleted by this audit. The only writes were the two deliverables under `docs/audit/redteam-2026-08-09/`.

---

## 1. Executive Summary

The Zabir Boutiques V8 codebase ships a hardened happy path — server-authoritative pricing, atomic D1 batches, a single `adjustStock` writer, signed CSRF tokens, and `__Host-` cookies — but the V8 *contract layer* that the Master Plan treats as load-bearing is, in the main, **not implemented**. The deepest defects are not classic OWASP holes; they are **voided invariants** that the plan says must hold for the platform to be safe to launch.

**Top 5 critical risks**

1. **Settled-money ledger is entirely missing (INV-2).** `payment_transactions` does not exist; `payment_events` dedups on `UNIQUE(invoice_id, event_type, status)` (migration `0001:239`) instead of V8's `UNIQUE(provider, provider_event_id)`; `applyPaymentVerified` mints a fresh `crypto.randomUUID()` for `payment_events.id` (`src/lib/payments.ts:188`) so `INSERT OR IGNORE` can never suppress a replay. A queue consumer crash between commit and `msg.ack()` re-credits the customer. **BDT impact:** unbounded double-credit on every redelivered payment event.

2. **`confirm()` decrements `stock` (INV-1).** Both the DO (`src/do/variant-inventory-do.ts:190`) and the D1 helper (`src/lib/inventory.ts:366`) execute `stock -= qty` on confirm, contradicting the §11.3 invariant table that the plan says is canonical. `available = stock - reserved - sold` drifts from D1 on every confirmed order; stocktakes compound the error. **BDT impact:** phantom oversell, write-off losses at stocktake, eventual sales blockage.

3. **`InvoiceCounterDO` is dead code; receipts use racy D1 `SELECT MAX+1` (INV-3 / K-32).** `nextInvoiceNumber()` has zero call sites; `invoices.ts:280` uses the exact anti-pattern §15.5 forbids. The `UNIQUE(receipt_no)` constraint + retry only catches collisions *after the fact*, producing **gapped serials** — a Bangladesh NBR/Mushak audit liability that can void the VAT register.

4. **Audit log stores raw PII; `customer_ref` HMAC unimplemented (INV-5).** `audit_log` (`0001:266-277`) has no `customer_ref` column; `audit.ts:76-94` writes `entity_id` verbatim; `AUDIT_CUSTOMER_REF_SALT` does not exist in `wrangler.jsonc` or `env.d.ts`; no `trg_audit_log_no_update`/`trg_audit_log_no_delete` triggers exist. The §28.3 promise ("anonymizing the customer row is sufficient because nothing else holds the identity") is **false in code** — the 7-year append-only log retains raw phone/email, making the deletion right unsatisfiable. **BDT impact:** Bangladesh privacy-regulator exposure + forced data- retention violation.

5. **TOTP sub-system trusts client `body.secret` (K-22) + Turnstile bypass via any `totp_code` (K-19) + TOTP disable lacks step-up (K-23).** Together these form an owner-account takeover chain: a stolen session cookie lets an attacker enroll an attacker-controlled TOTP secret (`totp/verify.ts:26,29`), and the bot-protection gate is bypassable by sending `{"totp_code":"1"}` with any credential attempt (`login.ts:64`). **BDT impact:** full owner ATO → payment-provider dashboard, refund drain, data exfiltration.

**Root causes (systemic)**

- **V8 contract layer landed as markdown, not code.** The Master Plan was updated to V8 in commit `42f3ecc` (2026-08-08) — the same day this codebase was being prepared for launch — but the schema migrations that enforce V8 invariants (`payment_transactions`, `customer_ref`, DO snapshot, `tax_rates`, two reservation partial indexes) were never written. Repo migration head `0047` pre-empts the V8 plan's reserved range (`0040-0047`), so V8 schema work is now blocked on a renumbering decision (conflict C1).
- **The drift gate enforces V7, not V8.** `scripts/audit/audit-drift.ts:472` asserts 44 checks (V8 mandates 46); D-19 and D-23 are *inverted* (they fail a compliant V8 codebase and pass a non-compliant one). The merge gate is providing false assurance — ADR-0001 documents this but is still `Proposed`.
- **Test theatre.** `tests/race-conditions.test.ts:34-44` and `tests/paid-expired-reservation.test.ts:9-54` are hand-rolled sequential JS over in-memory `Map`s; they assert closed-system counters and cannot detect the SQL races they are named after. Of the 31 mandatory tests in §37.0, only one (`cart-do-alarm-handoff.test.ts`) exists by canonical name.
- **Step-up auth is opt-in per-handler.** There is no central sensitive-route registry; coverage is therefore patchy — 11 sensitive handlers lack `requireRecentStaffSession` (K-24).

**Launch verdict:** **BLOCK.** The invariant violations (INV-1 through INV-10) and the TOTP/Turnstile chain (K-19/K-22/K-23) are launch blockers. The remaining K and NEW findings are remediable in a 30/60/90 plan but the invariant set must land first.

---

## 2. System Truth Sheet

### 2.1 Bindings (verified from `wrangler.jsonc`)

| Layer | Binding(s) | Value / note |
|---|---|---|
| Worker | `name: zabirboutiques`, `main: ./src/entry-cloudflare.ts` | `compatibility_date 2026-06-04`, `nodejs_compat` |
| Astro | `output: 'server'` (`astro.config.mjs:9`), `session: false`, `@astrojs/cloudflare` advanced | server mode; `'static'`/`'hybrid'` absent ✅ |
| D1 | `DB` → `zabir-db` | 1 prod DB; staging/dev variants present |
| KV | `CACHE`, `SESSION` | 2 (V8 §6.4 names more; only 2 bound) |
| R2 | `MEDIA`, `BACKUPS`, `LOGS`, `EMAIL_TEMPLATES`, `REPORTS` | ⚠ `EMAIL_TEMPLATES` bucket name is `zabir-email-templates-prod` vs V8 §6.5 bare `zabir-email-templates` |
| Workers AI | `AI` (remote) | |
| Analytics Engine | `ANALYTICS` → `zabir_metrics` | |
| Cron | `*/5 * * * *`, `*/15 * * * *`, `0 * * * *` | multiplexed in `src/lib/cron-dispatch.ts` |
| Queues | 6 producers + 6 consumers | `payment-webhooks`(DLQ), `order-emails`, `image-processing`, `fraud-audit`(DLQ), `d1-backup`(DLQ), `cart-activity` |
| Assets | `run_worker_first: ["/staff/*", "/api/*"]` | customer routes bypassed — see N-18 |

### 2.2 Durable Objects — 8 declared, 7 mandated (NEW N-1)

`wrangler.jsonc:84-95` declares **8** DO classes; V8 §6.6 (`Part-1.md:880-886`) mandates **7**. The extra is `WafRules` (not in the plan).

| DO binding | Class | Actual object ID | V8 §6.6 mandated | Match? |
|---|---|---|---|---|
| `VARIANT_INVENTORY_DO` | VariantInventoryDO | `idFromName(variantId)` raw | `variant:{variant_id}` | ❌ no prefix |
| `IDEMPOTENCY_DO` | IdempotencyDO | `idFromName(key)` raw | `idem:{scope}:{idempotency_key}` | ❌ no prefix; also **no alarm** (records never self-clean) |
| `AI_BUDGET` | BudgetCounterDO | `{provider}:{date}` (INV-8) | `budget:{provider}` | ❌ wrong format |
| `WAF_RULES` | WafRules | raw | **not in plan** | n/a — extra DO |
| `CART_DO` | CartDO | `idFromName(sessionId)` raw | `cart:{session_id}` | ❌ no prefix (alarm handoff ✅) |
| `DIRECT_CHECKOUT_DO` | DirectCheckoutSessionDO | `idFromName(sessionId)` raw | `buy:{session_id}` | ❌ no prefix |
| `PROVIDER_HEALTH_DO` | ProviderHealthDO | `idFromName(provider)` raw | `provider:{name}` | ❌ no prefix |
| `INVOICE_COUNTER_DO` | InvoiceCounterDO | `invoice-counter:{YYYYMMDD}` (documented) | same | ⚠ format correct but **never instantiated** — `nextInvoiceNumber()` has 0 call sites |

DO migrations v1→v4 (append-only) ✅. **6 of 8 DOs use raw unprefixed object IDs (NEW N-2)** — flat namespace, cross-type collision risk.

### 2.3 Prerender whitelist

`export const prerender = true` appears in **11 route files**: 5 legal (`/about`, `/privacy`, `/terms`, `/return-policy`, `/size-guide` ✅) + **6 catalog violations** (`index.astro`, `robots.txt.ts`, `products/[slug].astro`, `categories/[slug].astro`, `collections/[slug].astro`, `blog/[slug].astro` ❌ RT-009 / D-03). Waived under `W-2026-01`. `prerender = false` appears nowhere ✅.

### 2.4 Trust primitives — root of trust

| Primitive | File | Holds? | Evidence | Deviation |
|---|---|---|---|---|
| `security.ts` | `src/lib/security.ts:9-30` | ✅ Y | `timingSafeEqualHex` byte-XOR (L9-14); HMAC-SHA256 via `crypto.subtle` (L23-30); `crypto.getRandomValues` (L18); `verifyCsrfToken` uses CT compare (L55) | None here. CT primitive not reused everywhere (K-29). |
| `payment-webhook-ingress` | `src/lib/payment-webhook-ingress.ts` | ⚠ Partial | HMAC over `rawBody` before any DB write (L13-22 ✅); `INSERT OR IGNORE` + `changes===1` (L71-79 ✅) | **PAY-003 open:** `readWebhookSignature` accepts `X-UddoktaPay-Signature` \|\| `X-Signature` \|\| `Signature` (L24-31). **Event-id fallback** to `sha256(rawBody)` (L44-53) weakens replay (K-06). Dedup is on body-hash id, not `UNIQUE(provider, provider_event_id)`. |
| `csrf.ts` | `src/lib/csrf.ts` | ✅ Y | Token `nonce.HMAC(nonce)` (via security.ts); cookie `__Host-csrf-token; HttpOnly; Secure; SameSite=Strict` (L10,17); 3 checks: presence / equality / signature (L28-36) | L31 `cookieToken !== headerToken` non-CT (low; equality of two client copies; real check is the CT HMAC). "Only login exempt" enforced in middleware, not here. |
| `pii-scrubber.ts` | `src/lib/pii-scrubber.ts` | ⚠ Partial | `safeLog` chokepoint (L74-78); PHONE/EMAIL regex scrub (L25-29) | `PII_KEYS` (L9-23) omits `nid`/`national_id`/`passport`/`postal_code`/`full_name`/`name`/`dob`/`date_of_birth` (K-30). **No ESLint config** — `safeLog` is sanctioned but unenforced; raw `console.*` allowed anywhere (NEW N-17: `RootLayout.astro:195`). |

### 2.5 Guardrails inventory (§30, 50 rules)

From the traceability pass: **~28 satisfied, ~22 partial/missing** of 50. Heaviest P0 load in Cluster 1 (Money: #19, #25, #32, #46) + Cluster 2 (Inventory: #12, #16, #17, #43, #44, #47, #50) + Cluster 4 (Audit/Privacy: #33). Full per-guardrail verdict in §9.

### 2.6 Drift codes (§38, D-01..D-46) + audit-drift.ts state

`scripts/audit/audit-drift.ts:472` asserts `checks.length !== 44` and exits with "expected 44 checks". V8 §38.4 mandates **46**. The script ships codes D-01..D-44 — **D-45 and D-46 are missing** (NEW N-5).

ADR-0001 (`docs/adr/0001-audit-drift-v8-realignment.md`) flags this and two **inverted** checks (NEW N-4):

- **D-19** (`audit-drift.ts:269-272`) *passes* when `VAT_RATE_PERCENT` is present and *fails* when it's absent — the inverse of V8 §41 which retires the env var. A compliant V8 `checkout.ts` would be reported as drift.
- **D-23** (`audit-drift.ts:289-292`) *passes* when the retired `idx_stock_reservations_order_active` is present — the inverse of V8 §43 / RT-002. It also reads migrations `0024/0027`; V8 §35.2 says the canonical indexes are created by `0042/0043` and the retired index dropped by `0041`.

Markdown `--glob '!**/*.md'` exclusion for D-01/D-02: **present** (`audit-drift.ts:210-211`). Waiver engine: **present** (`loadWaivers`, `findActiveWaiver`, applied in `main`).

The merge gate is currently enforcing V7, not V8.

### 2.7 Acceptance gates & KPIs

| Gate | Target | Current state |
|---|---|---|
| 50 guardrails | all satisfied or waived | ~28 satisfied, ~22 partial/missing |
| 31 mandatory tests (§37.0) | all green | **1 of 31** by canonical name (`cart-do-alarm-handoff`) |
| 25 FraudBD CB tests (§37.1) | all green | present as consolidated file (not 25-fixture layout) |
| 46 drift checks | 0 active P0 | **0 active, 6 waived** (W-2026-01) — but gate is V7-aligned |
| Performance (LCP/INP/TTFB) | LCP<2.5s, INP<200ms, checkout TTFB<800ms | not run this audit |
| `payment_webhook_latency_ms` p99 | <5000ms | not measured (binding present; no dashboard evidence) |
| `cache_hit_rate` | ≥70% | not measured |

---

## 3. Attack Surface Map

### 3.1 Public unauthenticated endpoints (no auth guard)

| Method | Path | Body params | CSRF | Rate-limited | Notes |
|---|---|---|---|---|---|
| POST | `/api/payments/webhook` | provider payload | HMAC + optional IPN key | — | K-01, K-02, K-05 |
| POST | `/api/payments/create` | order_id, customer_phone | — | middleware 20/min | K-03 |
| GET | `/api/payments/status/[id]` | — | — | — | **K-04 unauth leak** |
| GET | `/api/payments/reconcile` | — | rA (staff) | — | OK |
| POST | `/api/checkout` | full checkout | Turnstile | middleware 20/min | K-09, K-13, K-18 |
| POST | `/api/checkout/validate-coupon` | code, subtotalPaisa | — | — | **K-10, K-11 unprotected** |
| POST | `/api/buy-now/session` | slug, qty, variantId | — | — | OK (creates session) |
| POST | `/api/buy-now/submit` | variant_id, quantity | Turnstile + Origin | — | K-12, K-13, K-14 |
| GET/POST | `/api/cart` | action, items | — | — | K-40 (no HMAC on sid) |
| POST | `/api/orders/track` | orderNumber, phone | — | middleware 30/min | OK |
| GET | `/api/search` | q | — | — | OK |
| GET | `/api/stock/[variantId]` | — | — | — | OK (count only) |
| POST | `/api/analytics/vitals` | name, value, rating, page | — | — | **NEW N-25 no RL** |
| GET | `/api/public/settings` | — | — | — | OK (10-key allowlist) |
| GET | `/api/me/data` | Bearer token | — | — | phone-OTP gated |
| DELETE | `/api/me/data` | Bearer token | — | — | N-11, N-12 (compliance gap) |
| POST | `/api/me/verify-phone/send` | phone | — | OTP lib limit | OK |
| POST | `/api/me/verify-phone/confirm` | code | — | — | K-29 non-CT |
| GET | `/sitemap.xml`, `/robots.txt` | — | — | — | prerendered (RT-009) |

### 3.2 Customer-authenticated endpoints

| Path | Cookie | Session binding | Owner check |
|---|---|---|---|
| `/api/cart` | `zb_cart_sid` | **raw UUID, no HMAC** (K-40) | n/a (any sid reads its cart) |
| `/api/checkout` | `zb_cart_sid` | body `session_id` overrides cookie (K-18) | none — guest cart |
| `/api/buy-now/submit` | `__Host-bn_sid`, `__Host-bn_bind` | sha256(binding_secret) | K-14 empty-secret bypass |

### 3.3 Staff endpoints (55 routes)

All staff routes go through middleware (`STAFF_PROTECTED` regex at `middleware.ts:27`) which resolves the session once and enforces RBAC via `getRequiredStaffPermission`. **11 sensitive routes lack `requireRecentStaffSession`** (K-24). The middleware path-bypass surface (case, trailing slash, encoding) was not independently pen-tested this pass — `getRequiredStaffPermission` uses `p.includes(...)` substrings which are case-insensitive but not encoding-aware; recommend an explicit fuzz test.

### 3.4 Webhooks & cron

- **Payment webhook:** `POST /api/payments/webhook` — HMAC + IPN key (K-01 fail-open, K-02 generic header fallback).
- **Courier webhooks:** **none.** No `/api/courier/[provider]/webhook` route exists (K-35). Courier clients are outbound-only.
- **Cron:** 3 triggers multiplexed in `src/lib/cron-dispatch.ts`. `/__scheduled` not externally exposed ✅. No concurrent-execution lock observed (NEW — minor).

### 3.5 External integrations & secrets

12 adapter domains under `src/lib/integrations/`: `cloudflare_cache`, `cloudflare_turnstile`, `courier/{pathao,redx,steadfast}`, `deepseek`, `email/{resend,cloudflare_email}`, `fraudbd`, `imagify`, `payments`, `sslcommerz`, `tinify`, `uddoktapay`, `workers_ai`. Each ships `{client,errors,index,mock,types}.ts`. Mock toggle is body-driven for courier (K-34), env-driven elsewhere. No hardcoded keys found in source ( secrets expected in Cloudflare Secrets — not auditable from code).

---

## 4. Threat Model (STRIDE + Attack Trees)

### 4.1 STRIDE per asset

| Asset | Spoofing | Tampering | Repudiation | Info Disclosure | DoS | EoP |
|---|---|---|---|---|---|---|
| D1 tables | K-18 (body sid) | INV-1, K-09 | INV-5 (no customer_ref) | K-04 | — | K-24 |
| R2 buckets | — | — | — | — | — | — |
| KV (`SESSION`, `CACHE`) | K-40 (raw UUID) | N-6 (dead cache read) | — | — | K-26 (fail-open) | — |
| DO state | K-14 (empty bind) | INV-1, INV-3, INV-8 | — | — | — | — |
| Queues | — | K-43 (non-idempotent) | — | — | K-42 (no DLQ drain) | — |
| Session cookies | K-19, K-22, K-23 | K-36 (no rotation) | — | — | — | K-24 |
| Audit log | — | INV-5 (no triggers) | INV-5 | INV-5 | — | — |
| Payment provider | K-01, K-02 | INV-2 | — | K-04 | — | — |
| Customer PII | — | — | — | INV-5, N-11 | — | — |
| Invoice serials | — | INV-3 | — | — | — | — |

### 4.2 Top-10 attack trees (with PoC pointers)

**AT-1: Free goods via zero-paisa payment race (K-09 + INV-1)**
1. Attacker opens two checkout tabs for the same high-value variant, submitting both within ~50ms.
2. Each `INSERT INTO orders` omits `advance_paisa` (`checkout.ts:354-367`); the separate `UPDATE ... SET advance_paisa` runs after (`:374-376`).
3. A payment-create request racing in the window reads `advance_paisa=0`, creates a payment for `0` paisa, the gateway returns success on a 0-amount charge.
4. The confirm path then decrements `stock` (INV-1) but the order is "paid" with zero balance → free goods.
*PoC:* Appendix A.1.

**AT-2: Webhook forgery via dropped IPN header (K-01)**
1. Attacker captures one valid signed webhook from a prior order (or buys one item themselves).
2. They replay the body to `/api/payments/webhook` *without* the `RT-UDDOKTAPAY-API-KEY` header.
3. `webhook.ts:29-32` evaluates `if (ipnKey && env.UDDOKTAPAY_API_KEY && ...)` — the omitted header makes `ipnKey` falsy, skipping the check entirely.
4. If the HMAC secret is also weakly configured (or the attacker uses the K-02 generic `Signature` fallback), the replay is accepted and a fresh `payment_events.id=randomUUID()` row credits a different order.
*PoC:* Appendix A.2.

**AT-3: Invoice serial collision (INV-3 / K-32)**
1. Two cashier tablets POST `/api/staff/invoices` within the same 50ms.
2. Both call `generateReceiptNoWithRetry` (`invoices.ts:280`) → both `SELECT MAX+1` get the same counter.
3. Both INSERT; the `UNIQUE(receipt_no)` rejects the second; the retry loop bumps and retries — but the burned serial is now gapped.
4. NBR auditor flags the gap; VAT register may be voided.
*PoC:* Appendix A.3.

**AT-4: Owner takeover via TOTP `body.secret` (K-22)**
1. Attacker phishes the owner's session cookie (or uses a stolen laptop with the cookie still warm).
2. `POST /api/staff/totp/verify` with `{"secret":"<attacker_secret>","code":"<attacker_code>"}` — `verify.ts:26,29` calls `verifyTotpCode(body.secret, ...)` and `storeStaffTotpSecret(... body.secret)`.
3. Owner's TOTP is now the attacker's secret. Attacker has persistent 2FA bypass.
4. Disable step is `requireAuth`-only (K-23) so even the original owner cannot recover without a password reset.
*PoC:* Appendix A.4.

**AT-5: Turnstile bypass on staff login (K-19)**
1. Attacker points a credential-stuffing script at `/api/staff/login`.
2. Every request includes `"totp_code":"1"` — `login.ts:64` `if (env.TURNSTILE_SECRET_KEY && !body.totp_code)` short-circuits the entire Turnstile block.
3. Rate-limit (10/min) is the only remaining throttle; the attacker distributes across IPs via `X-Forwarded-For` (K-27 fallback trusted).
*PoC:* Appendix A.5.

**AT-6: Refund drain via returns/approve (K-33)**
1. A staff colluder (or attacker via K-24 missing step-up) opens `/api/staff/returns/[id]/approve` for a return they created on a compromised customer account.
2. `approve.ts:135-153` restocks via `doAdjustStock` **before** the refund call.
3. The refund API call fails (or the staff colluder forces a network error) — `approve.ts:182-188` reverts `return_requests` to `'pending'` but **does not** reverse the restock.
4. Repeat: stock is inflated; refunds are not actually paid. The colluder sells the inflated stock offline.
*PoC:* Appendix A.6.

**AT-7: Cart-sid hijack via abandoned-cart email (K-39 + K-18 + K-40)**
1. A customer adds items but abandons; the cart-activity consumer fires an abandoned-cart email.
2. `consumers.ts:148-153` puts `session_id` in the recovery URL query string (`/checkout?session_id=...`).
3. The URL leaks via Referer to a third-party analytics script, via proxy logs, or via browser history on a shared device.
4. The attacker hits `/api/checkout?session_id=<leaked>` — `checkout.ts:88-93` accepts body/URL `session_id` and overrides the cookie (K-18). The cart sid is an unsigned raw UUID (K-40), so no HMAC check stops this.
5. Attacker places an order from the victim's cart with the victim's saved details.
*PoC:* Appendix A.7.

**AT-8: Buy-Now empty binding secret (K-14)**
1. Attacker creates a Buy-Now session without sending a `bindingSecret` (`do-client.ts:449-461`).
2. `direct-checkout-session-do.ts:87` stores `bindingHash = sha256('')`.
3. The attacker can resume the session from any device by presenting `bindingSecret=""` — `verifySessionBinding` (`:219-225`) computes `sha256('') === sha256('')` → true.
4. D1 fallback is worse: `submit.ts:77,80` matches on `bindingHash IS NULL` for empty secrets.
*PoC:* Appendix A.8.

**AT-9: Open-redirect phishing via Origin (K-13)**
1. Attacker hosts a phishing page at `https://zabirboutiques-secure.com` and links to `/api/checkout` from there with `Origin: https://zabirboutiques-secure.com`.
2. `checkout.ts:383-393` builds `redirectUrl = ${origin}/order-track` — the post-payment redirect sends the victim to the phishing site.
3. The phishing site mimics the order-confirmation page and captures card details "for verification".
*PoC:* Appendix A.9.

**AT-10: Payment replay via placebo dedup (INV-2)**
1. A legitimate `payment.success` webhook arrives; the queue consumer commits `applyPaymentVerified` (INSERT `payment_events.id=randomUUID()`, UPDATE `payments.status='paid'`) but the Worker dies before `msg.ack()`.
2. Queue redelivers. `applyPaymentVerified` (`payments.ts:188`) mints a *fresh* `randomUUID()` for `payment_events.id`, so `INSERT OR IGNORE` never collides on the PK.
3. The dedup that exists is `UNIQUE(invoice_id, event_type, status)` (migration `0001:239`) — both rows have the same `(invoice_id, 'webhook', 'received')`, so the second INSERT *does* collide here. **However**, the queue consumer returns 200 either way and the customer-facing state may already have flipped. The V8 mandated `UNIQUE(provider, provider_event_id)` is absent, so a slightly tweaked body (whitespace, reordered keys) produces a different `sha256(rawBody)` event id and bypasses even this weak guard.
*PoC:* Appendix A.10.

### 4.3 Invariant catalog (falsifiable claims)

The plan specifies ~19 invariants; the audit falsifies 10 (see §6).

---

## 5. Findings

> Severity = business impact. Confidence: CONFIRMED = read & verified at HEAD; LIKELY = strong evidence; NEEDS-VERIFICATION = suspected. Every finding cites `file:line`.

### 5.A Critical — invariant violations (INV-1..INV-10)

---

### FINDING-INV-1: `confirm()` decrements `stock` — violates V8 §11.3
- **Domain:** Inventory
- **File:line:** `src/do/variant-inventory-do.ts:190` (`this.stock -= qty;` in confirm action); mirrored at `src/lib/inventory.ts:366` (`quantity = quantity - ?1` inside `confirmReservationsForOrder`)
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-840 (business logic), CWE-682 (incorrect calculation)
- **Master-plan ref:** §11.3 stock table (`Part-1.md:1468-1477`), Guardrail #44
- **Description:** V8 mandates `stock` is invariant under `confirm()`; only `reserved → sold` shifts. The DO and D1 helper both decrement `stock` on confirm, directly contradicting their own `adjustStock()` (which correctly treats stock as invariant). `available = stock - reserved - sold` drifts from D1 on every confirmed order.
- **Code excerpt:**
```ts
// src/do/variant-inventory-do.ts:185-197
if (action === "confirm") {
  if (this.reserved < qty) {
    return Response.json({ ok: false, error: "OVER_ALLOCATED" }, { status: 409 });
  }
  this.stock -= qty;          // ← VIOLATION
  this.reserved -= qty;
  this.sold += qty;
  ...
}
```
```ts
// src/lib/inventory.ts:362-370
db.prepare(
  `UPDATE inventory_items
   SET reserved_quantity = reserved_quantity - ?1,
       quantity = quantity - ?1,    -- ← VIOLATION
       updated_at = ?3
   WHERE variant_id = ?2 AND reserved_quantity >= ?1 AND quantity >= ?1`,
)
```
- **Attack scenario:** See AT-1. Two buyers reserve the last unit; first confirms → DO `stock` drops, `sold` rises, `reserved` drops. Second buyer's reservation now points at a `stock` value that no longer reflects "units ever received." Stocktake corrections via `adjustStock` compound the error; reconciliation reports phantom drift; oversell becomes possible.
- **Evidence:** Direct code read at both files; `confirmReservationsForOrder` is the sanctioned D1 helper used by `confirm.ts`.
- **Recommended fix:**
```diff
- this.stock -= qty;
+ // stock is invariant under confirm() per V8 §11.3
  this.reserved -= qty;
  this.sold += qty;
```
and
```diff
-        quantity = quantity - ?1,
```
(delete the line; keep `reserved_quantity = reserved_quantity - ?1`.)
[RECOMMEND ONLY — DO NOT APPLY]
- **Verification:** §37.0 #1 `reservation-oversell-concurrency` + new `confirm-stock-invariant` test asserting `stock` unchanged across reserve→confirm.
- **Blocks launch:** Yes

---

### FINDING-INV-2: Settled-money ledger layer entirely missing (F-01 / RV8-001 / D-42)
- **Domain:** Payments
- **File:line:** `db/migrations/0001_initial_v6_8a_schema.sql:231-240` (`payment_events UNIQUE(invoice_id, event_type, status)`, no `provider`/`provider_event_id` columns); `src/lib/payments.ts:188` (`const eventId = crypto.randomUUID();`); `grep payment_transactions src/ db/` = 0 hits
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-294 (auth bypass by replay), CWE-697 (incorrect comparison)
- **Master-plan ref:** §0 (`Part-1.md:87`), §11.5 step 7 (`Part-1.md:1536`), Guardrail #46, D-40, D-42
- **Description:** The V8 double-credit defenses — `payment_events.UNIQUE(provider, provider_event_id)` and `payment_transactions.UNIQUE(payment_event_id, direction)` — do not exist. `applyPaymentVerified` mints a fresh random UUID for `payment_events.id`, so `INSERT OR IGNORE` can never suppress a replay by PK. The only dedup is the legacy `UNIQUE(invoice_id, event_type, status)` constraint, which collapses on any body tweak that changes the event_id fallback hash.
- **Code excerpt:**
```ts
// src/lib/payments.ts:188-201
const eventId = crypto.randomUUID();
const claimStmt = db
  .prepare(
    `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
     VALUES (?1, ?2, ?3, 'webhook', ?4, ?5, ?6)`,
  )
  .bind(eventId, payment.id, invoiceId, isPartialPrepay ? 'partially_paid' : 'paid', verified.rawResponse, now);
```
```sql
-- 0001_initial_v6_8a_schema.sql:231-240
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_payload TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(invoice_id, event_type, status)   -- ← NOT V8's (provider, provider_event_id)
);
```
- **Attack scenario:** See AT-10. Queue redelivery → fresh UUID → second `payment_events` row → potentially second credit, bounded only by the `payments.status` guard which is a single UPDATE WHERE clause.
- **Evidence:** Grep `INSERT INTO payment_transactions` across `src/` = 0 hits; `payment_transactions` mentioned only in `docs/`.
- **Recommended fix:** Land V8 migrations (renumbered `0048+` per C1) adding `payment_events.{provider, provider_event_id}` + `UNIQUE(provider, provider_event_id)`; create `payment_transactions` table + `UNIQUE(payment_event_id, direction)`; rewrite `applyPaymentVerified` to use the stable provider event id and write the ledger row keyed by it; treat unique violation as no-op replay. [RECOMMEND ONLY]
- **Verification:** §37.0 #14 `payment-webhook-replay` — same signed event 3× = 1 row, 1 ledger entry, 1 credit.
- **Blocks launch:** Yes

---

### FINDING-INV-3: `InvoiceCounterDO` dead code; racy D1 `SELECT MAX+1` (RT-008 / K-32)
- **Domain:** POS / compliance
- **File:line:** `src/lib/invoices.ts:280` (`generateReceiptNoWithRetry`); `:58-73` `SELECT receipt_no … ORDER BY … LIMIT 1` + compute next; `grep nextInvoiceNumber src/` = 0 call sites outside the contract
- **Severity:** Critical (Mushak compliance)
- **Confidence:** CONFIRMED
- **CWE:** CWE-367 (TOCTOU race)
- **Master-plan ref:** §15.5 (`Part-1.md:1914-1927`), RT-008, Guardrail #48 (migration discipline)
- **Description:** The DO is bound (`wrangler.jsonc:93`), exported (`entry-cloudflare.ts:37`), and its `nextInvoiceNumber()` method is implemented (`invoice-counter-do.ts:77`) — but **nothing calls it**. `invoices.ts` uses the exact `SELECT MAX+1` anti-pattern that V8 §15.5 forbids. The `UNIQUE(receipt_no)` constraint + retry loop only catches collisions after the fact, producing burned (gapped) serials.
- **Code excerpt:**
```ts
// src/lib/invoices.ts:58-73
const lastRow = await db
  .prepare(
    `SELECT receipt_no FROM invoices
     WHERE receipt_no LIKE ?1
     ORDER BY receipt_no DESC LIMIT 1`,
  )
  .bind(`${prefix}%`)
  .first<{ receipt_no: string }>();

let nextCounter = 1;
if (lastRow?.receipt_no) {
  const match = lastRow.receipt_no.match(/-(\d+)$/);
  if (match) nextCounter = Number(match[1]) + 1;
}
```
- **Attack scenario:** See AT-3. Two concurrent cashiers produce a gapped serial; NBR VAT audit flags the gap; VAT register may be voided, requiring re-issue of all invoices for the period.
- **Evidence:** `rg "INVOICE_COUNTER_DO\.(get|idFromName)" src/` = 0 hits; `rg "nextInvoiceNumber" src/` returns only the contract (`contracts/invoice-counter-do.ts:16`) and the implementation (`invoice-counter-do.ts:77`).
- **Recommended fix:** Replace `generateReceiptNoWithRetry` with `env.INVOICE_COUNTER_DO.idFromName(\`invoice-counter:${YYYYMMDD}\`).get()` → `nextInvoiceNumber()`. On D1 invoice-write failure, record the serial as `serial_burned` in `invoice_audit` (never reuse). [RECOMMEND ONLY]
- **Verification:** §37.0 #12 `pos-invoice-number-concurrency` — 20 concurrent creations = 20 distinct sequential serials.
- **Blocks launch:** Yes

---

### FINDING-INV-4: DO snapshot + `restoreFromSnapshot` entirely missing (RT-004)
- **Domain:** Disaster recovery
- **File:line:** `grep restoreFromSnapshot src/` = 0; `grep DR_RESTORE_ENABLED src/` = 0; `src/lib/cron-dispatch.ts:40-45` hourly job runs reconcile only
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-400 (uncontrolled resource consumption — unrecoverable state), CWE-754
- **Master-plan ref:** §27.2 (`Part-2.md:87`), §27.3 step 6-7 (`Part-2.md:102-103`), RT-004, Guardrail #47
- **Description:** The hourly `VariantInventoryDO`→R2 JSONL snapshot, the `restoreFromSnapshot()` DO method, and the `DR_RESTORE_ENABLED` env gate are all absent. The weekly restore drill (`backup.ts:287-339`) only counts D1 rows — it cannot assert DO/D1 stock parity. Restoring D1 leaves every DO holding pre-restore counters; the cleanup cron cannot reconcile orphaned reservations against stale DO state.
- **Evidence:** `grep -r restoreFromSnapshot src/` returns 0 source files (only docs); `cron-dispatch.ts:40-45` hourly job calls `reconcileInventory` and `cleanExpiredReservations` but no snapshot writer.
- **Recommended fix:** Add hourly cron writing `{variant_id, stock, reserved, sold, snapshot_id, captured_at}` to R2 `backups/do/…`; add `restoreFromSnapshot()` to `VariantInventoryDO` (gated by `DR_RESTORE_ENABLED`); extend the drill to assert per-variant `DO.reserved == SUM(active stock_reservations)`. [RECOMMEND ONLY]
- **Verification:** §37.0 #7 `dr-do-d1-parity`.
- **Blocks launch:** Yes

---

### FINDING-INV-5: Audit log stores raw PII; `customer_ref` HMAC absent (S-07)
- **Domain:** Privacy / compliance
- **File:line:** `db/migrations/0001_initial_v6_8a_schema.sql:266-277` (no `customer_ref` column); `src/lib/audit.ts:76-94` (writes raw `entity_id`); `grep AUDIT_CUSTOMER_REF_SALT wrangler.jsonc env.d.ts` = 0; no `trg_audit_log_no_update`/`trg_audit_log_no_delete` triggers anywhere
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-532 (sensitive info in log files), CWE-359 (private info exposure)
- **Master-plan ref:** §18.2 S-07 (`Part-1.md:2165`), §28.3 (`Part-2.md:151`), Guardrail #33
- **Description:** The 7-year append-only audit log holds raw customer identifiers (phone, email, order_id-with-PII-link), directly conflicting with the §28.3 deletion right. The salted-hash `customer_ref` and `AUDIT_CUSTOMER_REF_SALT` secret exist only in markdown. There are also no DB triggers enforcing append-only — the hash-chain is the only tamper-evidence, and `verifyAuditChain` is windowed to 1000/10000 rows (K-31).
- **Code excerpt:**
```ts
// src/lib/audit.ts:76-94 (excerpt)
return db.prepare(
  `INSERT INTO audit_log (
    id, actor_staff_id, actor_role, action, entity_type, entity_id,
    metadata_json, ip_address, user_agent, created_at, previous_hash, chain_hash
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
).bind(
  id, entry.actorStaffId, entry.actorRole, entry.action, entry.entityType,
  entry.entityId,           // ← raw caller-supplied value, no HMAC
  ...
);
```
```sql
-- 0001_initial_v6_8a_schema.sql:266-277
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_staff_id TEXT REFERENCES staff_users(id),
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata_json TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);                           -- ← no customer_ref; no triggers
```
- **Attack scenario:** Customer exercises the §28.3 deletion right; `/api/me/delete` anonymizes `orders.customer_phone` etc. but the audit_log rows still contain the raw phone. The platform cannot truthfully certify deletion to the Bangladesh privacy regulator. A leaked or subpoenaed audit log exposes 7 years of customer identity.
- **Evidence:** `grep customer_ref src/ db/` = 0 hits; `grep AUDIT_CUSTOMER_REF_SALT wrangler.jsonc` = 0.
- **Recommended fix:** Add `customer_ref` column + `AUDIT_CUSTOMER_REF_SALT` secret; in `prepareAuditLogInsert` hash any customer identifier into `customer_ref`, store only `order_id` + hash (never raw phone/email). Add `trg_audit_log_no_update`/`trg_audit_log_no_delete` triggers. Mark the salt NEVER-rotated in the rotation runbook. [RECOMMEND ONLY]
- **Verification:** §37.0 #21 `redaction` + grep proving no raw phone/email in audit writes.
- **Blocks launch:** Yes

---

### FINDING-INV-6: Reservation TTL 10 minutes, not 60 (F-02 / G50)
- **Domain:** Inventory
- **File:line:** `src/lib/reservation-ttl.ts:13` (`export const RESERVATION_TTL_MINUTES = 10;`)
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-697 (incorrect comparison), CWE-840
- **Master-plan ref:** §11 (`Part-1.md:83`, `:1557`), Guardrail #50 (`Part-2.md:316`)
- **Description:** V8 mandates `reservation_expires_at = created_at + 60 minutes`, strictly greater than the 30-minute payment window + 15-minute reconciliation. The code constant is 10 minutes — shorter than the payment window itself, so legitimate payments can be released mid-flight by the cleanup cron.
- **Evidence:** Direct read; constant consumed by `variant-inventory-do.ts` reservation expiry and cron sweeps.
- **Recommended fix:** `export const RESERVATION_TTL_MINUTES = 60;` and add a §37.0 #5 `reservation-window-outlasts-payment` test that asserts `reservation_expires_at > payment_window + reconcile_window`. [RECOMMEND ONLY]
- **Blocks launch:** Yes

---

### FINDING-INV-7: `stock_reservations` missing `checkout_id`; retired index present; no two partial uniques (RT-002)
- **Domain:** Inventory
- **File:line:** `db/migrations/0024_stock_reservations_unique_constraint.sql:11-13` (creates retired `idx_stock_reservations_order_active`); `0028_fix_stock_reservations_active_index_shape.sql:3-6` (drops + recreates the *same* retired name); `grep checkout_id db/migrations/` = 0
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-367 (TOCTOU), CWE-664 (insufficient structure)
- **Master-plan ref:** §43 (`Part-2.md:307`), §34.4 #6 (`Part-2.md:571`), RT-002, D-23, D-24
- **Description:** V8 mandates two partial unique indexes: `idx_stock_res_order_variant_active(order_id, variant_id) WHERE active` and `idx_stock_res_checkout_variant_active(checkout_id, variant_id) WHERE active`, plus a `checkout_id` column. The codebase ships one retired-name index and zero `checkout_id` column. Per-order reservation races are not prevented at the DB layer.
- **Evidence:** `0024` and `0028` are the only migrations touching reservation indexes; both use the retired name; `checkout_id` does not appear in any migration.
- **Recommended fix:** Add migration (renumbered `0048+`) dropping `idx_stock_reservations_order_active`, adding `checkout_id` column, and creating both partial uniques with the V8 names. Update D-23 in `audit-drift.ts` to *reject* the retired name. [RECOMMEND ONLY]
- **Verification:** D-23 check flipped; `PRAGMA index_list('stock_reservations')` shows both partials; the retired name returns 0 hits.
- **Blocks launch:** Yes

---

### FINDING-INV-8: `BudgetCounterDO` object ID `{provider}:{date}` not `budget:{provider}` (G49)
- **Domain:** AI budget enforcement
- **File:line:** `src/do/budget-counter-do.ts:330,338,346,354` (four `idFromName` calls)
- **Severity:** High → Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-664 (insufficient structure), CWE-770 (resource exhaustion — cap unenforceable)
- **Master-plan ref:** §6.6 (`Part-1.md:884`), §42 (`Part-2.md:307`), Guardrail #49 (`Part-2.md:315`), D-39
- **Description:** V8 mandates `budget:{provider}` — one object per provider holding both daily and monthly counters. The code uses `{provider}:{YYYY-MM-DD}` — a new object per provider per day. Monthly caps cannot be enforced because each day spins up a new object; the daily/monthly soft_alert/hard_block table is partially defeated.
- **Code excerpt:**
```ts
// src/do/budget-counter-do.ts:329-330
export async function canUseDeepSeekBudget(env: Env): Promise<boolean> {
  const id = env.AI_BUDGET.idFromName(`deepseek:${new Date().toISOString().slice(0, 10)}`);
```
- **Recommended fix:** Replace all four sites with `env.AI_BUDGET.idFromName(\`budget:${provider}\`)`; consolidate daily + monthly counters inside the single object. [RECOMMEND ONLY]
- **Verification:** §37.0 #19 `budget-counter-id-format`.
- **Blocks launch:** Yes (cost-control bypass)

---

### FINDING-INV-9: Order state machine is V7 (missing `created` / `confirmed` / `processing`)
- **Domain:** Orders
- **File:line:** `src/lib/order-state-machine.ts:13`; schema `0013:57`
- **Severity:** High
- **Confidence:** CONFIRMED
- **CWE:** CWE-840
- **Master-plan ref:** V8 order state machine (conflict C7 in prior truth sheet)
- **Description:** The state machine does not include V8's `created` / `confirmed` / `processing` states, so auto-confirm is unreachable and `confirmReservationsForOrder` is invoked from `staff_confirmed` instead of from the canonical entry. `confirm.ts` (K-37) bypasses `canTransition` entirely.
- **Recommended fix:** Rebuild the state machine per V8 spec; migrate existing `orders.status` values to the V8 vocabulary in a renumbered migration. [RECOMMEND ONLY]
- **Blocks launch:** Yes

---

### FINDING-INV-10: VAT from `VAT_RATE_PERCENT` env, not D1 `tax_rates` (G41)
- **Domain:** Compliance
- **File:line:** `src/pages/api/checkout.ts:252`; `src/pages/api/buy-now/submit.ts:217`; `src/pages/api/staff/orders/create.ts:133`; `src/pages/api/staff/invoices/index.ts:148`; `src/env.d.ts:58`; `scripts/audit/audit-drift.ts:269` (D-19 enforces the wrong thing)
- **Severity:** High (compliance)
- **Confidence:** CONFIRMED
- **CWE:** CWE-840
- **Master-plan ref:** §11.7 (`Part-1.md:1567`), Guardrail #41 (`Part-2.md:303`), D-19
- **Description:** V8 retires `VAT_RATE_PERCENT`; VAT must come from D1 `tax_rates`. Four runtime call sites still read the env var, the `tax_rates` table does not exist in any migration, and `audit-drift.ts:269-272` D-19 *inverts* the rule (passes when `VAT_RATE_PERCENT` is present).
- **Recommended fix:** Create `tax_rates` table + seed; replace all four call sites with a D1 lookup; flip D-19 to *reject* `VAT_RATE_PERCENT`. [RECOMMEND ONLY]
- **Verification:** §37.0 #18 `vat-discount-rounding`.
- **Blocks launch:** Yes (Mushak)

---

### 5.B Critical — re-verified K-findings

> Each K-finding was re-read at HEAD on 2026-08-09. Full table in §5.D; the Critical ones get full writeups here.

### FINDING-K-01: Webhook IPN API-key check fail-open
- **Domain:** Payments
- **File:line:** `src/pages/api/payments/webhook.ts:29-32`
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-287 (improper authentication), CWE-1188 (insecure default)
- **Master-plan ref:** §11.5, PAY-004
- **Description:** The IPN API-key check requires *both* the header and the env var to be truthy before comparing. Omitting the header bypasses the check.
- **Code excerpt:**
```ts
const ipnKey = context.request.headers.get('RT-UDDOKTAPAY-API-KEY');
if (ipnKey && env.UDDOKTAPAY_API_KEY && !timingSafeEqualHex(ipnKey, env.UDDOKTAPAY_API_KEY)) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
```
- **Attack scenario:** See AT-2.
- **Recommended fix:** Make the check unconditional when the env var is set: `if (!env.UDDOKTAPAY_API_KEY) return 500; if (!ipnKey || !timingSafeEqualHex(ipnKey, env.UDDOKTAPAY_API_KEY)) return 401;`. [RECOMMEND ONLY]
- **Blocks launch:** Yes

### FINDING-K-02: Generic `Signature` / `X-Signature` header fallbacks (PAY-003)
- **Domain:** Payments
- **File:line:** `src/lib/payment-webhook-ingress.ts:24-31`
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-347 (improper signature verification)
- **Master-plan ref:** PAY-003
- **Description:** Signature header list is open — accepts `X-UddoktaPay-Signature` || `X-Signature` || `Signature`. The latter two are generic and can be set by intermediate proxies or attacker-controlled clients.
- **Recommended fix:** Closed list: `X-UddoktaPay-Signature` only. [RECOMMEND ONLY]
- **Blocks launch:** Yes

### FINDING-K-03: Client `Idempotency-Key` becomes `payments.id` PK
- **Domain:** Payments
- **File:line:** `src/pages/api/payments/create.ts:18,66,87-90`
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-639 (IDOR)
- **Description:** `const paymentId = idempotencyKey || crypto.randomUUID();` — a fully client-controlled string becomes the PK. No format validation, no HMAC, no server prefix. A client can choose any string, including one colliding with another order's payment id (then poll K-04 to read it).
- **Recommended fix:** Always generate the PK server-side: `const paymentId = crypto.randomUUID();`. Use the `Idempotency-Key` only as a separate column with `UNIQUE(order_id, idempotency_key)`. [RECOMMEND ONLY]
- **Blocks launch:** Yes

### FINDING-K-04: GET `/api/payments/status/[id]` unauthenticated
- **Domain:** Payments
- **File:line:** `src/pages/api/payments/status/[id].ts:8-26`
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-306 (missing authentication), CWE-639 (IDOR)
- **Description:** No auth, no ownership check. Any caller who knows/guesses a `payments.id` (which K-03 makes attacker-chosen) gets the row — `order_id`, `invoice_id`, `amount_paisa`, `status`, timestamps.
- **Recommended fix:** Require phone-OTP bearer token; join `payments → orders` and verify the token's phone matches `orders.customer_phone`. [RECOMMEND ONLY]
- **Blocks launch:** Yes

### FINDING-K-09: `advance_paisa` set in separate UPDATE — zero-paisa race
- **Domain:** Payments
- **File:line:** `src/pages/api/checkout.ts:354-376`; mirrored `src/pages/api/buy-now/submit.ts:322-324`
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-362 (race), CWE-840
- **Master-plan ref:** RV8-009, §11.4
- **Description:** Order is INSERTed without `advance_paisa`; a separate UPDATE sets it afterward. Between the two statements `advance_paisa` is `0`. A payment-create racing in the window reads `advance_paisa=0`.
- **Code excerpt:**
```ts
// checkout.ts:354-367  INSERT (no advance_paisa in params)
const { orderId, orderNumber } = await insertReservedOrderWithRetry(env.DB, {
  phone: phoneResult.phone, ... total_paisa: totalPaisa, payment_method: paymentMethod, fraud_decision: fraudDecision,
}, orderItems, now);
// checkout.ts:374-376  separate UPDATE
await env.DB.prepare(
  `UPDATE orders SET advance_paisa = ?2, balance_paisa = ?3, updated_at = ?4 WHERE id = ?1`,
).bind(orderId, advancePaisa, balancePaisa, now).run();
```
- **Attack scenario:** See AT-1.
- **Recommended fix:** Add `advance_paisa`, `balance_paisa` to the INSERT column list in `insertReservedOrderWithRetry`; remove the separate UPDATE. [RECOMMEND ONLY]
- **Blocks launch:** Yes

### FINDING-K-14: DirectCheckout binding accepts empty binding secret
- **Domain:** Buy Now
- **File:line:** `src/do/direct-checkout-session-do.ts:87,219-225`; `src/pages/api/buy-now/submit.ts:77,80`
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-287, CWE-1188
- **Master-plan ref:** §8 (DirectCheckoutSessionDO), RT-005
- **Description:** Empty binding secret produces deterministic `sha256('')`. Verification matches any empty secret presented. D1 fallback matches `bindingHash IS NULL`.
- **Recommended fix:** Reject empty `bindingSecret` at session create; reject `bindingHash === sha256('')` at verify; require server-generated random secret returned to client. [RECOMMEND ONLY]
- **Blocks launch:** Yes

### FINDING-K-19: Turnstile bypassable via any `totp_code`
- **Domain:** Auth
- **File:line:** `src/pages/api/staff/login.ts:64`
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-287, CWE-807 (reliance on untrusted input)
- **Description:** `if (env.TURNSTILE_SECRET_KEY && !body.totp_code)` skips Turnstile when any `totp_code` is sent, regardless of whether the account has TOTP enabled.
- **Recommended fix:** Decouple: Turnstile unconditional when secret set; validate TOTP independently in the second factor block. [RECOMMEND ONLY]
- **Attack scenario:** See AT-5.
- **Blocks launch:** Yes

### FINDING-K-22: TOTP verify trusts client `body.secret`
- **Domain:** Auth
- **File:line:** `src/pages/api/staff/totp/verify.ts:24,26,29`
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **CWE:** CWE-345 (insufficient verification of data authenticity), CWE-287
- **Description:** `verifyTotpCode(body.secret, body.code)` and `storeStaffTotpSecret(env.DB, user.id, body.secret, env)` — the secret passed to verify and persisted is the client-supplied value, not the server-generated one from `setup.ts:22`.
- **Attack scenario:** See AT-4.
- **Recommended fix:** Store the server-generated pending secret at setup (D1 `otp_secrets.pending_secret_cipher`); verify against that; ignore `body.secret`. [RECOMMEND ONLY]
- **Blocks launch:** Yes

### FINDING-K-32: InvoiceCounterDO dead code → see FINDING-INV-3

---

### 5.C High — re-verified K-findings (full table in §5.D)

The full High-severity list (each re-verified CONFIRMED at HEAD): K-05 (`webhook.ts:55-63` `void work` no-retry), K-06 (`payment-webhook-ingress.ts:44-53` event-id fallback), K-07 (`payments.ts:154-157` conditional order_id check), K-11 (`validate-coupon.ts:12,43,55-62` trusts client subtotal + leaks coupon params), K-12 (`buy-now/submit.ts:145-148` body.variant_id overrides session, mitigated by product-scope check), K-13 (`checkout.ts:383-393` + `buy-now/submit.ts:350-351` open redirect via Origin), K-15 (`fraud.ts:18-22,80-82` circuit-open → score 50 → review → allow), K-16 (`fraud/override.ts:22-26` step-up present but no cooldown/RL), K-18 (`checkout.ts:88-93` body session_id overrides cookie), K-20 (`session-blacklist.ts` + `login.ts:193` + `rbac.ts:218` three divergent KV prefixes; blacklist never read on auth path), K-21 (`reset-password.ts:65-67` sibling tokens not invalidated), K-23 (`totp/disable.ts:7-15` no step-up), K-24 (11 sensitive handlers lack `requireRecentStaffSession`), K-25 (`password.ts:19-22` PBKDF2 100k iterations), K-33 (`returns/[id]/approve.ts:135-153,182-188` restock before refund; not reversed), K-34 (`courier.ts:86` body.mock in prod), K-43 (`consumers.ts:236-244` order email not idempotent).

---

### 5.D NEW findings (this audit)

### FINDING-N-1: 8 Durable Objects declared, V8 mandates 7
- **Domain:** Platform
- **File:line:** `wrangler.jsonc:84-95` (8 bindings); V8 §6.6 (`Part-1.md:880-886`) mandates 7
- **Severity:** Medium
- **Confidence:** CONFIRMED
- **CWE:** CWE-664
- **Description:** `WafRules` is declared and exported but is not in the V8 DO catalog. Either the plan should be amended to add it (with a Guardrail #) or it should be removed/migrated to a non-DO implementation. Unspecified DOs are a maintenance and DR liability.
- **Recommended fix:** Owner decision: amend V8 §6.6 + add Guardrail, or remove. [RECOMMEND ONLY]

### FINDING-N-2: 6 of 8 DOs use raw unprefixed object IDs
- **Domain:** Platform / DR
- **File:line:** See §2.2 table
- **Severity:** Medium
- **Confidence:** CONFIRMED
- **CWE:** CWE-664
- **Description:** V8 specifies `variant:{id}`, `cart:{id}`, `buy:{id}`, `idem:{scope}:{id}`, `budget:{provider}`, `provider:{name}` prefixes. Six bindings use raw `idFromName(value)`. Flat namespace → cross-type collision risk; fixing later requires a data migration across object space.
- **Recommended fix:** Add prefixes; add a migration tag that aliases old IDs to new for a transition period. [RECOMMEND ONLY]

### FINDING-N-3 / N-4 / N-5: audit-drift.ts misalignment
- **Files:** `scripts/audit/audit-drift.ts:472` (asserts 44, not 46); `:269-272` (D-19 inverted); `:289-292` (D-23 inverted); D-45 and D-46 absent
- **Severity:** High (audit assurance)
- **Confidence:** CONFIRMED
- **Master-plan ref:** §38.4 (`Part-2.md:2105`), ADR-0001
- **Description:** The merge gate is enforcing V7. A green run gives false confidence. ADR-0001 is `Proposed`, not `Accepted`.
- **Recommended fix:** Land ADR-0001 option C (full realignment to §38.2). [RECOMMEND ONLY]
- **Blocks launch:** Yes (audit theatre)

### FINDING-N-6: KV session-cache read is dead code
- **Domain:** Auth / performance
- **File:line:** `src/lib/rbac.ts:216-220`
- **Severity:** Low (perf), Medium (architectural)
- **Confidence:** CONFIRMED
- **Description:** `sessionKV.get(...)` is neither awaited nor assigned — the result is discarded. Auth always falls through to the D1 query. The KV cache write (`:326-332`) is also fire-and-forget with `.catch(() => {})`.
- **Recommended fix:** Either `await` and use the value, or remove the dead read. [RECOMMEND ONLY]

### FINDING-N-7: Three divergent KV blacklist key prefixes
- **Domain:** Auth
- **File:line:** `src/lib/session-blacklist.ts:15` (`session-blacklist:`); `src/pages/api/staff/login.ts:193` (`session:blacklist:`); `src/lib/rbac.ts:218` (`staff-session:`)
- **Severity:** High
- **Confidence:** CONFIRMED
- **Master-plan ref:** K-20 expansion
- **Description:** Three incompatible revocation key schemes coexist. Worse, `requireAuth`/`getCurrentStaffUser` never call `isSessionRevoked` — the blacklist is written but not consulted on the auth path. Revocation falls back to D1 `staff_sessions.is_revoked`, which is correct but renders the KV layer entirely vestigial.
- **Recommended fix:** Pick one prefix; call `isSessionRevoked` in `getCurrentStaffUser`; or delete the KV layer. [RECOMMEND ONLY]

### FINDING-N-8: `super_admin` short-circuits all permission checks
- **Domain:** RBAC
- **File:line:** `src/lib/rbac.ts:186-189` (`if (SUPER_ADMIN_ONLY.has(role)) return true;`)
- **Severity:** Medium
- **Confidence:** CONFIRMED
- **CWE:** CWE-269 (improper privilege management)
- **Description:** `can()` returns `true` for every permission when role is in `SUPER_ADMIN_ONLY`, including platform perms. A compromised super_admin session has unrestricted access including `settings.platform.update`, `cache.purge`, `api_keys.*`.
- **Recommended fix:** Keep super_admin broad but exclude destructive platform perms (or require two-person rule). [RECOMMEND ONLY]

### FINDING-N-9: `getRequiredStaffPermission` falls through to `orders.update`/`orders.view`
- **Domain:** RBAC
- **File:line:** `src/lib/staff-route-rbac.ts:51` (`return isMut ? 'orders.update' : 'orders.view';`)
- **Severity:** Medium
- **Confidence:** CONFIRMED
- **CWE:** CWE-285 (improper authorization)
- **Description:** Any unmapped staff path gets `orders.update` (POST) or `orders.view` (GET) as the required permission. A new sensitive route that forgets to register will default to a too-loose permission. Also `p.includes('/totp/')` returns `null` (no permission) for *all* TOTP routes including `disable` (consistent with K-23).
- **Recommended fix:** Default-deny: unmapped paths return `null` for GET and a sentinel `__UNMAPPED__` that fails-closed for mutations. [RECOMMEND ONLY]

### FINDING-N-10: Step-up TTL 10 min (plan target ≤5 min) + opt-in per-handler
- **Domain:** Auth
- **File:line:** `src/lib/critical-auth.ts:18` (`STEP_UP_WINDOW_SECONDS = 10 * 60`); `src/lib/staff-route-rbac.ts` (no step-up registry)
- **Severity:** Medium
- **Confidence:** CONFIRMED
- **Description:** The prompt's §10 spec targets `TTL<=5min, scoped`. Code ships 10 minutes. Step-up is also opt-in per-handler (`requireRecentStaffSession` is called manually) — there is no central sensitive-route registry, so coverage is patchy (K-24).
- **Recommended fix:** Reduce TTL to 5 min; introduce a `SENSITIVE_ROUTES` registry consumed by middleware. [RECOMMEND ONLY]

### FINDING-N-11: `/api/me/delete` does not anonymize `audit_log`
- **Domain:** Privacy / compliance
- **File:line:** `src/pages/api/me/delete.ts:32-35` (touches only `orders`, `cart_activity`)
- **Severity:** High (compliance)
- **Confidence:** CONFIRMED
- **Master-plan ref:** §28.3 (`Part-2.md:148-153`)
- **Description:** The deletion batch anonymizes orders and cart_activity but leaves `audit_log.entity_id` (raw PII per INV-5) untouched. The §28.3 promise that "anonymizing the customer row is sufficient" is therefore unsatisfiable. Combined with INV-5, the platform cannot certify deletion.
- **Recommended fix:** Land INV-5 first (`customer_ref` HMAC), then `/api/me/delete` is sufficient by construction. [RECOMMEND ONLY]

### FINDING-N-12: `/api/me/delete` runs immediately, not in 30-day window
- **Domain:** Privacy / compliance
- **File:line:** `src/pages/api/me/delete.ts` (entire flow)
- **Severity:** Medium
- **Confidence:** CONFIRMED
- **Master-plan ref:** §28.3 (`Part-2.md:150`)
- **Description:** Plan states "Deletion request processing window: 30 days." The endpoint anonymizes immediately on request. No fraud/chargeback cool-down.
- **Recommended fix:** Either amend the plan to allow immediate anonymization, or queue the anonymization for 30 days out. [RECOMMEND ONLY]

### FINDING-N-13: CSP `style-src 'unsafe-inline'` shipped in production
- **Domain:** Security headers
- **File:line:** `src/lib/security/csp.ts:9,35`
- **Severity:** Medium
- **Confidence:** CONFIRMED
- **CWE:** CWE-79 (XSS — weakened mitigation)
- **Description:** Both `generatePublicCSP` and `generateStaffCSP` hardcode `style-src 'self' 'unsafe-inline'` unconditionally. The plan's CSP rule (`'unsafe-inline'` forbidden) is partially violated — `script-src` is correct (nonce + strict-dynamic + hashes), but style injection remains a marker for XSS exfiltration.
- **Recommended fix:** Hash critical inline styles; drop `'unsafe-inline'` from style-src. [RECOMMEND ONLY]

### FINDING-N-14: CSP script hashes are build-time only, not runtime verified
- **Domain:** Security headers
- **File:line:** `src/lib/csp-hashes.ts:13-17`; `scripts/csp-hashes-plugin.mjs` (build-time)
- **Severity:** Low
- **Confidence:** CONFIRMED
- **Description:** Hashes are computed by `csp-hashes-plugin.mjs` at build time and imported from `src/generated/csp-hashes.ts`. There is no runtime re-hashing of served scripts against the list. A supply-chain attack that swaps a script between build and runtime would not be detected. The per-request nonce is the live control.
- **Recommended fix:** Add a runtime canary that hashes one served script per deploy and alerts on mismatch. [RECOMMEND ONLY]

### FINDING-N-15: No courier inbound webhook endpoint
- **Domain:** Integrations
- **File:line:** glob `/api/courier/` = 0 hits; courier clients implement only outbound operations (`courier/types.ts:72-76`)
- **Severity:** Medium
- **Confidence:** CONFIRMED
- **Master-plan ref:** K-35 expansion
- **Description:** There is no `/api/courier/[provider]/webhook` route and no signature verification on inbound courier messages. Delivery status is never pushed back — the order stays `shipped` until manually changed. This is both an operational gap (no auto-delivery confirmation) and a security gap (when such a webhook is added without HMAC, forged delivery callbacks become possible — K-35 foresight).
- **Recommended fix:** When adding courier webhooks, include HMAC + replay guard from day one. [RECOMMEND ONLY]

### FINDING-N-16: `payment_events` dedup constraint is wrong shape
- **Domain:** Payments
- **File:line:** `db/migrations/0001_initial_v6_8a_schema.sql:239` (`UNIQUE(invoice_id, event_type, status)`)
- **Severity:** Critical
- **Confidence:** CONFIRMED
- **Master-plan ref:** §32 (`Part-2.md:296`), §46 (`Part-2.md:311`), D-40
- **Description:** V8 mandates `UNIQUE(provider, provider_event_id)`. The shipped constraint collapses on `(invoice_id, event_type, status)` triples — which are the same for every webhook on the same invoice. This is partially protective but does not survive a body tweak that changes the event-id hash fallback.
- **Recommended fix:** Part of INV-2 migration. [RECOMMEND ONLY]
- **Blocks launch:** Yes

### FINDING-N-17: Raw `console.error(err)` not routed through `safeLog`
- **Domain:** Logging / PII
- **File:line:** `src/layouts/RootLayout.astro:195`; also `src/islands/BuyNowButton.tsx:64,68` (client-side); `src/pages/staff/roles/index.astro:43` (client-side)
- **Severity:** Low
- **Confidence:** CONFIRMED
- **CWE:** CWE-532
- **Description:** `safeLog` is the sanctioned logger but is unenforced. `RootLayout.astro:195` logs a raw `err` object without scrubbing. Client-side islands log to the browser console (lower severity). No ESLint rule bans raw `console.*`.
- **Recommended fix:** Add ESLint rule `no-console` outside `src/lib/pii-scrubber.ts`; route `RootLayout.astro` error through `safeLog`. [RECOMMEND ONLY]

### FINDING-N-18: `assets.run_worker_first` excludes customer routes
- **Domain:** Platform
- **File:line:** `wrangler.jsonc:15` (`run_worker_first: ["/staff/*", "/api/*"]`)
- **Severity:** Low
- **Confidence:** CONFIRMED
- **Description:** Only `/staff/*` and `/api/*` are routed through the Worker first. Customer `.astro` pages can be served directly from the asset bundle. This is reasonable for perf but means a static asset shadowing a future customer route could bypass middleware (CSRF, rate-limit, RBAC all run in middleware). No current exploitation observed.
- **Recommended fix:** Document the exclusion contract; ensure no customer `.astro` route is ever shadowed by a same-path static asset. [RECOMMEND ONLY]

### FINDING-N-19: Migration head conflict blocks V8 schema
- **Domain:** Migrations
- **File:line:** `db/migrations/` head = `0047_create_goods_receipts.sql`; V8 plan head = `0039`
- **Severity:** High (release planning)
- **Confidence:** CONFIRMED
- **Master-plan ref:** §48 (`Part-2.md:315`), Guardrail #48
- **Description:** Repo migrations `0040-0047` occupy the V8 plan's reserved range. V8 schema work (payment_transactions, customer_ref, checkout_id, tax_rates, DO snapshot) cannot land at the planned numbers and must renumber to `0048+`. Until resolved, every INV finding is structurally blocked.
- **Recommended fix:** Owner decision: renumber V8 schema migrations to `0048+` and update the V8_MIGRATION_PLAN. [RECOMMEND ONLY]
- **Blocks launch:** Yes (structural — blocks all INV fixes)

### FINDING-N-20: Three queues have no DLQ
- **Domain:** Queues
- **File:line:** `wrangler.jsonc:131,132,135` (`order-emails`, `image-processing`, `cart-activity`)
- **Severity:** Medium
- **Confidence:** CONFIRMED
- **Master-plan ref:** §6.7 (`Part-1.md:896-902`)
- **Description:** Three queues lack a `dead_letter_queue` target. Exhausted-retry messages are silently dropped. K-42 covers the other half (declared DLQs have no consumer).
- **Recommended fix:** Add DLQs for all three; wire DLQ consumers + drainers + alerts. [RECOMMEND ONLY]

### FINDING-N-21: V8 mandates 31 mandatory tests, prompt said 30
- **Domain:** Tests
- **File:line:** `Part-2.md:1693-1729` (31 tests listed); prompt §1.3 says "30 mandatory tests"
- **Severity:** Documentation drift
- **Confidence:** CONFIRMED
- **Description:** The plan lists 31 tests in §37.0, not 30. Of these 31, only 1 exists by canonical name (`cart-do-alarm-handoff`). The prompt's KPI count is also off by one.
- **Recommended fix:** Update the audit prompt; write the missing 30 tests. [RECOMMEND ONLY]

### FINDING-N-22: `validate-coupon` lacks step-up + rate-limit (expansion of K-10)
- **Domain:** Fraud
- **File:line:** `src/pages/api/checkout/validate-coupon.ts` (entire 66-line file)
- **Severity:** High
- **Confidence:** CONFIRMED
- **Description:** Already K-10 (no rate limit) and K-11 (client subtotal trust). Combined attack: brute-force coupon codes with crafted `subtotalPaisa` values to enumerate valid coupons and their discount curves. Response leaks `discountType`, `discountAmountPaisa`, `discountPercent`.
- **Recommended fix:** Rate-limit by IP + cart sid; recompute subtotal server-side from cart contents; return only `discountPaisa`. [RECOMMEND ONLY]

### FINDING-N-23: `cart` cookie is `SameSite=Lax` not `Strict`
- **Domain:** Cart
- **File:line:** `src/pages/api/cart/index.ts:20-26` (`SameSite=Lax`)
- **Severity:** Low
- **Confidence:** CONFIRMED
- **Description:** CSRF cookies are `SameSite=Strict`; cart sid is `Lax`. A cross-site top-level navigation can carry the cart cookie — combined with K-18 (body session_id override) and K-39 (sid leak), the attack surface widens.
- **Recommended fix:** `SameSite=Strict` (or `Lax` + HMAC sign the sid). [RECOMMEND ONLY]

### FINDING-N-24: `analytics/vitals` has no rate-limit
- **Domain:** DoS / observability
- **File:line:** `src/pages/api/analytics/vitals.ts` (entire 23-line file)
- **Severity:** Low
- **Confidence:** CONFIRMED
- **Description:** Unauthenticated POST writes to Analytics Engine. No rate-limit. A malicious client can pollute the `web_vital` dataset with garbage strings; Analytics Engine ingestion is not free.
- **Recommended fix:** Add middleware rate-limit; validate `name`/`rating` against an allowlist. [RECOMMEND ONLY]

### FINDING-N-25: `EMAIL_TEMPLATES` bucket name mismatches V8 §6.5
- **Domain:** Config
- **File:line:** `wrangler.jsonc:62` (`zabir-email-templates-prod`)
- **Severity:** Low
- **Confidence:** CONFIRMED
- **Description:** V8 §6.5 names the bucket bare `zabir-email-templates`. The prod binding has a `-prod` suffix. Staging/dev variants use the consistent `-staging`/`-dev` pattern; prod breaks the convention.
- **Recommended fix:** Align on one convention (either bare prod + suffixed non-prod, or suffixed everywhere). [RECOMMEND ONLY]

### FINDING-N-26: No concurrent-execution protection on cron jobs
- **Domain:** Cron
- **File:line:** `src/lib/cron-dispatch.ts` (no DO lock or `IF NOT EXISTS` claim observed)
- **Severity:** Low
- **Confidence:** NEEDS-VERIFICATION
- **Description:** Cloudflare can in rare cases invoke `scheduled` concurrently. Without a claim lock, two concurrent partial-prepay sweeps or two abandoned-cart scans could double-process. V8 §16 mandates DO-lock or DB-claim protection.
- **Recommended fix:** Wrap each cron handler in a `CronLockDO` claim or `INSERT INTO cron_claims ... IF NOT EXISTS`. [RECOMMEND ONLY]

> New-finding tally: **26** (N-1..N-26), exceeding the prompt's 10-new-finding minimum. The codebase was additionally reviewed for: GraphQL/gRPC exposure (none), file-upload path traversal (uploads.ts uses `crypto.randomUUID` filenames — OK), SQL injection (all queries parameterized — OK), mass-assignment (zod/strict absent per §3 but routes construct explicit INSERTs — OK), dependency audit (`npm audit` not run per read-only constraint — recommend owner runs `npm audit --audit-level=high`).

---

### 5.E Re-verification tally for K-01..K-45

| ID | Sev | Status | file:line (HEAD) | One-line |
|---|---|---|---|---|
| K-01 | Crit | CONFIRMED | `webhook.ts:29-32` | IPN-key check fail-open |
| K-02 | Crit | CONFIRMED | `payment-webhook-ingress.ts:24-31` | Generic `Signature` fallback |
| K-03 | Crit | CONFIRMED | `payments/create.ts:18,66` | Client Idempotency-Key as payments.id PK |
| K-04 | Crit | CONFIRMED | `payments/status/[id].ts:8-26` | Unauthenticated payment leak |
| K-05 | High | CONFIRMED | `webhook.ts:55-63` | `void work;` no-retry fallback |
| K-06 | High | CONFIRMED | `payment-webhook-ingress.ts:44-53` | Event-id fallback `sha256(rawBody)` |
| K-07 | High | CONFIRMED | `payments.ts:154-157` | order_id check conditional on metadata presence |
| K-08 | Med | **PARTIAL-REFUTE** | `payments.ts:203-240`; `reservation-ttl.ts:13`; `cron-dispatch.ts:29-32` | Reservation is TTL-bounded (10 min) + swept every 5 min — not indefinite. Real defect is the TTL being 10 min (INV-6) and the checkout/buy-now asymmetry on payment-create failure (`checkout.ts:401-403` non-fatal vs `buy-now/submit.ts:367-375` cancels). |
| K-09 | Crit | CONFIRMED | `checkout.ts:354-376`; `buy-now/submit.ts:322-324` | advance_paisa separate UPDATE |
| K-10 | High | CONFIRMED | `coupon-rate-limit.ts` (dead); `validate-coupon.ts` | No RL on validate-coupon |
| K-11 | High | CONFIRMED | `validate-coupon.ts:12,43,55-62` | Client subtotal trusted + coupon params leaked |
| K-12 | Med | CONFIRMED (mitigated) | `buy-now/submit.ts:145-158` | body.variant_id overrides session, scoped to same product |
| K-13 | High | CONFIRMED | `checkout.ts:383-393`; `buy-now/submit.ts:350-351` | Open redirect via Origin |
| K-14 | Crit | CONFIRMED | `direct-checkout-session-do.ts:87,219-225`; `buy-now/submit.ts:77,80` | Empty binding secret |
| K-15 | High | CONFIRMED | `fraud.ts:18-22,80-82` | Circuit-open → 50 → review → allow |
| K-16 | High | CONFIRMED (partial) | `fraud/override.ts:22-26` | Step-up present; no cooldown/RL |
| K-17 | Med | CONFIRMED | `cod-limits.ts:66-72`; `checkout.ts:282`; `buy-now/submit.ts:231` | COD address weak normalization |
| K-18 | High | CONFIRMED | `checkout.ts:88-93` | body session_id overrides cookie |
| K-19 | Crit | CONFIRMED | `login.ts:64` | Turnstile bypass via any totp_code |
| K-20 | High | CONFIRMED | `session-blacklist.ts:15,45-47`; `login.ts:193`; `rbac.ts:218` | 3 KV prefixes; blacklist not read |
| K-21 | High | CONFIRMED | `reset-password.ts:65-67` | Sibling tokens not invalidated |
| K-22 | Crit | CONFIRMED | `totp/verify.ts:24,26,29` | body.secret trusted |
| K-23 | High | CONFIRMED | `totp/disable.ts:7-15` | No step-up |
| K-24 | High | CONFIRMED | 11 handlers listed in §5.B | Sensitive ops lack step-up |
| K-25 | High | CONFIRMED | `password.ts:19-22` | PBKDF2 100k iterations |
| K-26 | Med | CONFIRMED | `login-rate-limit.ts:40` | Fails open when KV missing |
| K-27 | Med | CONFIRMED | `middleware.ts:120`; `audit.ts:18-19`; `api-keys.ts:89` | X-Forwarded-For fallback trusted |
| K-28 | Med | CONFIRMED | `totp.ts` (no replay); `otp-secrets.ts:6,100` (`EMPTY_BACKUP_HASH='none'`) | No replay protection; backup codes 'none' |
| K-29 | Med | CONFIRMED | `csrf.ts:31`; `phone-verification.ts:161-162,217-218`; `audit.ts:121,139`; `maintenance/backup.ts:330`; `login.ts:122`; `step-up.ts:54` | Non-CT compares on secrets/hashes |
| K-30 | Med | CONFIRMED | `pii-scrubber.ts:9-23` | PII_KEYS missing NID/passport/postal/name/dob |
| K-31 | Med | CONFIRMED | `audit.ts:104,160` | Chain verify windowed 1000/10000 |
| K-32 | Crit | CONFIRMED (= INV-3) | `invoices.ts:280` | InvoiceCounterDO dead |
| K-33 | High | CONFIRMED | `returns/[id]/approve.ts:135-153,159-165,182-188,195-201` | Restock before refund; not reversed |
| K-34 | High | CONFIRMED | `courier.ts:86` | body.mock in prod |
| K-35 | Med | CONFIRMED (= N-15) | n/a | No courier webhook sig |
| K-36 | Med | CONFIRMED | `csrf-rotation.ts:7-9,28-39` | Placeholder no-op |
| K-37 | Med | CONFIRMED | `confirm.ts:76-96` | Bypasses canTransition |
| K-38 | Med | CONFIRMED | n/a | No cancel/refund order API route |
| K-39 | Med | CONFIRMED | `consumers.ts:148-153` | session_id in URL query |
| K-40 | Med | CONFIRMED | `cart/index.ts:115-117`; `do-client.ts:415` | Raw UUID cookie; doMergeCart dead |
| K-41 | High (test integrity) | CONFIRMED | `race-conditions.test.ts:4-21,34-44` | Fake sequential JS |
| K-42 | Med | CONFIRMED | `wrangler.jsonc:129-136` | 3 DLQs declared, 0 consumers; 3 queues no DLQ |
| K-43 | Low | CONFIRMED | `consumers.ts:236-244` | Order email not idempotent |
| K-44 | Med | CONFIRMED | `do-client.ts:153-167` | doAdjustStock D1 fallback TOCTOU |
| K-45 | Med (test integrity) | CONFIRMED | `paid-expired-reservation.test.ts:9-54` | Hand-rolled Map |

**Tally:** of 45 seeded findings — **44 CONFIRMED**, **1 PARTIAL-REFUTE** (K-08 — bounded by TTL, not indefinite; underlying defect reassigned to INV-6), **0 REFUTED**. Prior reverify's "1 REFUTED (K-13b)" was a sub-finding; K-13 main (Origin open-redirect) is CONFIRMED.

---

## 6. Invariant Violations (Master-Plan falsified claims)

| Invariant | V8 source | Falsified by | Test that should catch it |
|---|---|---|---|
| `stock` invariant under `confirm()` | §11.3 (`Part-1.md:1468-1477`) | INV-1 (`variant-inventory-do.ts:190`; `inventory.ts:366`) | §37.0 #1 `reservation-oversell-concurrency` (missing) |
| Settled-money ledger exists | §11.5 step 7 (`Part-1.md:1536`) | INV-2 (`payment_transactions` absent) | §37.0 #14 `payment-webhook-replay` (missing) |
| InvoiceCounterDO issues serials | §15.5 (`Part-1.md:1914`) | INV-3 (DO uncalled; `SELECT MAX+1`) | §37.0 #12 `pos-invoice-number-concurrency` (missing) |
| DO snapshot + restore | §27.2/27.3 (`Part-2.md:87,102`) | INV-4 (absent) | §37.0 #7 `dr-do-d1-parity` (missing) |
| audit_log uses HMAC customer_ref | §18.2 S-07 (`Part-1.md:2165`) | INV-5 (raw entity_id) | §37.0 #21 `redaction` (missing) |
| Reservation TTL = 60 min | §11 (`Part-1.md:83,1557`) | INV-6 (`reservation-ttl.ts:13` = 10) | §37.0 #5 `reservation-window-outlasts-payment` (missing) |
| Two partial unique reservation indexes + checkout_id | §43 (`Part-2.md:307`) | INV-7 (retired name only; no checkout_id) | implicit in D-23 (inverted) |
| `budget:{provider}` object ID | §6.6/§49 (`Part-1.md:884`, `Part-2.md:315`) | INV-8 (`{provider}:{date}` at 4 sites) | §37.0 #19 `budget-counter-id-format` (missing) |
| Order state machine V8 | §13 | INV-9 (V7 states only) | n/a |
| VAT from D1 `tax_rates` | §11.7/§41 (`Part-1.md:1567`, `Part-2.md:303`) | INV-10 (`VAT_RATE_PERCENT` env at 4 sites) | §37.0 #18 `vat-discount-rounding` (missing) |

**10 of ~19 invariants falsified.** All 10 are launch blockers.

---

## 7. Test Coverage Gaps

Of the **31 mandatory tests** in §37.0, only **1 exists by canonical name**: `cart-do-alarm-handoff.test.ts` (added in commit `7bee2c6`). The other 30 are missing. Two tests that *do* exist under other names are fake:

- `race-conditions.test.ts:4-44` — mock DB factory whose `.run()` is hardcoded to `{changes:1}`; the concurrency test uses plain JS closure counters (`successes++`) and cannot fail. **K-41.**
- `paid-expired-reservation.test.ts:9-54` — in-memory `Record<string, {...}>` arithmetic; asserts a JS ternary. **K-45.**

**Missing-test priority list (P0 first):**

1. `reservation-oversell-concurrency.test.ts` — real D1 + real `reserveVariants` (P0)
2. `payment-webhook-replay.test.ts` — same signed event 3× = 1 credit (P0)
3. `pos-invoice-number-concurrency.test.ts` — 20 concurrent = 20 sequential serials (P0)
4. `reservation-window-outlasts-payment.test.ts` — TTL=60 assertion (P0)
5. `confirm-stock-invariant.test.ts` — `stock` unchanged across reserve→confirm (new — closes INV-1)
6. `dr-do-d1-parity.test.ts` — snapshot/restore parity (P0)
7. `redaction.test.ts` — phone/email never in audit_log or `console.*` (P0)
8. `forged-totals.test.ts` — client money fields rejected (P1)
9. `cron-never-releases-live-order.test.ts` (P1)
10. `payment-after-cancellation-refund.test.ts` (P1)
11. `online-confirmed-cancel-reversal.test.ts` (P1)
12. `idempotency-cross-session-isolation.test.ts` (P1)
13. `owner-totp-enforcement.test.ts` (P1)
14. `coupon-usage-limit-concurrency.test.ts` (P1)
15. `budget-counter-id-format.test.ts` (P1)
16. `vat-discount-rounding.test.ts` (P1)
17. `prepay-split-rounding.test.ts` (P1)
18. `migration-single-statement.test.ts` (P1)
19. `buy-now-session-fixation.test.ts` + `buy-no-origin-header.test.ts` + `buy-now-host-cookie-tossing.test.ts` (P1)
20. `cart-activity-out-of-order-upsert.test.ts` (P2)
21. `cod-split-order-velocity.test.ts` (P2)
22. `return-restock.test.ts` — refund-first then restock + failure reversal (P1)
23. `pos-sale-retry-idempotency.test.ts` (P1)
24. `reservation-cron-pending-review.test.ts` (P2)
25. `reservation-multi-variant.test.ts` (P2)
26. `reservation-checkout-retry-guard.test.ts` (P2)
27. `catalog-publish-latency.test.ts` (P2)
28. `coupon-rollback.test.ts` (P2)
29. Rewrite `race-conditions.test.ts` against real D1 (P0 — test integrity)
30. Rewrite `paid-expired-reservation.test.ts` against real SQL (P0 — test integrity)

---

## 8. Remediation Roadmap (30 / 60 / 90)

> Recommendations only — auditor applies nothing. Effort estimates assume one senior full-stack engineer.

### Day 0 (launch blockers — must land before any production traffic)

| # | Item | Closes | Effort | Owner |
|---|---|---|---|---|
| 1 | Resolve migration head conflict (N-19): renumber V8 schema migrations to `0048+` | unblocks INV-1..INV-10 | 0.5 day | Cluster 4 Owner |
| 2 | Land `payment_transactions` + `payment_events.{provider,provider_event_id}` + `UNIQUE(provider,provider_event_id)` (INV-2 / N-16) | INV-2 | 2 days | Payments Owner |
| 3 | Rewrite `applyPaymentVerified` to use stable provider event id + ledger row keyed by it (INV-2) | INV-2 | 1 day | Payments Owner |
| 4 | Fix `confirm()` stock decrement in DO + D1 (INV-1) | INV-1 | 0.5 day | Inventory Owner |
| 5 | Wire `InvoiceCounterDO.nextInvoiceNumber()` into `invoices.ts`; remove `SELECT MAX+1` (INV-3) | INV-3 | 1 day | POS Owner |
| 6 | Reservation TTL 10→60 min (INV-6) | INV-6 | 0.1 day | Inventory Owner |
| 7 | Reservation indexes: drop retired, add `checkout_id` + 2 partials (INV-7) | INV-7 | 1 day | Inventory Owner |
| 8 | `customer_ref` HMAC + `AUDIT_CUSTOMER_REF_SALT` + append-only triggers (INV-5) | INV-5 | 2 days | Security Owner |
| 9 | TOTP `body.secret` → server-side pending secret (K-22); TOTP disable step-up (K-23); Turnstile unconditional (K-19) | K-19/22/23 | 1 day | Auth Owner |
| 10 | Webhook IPN check fail-closed (K-01); closed signature header list (K-02); server-generated payments.id (K-03); auth+ownership on `/api/payments/status` (K-04) | K-01/02/03/04 | 1 day | Payments Owner |
| 11 | `advance_paisa` in the INSERT batch, not a separate UPDATE (K-09) | K-09 | 0.5 day | Checkout Owner |
| 12 | Reject empty Buy-Now binding secret (K-14) | K-14 | 0.5 day | Buy-Now Owner |
| 13 | Rewrite `race-conditions.test.ts` and `paid-expired-reservation.test.ts` against real D1 (K-41/K-45) | K-41/45 | 2 days | QA Owner |
| 14 | VAT from D1 `tax_rates` (INV-10); flip D-19 in `audit-drift.ts` | INV-10 | 1 day | Compliance Owner |
| 15 | `restoreFromSnapshot` + hourly DO snapshot cron (INV-4) | INV-4 | 2 days | DR Owner |
| 16 | `BudgetCounterDO` object ID `budget:{provider}` (INV-8) | INV-8 | 1 day | AI Owner |
| 17 | Land ADR-0001 option C — realign `audit-drift.ts` to 46 checks; flip D-19/D-23; add D-45/D-46 (N-3/4/5) | N-3/4/5 | 1.5 days | Cluster 4 Owner |

**Day 0 effort:** ~18 engineer-days. Recommend 3 engineers in parallel for ~1 week.

### 30-day (High severity)

- All K-High items (K-05/06/07/11/13/15/18/20/21/24/25/33/34/43)
- Step-up TTL 5 min + central sensitive-route registry (N-10)
- DLQ consumers for all 6 queues (K-42 + N-20)
- `audit_log.customer_ref` migration backfill for existing rows (post INV-5)
- `/api/me/delete` 30-day window or plan amendment (N-11/12)
- CSP `style-src 'unsafe-inline'` removal (N-13)
- `validate-coupon` rate-limit + server-side subtotal (K-10/11, N-22)

### 60-day (Medium)

- Order state machine V8 rebuild (INV-9)
- Courier inbound webhook + HMAC (N-15 / K-35)
- `super_admin` two-person rule for platform perms (N-8)
- `getRequiredStaffPermission` default-deny (N-9)
- KV session cache: `await` or remove (N-6/7)
- Three queues without DLQ (N-20)
- PII scrubber keys expansion (K-30)
- PBKDF2 → 600k + eager legacy rehash (K-25)
- All non-CT comparisons → `timingSafeEqualHex` (K-29)
- Full-chain audit verify, no LIMIT (K-31)

### 90-day (Low + hygiene)

- DO object-ID prefixes migration (N-2)
- `WafRules` plan amendment (N-1)
- CSP runtime hash canary (N-14)
- ESLint `no-console` rule (N-17)
- Cron concurrent-execution lock (N-26)
- Analytics/vitals rate-limit (N-24)
- Bucket name alignment (N-25)
- Cart cookie SameSite + HMAC (K-40, N-23)
- Payment-reconciliation alert on refunds-paid-after-cancel (RV8-008)
- Performance budgets run in CI (CWV)

**BDT impact estimates (rough order of magnitude):**
- INV-2 (double-credit): unbounded per incident; assume 1 incident/quarter × average order BDT 5,000 × 100 affected orders = BDT 5,00,000/quarter if unmitigated.
- INV-3 (Mushak gap): NBR penalty up to BDT 50,00,000 + VAT register re-issue cost (per Bangladesh VAT and SD Act 2012 §45).
- INV-5 (PII in audit log): Bangladesh privacy-regulator exposure; uncertifiable deletion — reputational + potential BDT 5,00,000 regulatory fine if contested.
- K-19/22/23 (owner ATO): full platform compromise — unbounded.
- K-09 (zero-paisa race): per-incident BDT 5,000-50,000 × frequency until detected.

---

## 9. Sign-off Checklist

### 9.1 Fifty Guardrails (§30) — verdict

| # | Rule (abbreviated) | Verdict | Evidence |
|---|---|---|---|
| 1 | `output: 'server'` only | ✅ Y | `astro.config.mjs:9` |
| 2 | 5 legal routes prerender | ⚠ Partial | 11 routes prerender; 6 catalog waived W-2026-01 |
| 3 | Pricing server-side | ✅ Y | `checkout-pricing.ts`, `invoices.ts` |
| 4 | Never trust client totals | ✅ Y (mostly) | except K-11 validate-coupon client subtotal |
| 5 | No float money | ✅ Y | no REAL/FLOAT money columns (cost_usd excepted) |
| 6 | CartDO single alarm handoff | ✅ Y | `cart-do.ts:327-350` |
| 7 | KV not authoritative | ✅ Y | KV cache dead but not authoritative (N-6) |
| 8 | Buy Now session via DO | ✅ Y | DirectCheckoutSessionDO used |
| 9 | Buy Now uses checkout engine | ✅ Y | `buy-now/submit.ts` |
| 10 | No order before reservation | ✅ Y | `checkout.ts` |
| 11 | Release reservation on D1 fail | ✅ Y | `checkout.ts` failure paths |
| 12 | Cleanup cron hourly safety-net | ✅ Y | `cron-dispatch.ts:44` |
| 13 | Short DOs alarm-based cleanup | ⚠ Partial | IdempotencyDO has no alarm (records never self-clean) |
| 14 | FraudBD 1.5s/0 retries/5-60s/5min/50 | ✅ Y | `fraud.ts` constants |
| 15 | COD qty+value+velocity | ✅ Y (value+qty); ⚠ velocity K-17 | `cod-limits.ts` |
| 16 | POS via directSale | ✅ Y | `invoices.ts:357-366` |
| 17 | Only adjustStock/restore write stock | ❌ N | INV-1 (confirm writes stock); INV-4 (no restore) |
| 18 | Staff-assisted orders via checkout | ✅ Y | `staff/orders/create.ts` |
| 19 | All webhooks HMAC | ⚠ Partial | PAY-003 open (K-02) |
| 20 | All staff routes Zero Trust + RBAC | ✅ Y | `middleware.ts` |
| 21 | No PII in logs | ⚠ Partial | safeLog exists; K-30 keys missing; N-17 raw console |
| 22 | Secrets in Cloudflare Secrets | ✅ Y | none in source |
| 23 | External APIs via adapters | ✅ Y | `src/lib/integrations/` |
| 24 | Adapters have timeout/retry/CB/mock | ✅ Y | per-adapter files |
| 25 | Payment events verified+reconciled | ❌ N | INV-2 ledger missing |
| 26 | Browser uploads originals only | ✅ Y | `uploads.ts` |
| 27 | Image optimization fallback | ✅ Y | image-processing consumer |
| 28 | CartDO alarm + cart_version | ✅ Y | `cart-do.ts:74-81` |
| 29 | Email adapter pattern | ✅ Y | `email/{resend,cloudflare_email}` |
| 30 | Resend default, CF Email gated | ✅ Y | `email/index.ts` |
| 31 | Migrations 1 statement/file + rollback + preflight | ⚠ Partial | rollbacks exist; pre-flight spot-checked OK; renumbering needed |
| 32 | D1 constraints enforced+tested | ❌ N | INV-2/7 (payment_events, reservation indexes) |
| 33 | Staff PII access audit logged with customer_ref | ❌ N | INV-5 |
| 34 | Performance budgets | ⚠ Unverified | not run this audit |
| 35 | Accessibility | ⚠ Manual | not assessed |
| 36 | AI content staff-reviewed | ✅ Y | `products.ai_draft_reviewed_by_staff_id` (per schema) |
| 37 | Expensive add-ons Owner approval | ✅ Y | RBAC gating |
| 38 | otp_secrets/api_audit_logs/ai_budget_limits exist | ✅ Y | migrations 0021/0022/0023 |
| 39 | Abandoned cart definition | ✅ Y | consumers query |
| 40 | Buy Now session binding HMAC | ❌ N | K-14 empty binding |
| 41 | VAT server-side, VAT_RATE_PERCENT retired | ❌ N | INV-10 |
| 42 | BudgetCounterDO daily+monthly caps | ⚠ Partial | INV-8 wrong object ID |
| 43 | Reservation indexes + checkout_id | ❌ N | INV-7 |
| 44 | Stock entry/exit writers | ❌ N | INV-1 confirm writes stock |
| 45 | One alarm per DO | ✅ Y | CartDO handoff verified |
| 46 | payment_events UNIQUE(provider,provider_event_id) | ❌ N | INV-2 / N-16 |
| 47 | DO state in DR | ❌ N | INV-4 |
| 48 | Migration discipline | ⚠ Partial | N-19 conflict |
| 49 | BudgetCounterDO object ID budget:{provider} | ❌ N | INV-8 |
| 50 | Reservation window 60 min | ❌ N | INV-6 |

**Tally:** 28 ✅, 6 ⚠ Partial/Unverified, **16 ❌ Not satisfied**.

### 9.2 Thirty-four Pre-Release Checklist (§34.4)

| # | Check | Verdict |
|---|---|---|
| 1 | No `output: 'static'/'hybrid'` | ✅ |
| 2 | No `prerender = false` | ✅ |
| 3 | Exactly 5 prerendered legal routes | ❌ (11, 6 waived) |
| 4 | `cart_activity.abandoned_email_sent_at` (not legacy pair) | ✅ |
| 5 | `otp_secrets`, `api_audit_logs`, `ai_budget_limits` exist | ✅ |
| 6 | `stock_reservations.checkout_id` + 2 partials + retired absent | ❌ (INV-7) |
| 7 | VariantInventoryDO has reverseDirectSale | ✅ |
| 8 | BudgetCounterDO has recordUsage + canUseDeepSeek | ✅ |
| 9 | Email adapter implements EmailProvider | ✅ |
| 10 | FraudBD 1.5s/0 retries | ✅ |
| 11 | FraudBD CB config 5/60s→5min→50 | ✅ |
| 12 | POS calls reverseDirectSale on D1 fail | ✅ (`invoices.ts:418`) |
| 13 | VAT server-side §11.7 | ❌ (INV-10) |
| 14 | DirectCheckout binds on cookie secret, not Origin/UA | ✅ (but K-14 empty bypass) |
| 15 | DirectCheckout deleted on order success | ⚠ NEEDS-VERIFICATION |
| 16 | CartDO exactly one alarm, persist→cleanup | ✅ |
| 17 | Reservation cleanup cron hourly | ✅ |
| 18 | No PII in logs | ⚠ (K-30, N-17) |
| 19 | All staff routes Zero Trust | ✅ |
| 20 | All webhooks HMAC | ⚠ (K-01/02) |
| 21 | Cleanup cron never releases live order | ⚠ (INV-6 TTL too short → live orders at risk) |
| 22 | Reservation outlasts payment window | ❌ (INV-6) |
| 23 | VariantInventoryDO.adjustStock + restoreFromSnapshot | ❌ (INV-4) |
| 24 | payment_events UNIQUE(provider, provider_event_id) | ❌ (INV-2) |
| 25 | BudgetCounterDO id budget:{provider} | ❌ (INV-8) |
| 26 | Migrations 1 statement, numbered above head | ⚠ (N-19 conflict) |
| 27 | DR covers DO state | ❌ (INV-4) |
| 28 | Oversell concurrency test exists+passes | ❌ (K-41 fake) |
| 29 | Coupon redemption in order batch | ✅ |
| 30 | POS invoice serials DO-issued + unique | ❌ (INV-3) |
| 31 | Mushak mapping signed off | [MANUAL] |
| 32 | Accessibility | [MANUAL] |
| 33 | POS sale creation idempotent | ✅ |
| 34 | site_settings exists + seeded | ✅ |

**Tally:** 19 ✅, 5 ⚠, **8 ❌**, 2 [MANUAL].

---

## Appendix A — PoC Scripts

> Each PoC is a read-only attack demonstration; running these against production is forbidden by the engagement terms. They are written for staging or local dev only.

### A.1 Zero-paisa race (AT-1, K-09, INV-1)

```bash
# Two concurrent checkouts for the same variant, racing the advance_paisa UPDATE.
# The race window is the time between INSERT and UPDATE in checkout.ts:354-376.
for i in 1 2; do
  curl -X POST https://staging.zabirboutiques.com/api/checkout \
    -H 'Content-Type: application/json' \
    -H 'Origin: https://staging.zabirboutiques.com' \
    -b 'zb_cart_sid=<target_cart_uuid>' \
    -d '{
      "items":[{"variantId":"<variant>","quantity":1}],
      "paymentMethod":"partial_prepay",
      "name":"Race Test","phone":"+8801712345678","address":"Dhaka",
      "turnstileToken":"<valid_token>"
    }' &
done; wait
# Then immediately poll /api/payments/create for advance_paisa=0 invoices.
```

### A.2 Webhook forgery via dropped IPN header (AT-2, K-01)

```bash
# Replay a captured webhook body WITHOUT the RT-UDDOKTAPAY-API-KEY header.
# If the gateway echoes provider_event_id differently, K-06 fallback also kicks in.
curl -X POST https://staging.zabirboutiques.com/api/payments/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-UddoktaPay-Signature: <replayed_hmac>' \
  -d '<captured_raw_body>'
# Expected (vulnerable): 200 received:true.
# Expected (fixed): 401 Unauthorized (missing IPN key).
```

### A.3 Invoice serial collision (AT-3, INV-3)

```bash
# 20 concurrent POS invoice creates.
for i in {1..20}; do
  curl -X POST https://staging.zabirboutiques.com/api/staff/invoices \
    -H 'Content-Type: application/json' \
    -H "X-CSRF-Token: $CSRF" \
    -b "session=$STAFF_SESSION; __Host-csrf-token=$CSRF" \
    -d "{\"idempotencyKey\":\"poc-$i-$(date +%s%N)\",\"items\":[{\"variantId\":\"<variant>\",\"quantity\":1}],\"payments\":[{\"method\":\"cash\",\"amountPaisa\":50000}]}" &
done; wait
# Then: SELECT receipt_no, COUNT(*) FROM invoices WHERE date(created_at)=date('now') GROUP BY receipt_no;
# Expected (vulnerable): one or more retries (gap in NNNN sequence).
# Expected (fixed): 20 contiguous serials from InvoiceCounterDO.
```

### A.4 TOTP body.secret owner takeover (AT-4, K-22)

```bash
# Requires stolen owner session cookie. Enroll attacker-controlled TOTP secret.
curl -X POST https://staging.zabirboutiques.com/api/staff/totp/verify \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -b "session=$STOLEN_OWNER_SESSION; __Host-csrf-token=$CSRF" \
  -d "{
    \"secret\":\"JBSWY3DPEHPK3PXP\",
    \"code\":\"<current_totp_for_attacker_secret>\"
  }"
# Expected (vulnerable): 200 ok — owner's stored secret now equals attacker's.
```

### A.5 Turnstile bypass on staff login (AT-5, K-19)

```bash
# Credential stuffing without Turnstile. Send any totp_code to skip the gate.
for pw in $(cat wordlist.txt); do
  curl -X POST https://staging.zabirboutiques.com/api/staff/login \
    -H 'Content-Type: application/json' \
    -d "{\"identifier\":\"owner@zabirboutiques.com\",\"password\":\"$pw\",\"totp_code\":\"1\"}"
done
# Expected (vulnerable): no Turnstile challenge, just the 10/min RL.
```

### A.6 Refund drain via returns/approve (AT-6, K-33)

```bash
# Step 1: open a return on a compromised customer account.
# Step 2: approve it; the restock runs first (approve.ts:135-153).
curl -X POST https://staging.zabirboutiques.com/api/staff/returns/<id>/approve \
  -H "X-CSRF-Token: $CSRF" -b "session=$STAFF_SESSION; __Host-csrf-token=$CSRF" \
  -d '{"refundAmountPaisa":50000}'
# Step 3: induce a network failure during the refund API call (e.g. cut network from worker).
# Expected (vulnerable): return_requests back to pending; stock restock NOT reversed.
```

### A.7 Cart-sid hijack via abandoned-cart URL (AT-7, K-39+K-18+K-40)

```bash
# Attacker captures a leaked recovery URL (proxy log / Referer / shared device history).
curl -X POST https://staging.zabirboutiques.com/api/checkout \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id":"<leaked_cart_uuid>",
    "items":[{"variantId":"<variant>","quantity":1}],
    "paymentMethod":"bkash","name":"Attacker","phone":"+8801XXXXXXXXX","address":"Dhaka",
    "turnstileToken":"<valid>"
  }'
# Expected (vulnerable): order created from victim's cart (body session_id overrides cookie).
```

### A.8 Buy-Now empty binding secret (AT-8, K-14)

```bash
# Step 1: create session without bindingSecret.
curl -X POST https://staging.zabirboutiques.com/api/buy-now/session \
  -H 'Content-Type: application/json' \
  -d '{"slug":"<product>","quantity":1,"variantId":"<variant>"}'
# Step 2: resume from a different device with empty bindingSecret — verification passes.
```

### A.9 Open-redirect phishing via Origin (AT-9, K-13)

```bash
curl -X POST https://staging.zabirboutiques.com/api/checkout \
  -H 'Origin: https://zabirboutiques-secure.com' \
  -H 'Content-Type: application/json' \
  -b 'zb_cart_sid=<sid>' \
  -d '{...valid checkout..., "turnstileToken":"<>"}'
# Expected (vulnerable): redirectUrl = https://zabirboutiques-secure.com/order-track
```

### A.10 Payment replay via placebo dedup (AT-10, INV-2)

```bash
# Send the same webhook body 3 times with a one-byte whitespace tweak each time.
# Each body produces a different sha256(rawBody) event_id fallback (K-06).
for i in 1 2 3; do
  body=$(printf '%s ' '<captured_body>')   # trailing space varies the hash
  curl -X POST https://staging.zabirboutiques.com/api/payments/webhook \
    -H "X-UddoktaPay-Signature: $(echo -n "$body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | cut -d' ' -f2)" \
    -d "$body"
done
# Expected (vulnerable): 3 distinct payment_events rows; potential triple credit.
```

---

## Appendix B — File:Line Index of Every Finding

**Critical (launch blockers):**
- INV-1: `src/do/variant-inventory-do.ts:190`; `src/lib/inventory.ts:366`
- INV-2: `db/migrations/0001_initial_v6_8a_schema.sql:231-240,239`; `src/lib/payments.ts:188-201`
- INV-3: `src/lib/invoices.ts:58-73,280`; `src/do/invoice-counter-do.ts:77` (uncalled)
- INV-4: `src/lib/cron-dispatch.ts:40-45` (no snapshot); `restoreFromSnapshot` absent
- INV-5: `db/migrations/0001_initial_v6_8a_schema.sql:266-277`; `src/lib/audit.ts:76-94`
- INV-6: `src/lib/reservation-ttl.ts:13`
- INV-7: `db/migrations/0024_stock_reservations_unique_constraint.sql:11-13`; `0028:3-6`
- INV-8: `src/do/budget-counter-do.ts:330,338,346,354`
- INV-9: `src/lib/order-state-machine.ts:13`
- INV-10: `src/pages/api/checkout.ts:252`; `buy-now/submit.ts:217`; `staff/orders/create.ts:133`; `staff/invoices/index.ts:148`
- K-01: `src/pages/api/payments/webhook.ts:29-32`
- K-02: `src/lib/payment-webhook-ingress.ts:24-31`
- K-03: `src/pages/api/payments/create.ts:18,66,87-90`
- K-04: `src/pages/api/payments/status/[id].ts:8-26`
- K-09: `src/pages/api/checkout.ts:354-376`; `buy-now/submit.ts:322-324`
- K-14: `src/do/direct-checkout-session-do.ts:87,219-225`; `buy-now/submit.ts:77,80`
- K-19: `src/pages/api/staff/login.ts:64`
- K-22: `src/pages/api/staff/totp/verify.ts:24,26,29`
- N-16: `db/migrations/0001_initial_v6_8a_schema.sql:239`
- N-19: `db/migrations/` head `0047` vs plan `0039`
- N-3/4/5: `scripts/audit/audit-drift.ts:472,269-272,289-292`

**High:**
- K-05 `webhook.ts:55-63`; K-06 `payment-webhook-ingress.ts:44-53`; K-07 `payments.ts:154-157`; K-11 `validate-coupon.ts:12,43,55-62`; K-13 `checkout.ts:383-393`, `buy-now/submit.ts:350-351`; K-15 `fraud.ts:18-22,80-82`; K-16 `fraud/override.ts:22-26`; K-18 `checkout.ts:88-93`; K-20 `session-blacklist.ts:15,45-47`, `login.ts:193`, `rbac.ts:218`; K-21 `reset-password.ts:65-67`; K-23 `totp/disable.ts:7-15`; K-24 (11 handlers, §5.B); K-25 `password.ts:19-22`; K-32 = INV-3; K-33 `returns/[id]/approve.ts:135-153,159-165,182-188,195-201`; K-34 `courier.ts:86`; K-41 `race-conditions.test.ts:4-21,34-44`; K-43 `consumers.ts:236-244`; N-11 `me/delete.ts:32-35`; N-22 `validate-coupon.ts`

**Medium:**
- K-08 (partial) `payments.ts:203-240`, `checkout.ts:401-403`; K-12 `buy-now/submit.ts:145-158`; K-17 `cod-limits.ts:66-72`; K-26 `login-rate-limit.ts:40`; K-27 `middleware.ts:120`, `audit.ts:18-19`, `api-keys.ts:89`; K-28 `totp.ts`, `otp-secrets.ts:6,100`; K-29 `csrf.ts:31`, `phone-verification.ts:161-162,217-218`, `audit.ts:121,139`, `backup.ts:330`, `login.ts:122`, `step-up.ts:54`; K-30 `pii-scrubber.ts:9-23`; K-31 `audit.ts:104,160`; K-35/N-15 (no courier webhook); K-36 `csrf-rotation.ts:7-9,28-39`; K-37 `confirm.ts:76-96`; K-38 (no cancel/refund route); K-39 `consumers.ts:148-153`; K-40 `cart/index.ts:115-117`, `do-client.ts:415`; K-42 `wrangler.jsonc:129-136`; K-44 `do-client.ts:153-167`; K-45 `paid-expired-reservation.test.ts:9-54`; N-1 `wrangler.jsonc:84-95`; N-2 (DO IDs); N-7 KV prefixes; N-8 `rbac.ts:186-189`; N-9 `staff-route-rbac.ts:51`; N-10 `critical-auth.ts:18`; N-12 `me/delete.ts`; N-13 `csp.ts:9,35`; N-20 `wrangler.jsonc:131,132,135`

**Low:**
- N-6 `rbac.ts:216-220`; N-14 `csp-hashes.ts:13-17`; N-17 `RootLayout.astro:195`; N-18 `wrangler.jsonc:15`; N-23 `cart/index.ts:20-26`; N-24 `vitals.ts`; N-25 `wrangler.jsonc:62`; N-26 `cron-dispatch.ts` (NEEDS-VERIFICATION)

---

## Appendix C — Git Blame Summary of Trust Primitives (bus-factor=1 risk)

| File | Last commit | Author | Bus-factor risk |
|---|---|---|---|
| `src/lib/security.ts` | `42f3ecc` 2026-08-08 | delwarnetwork | HIGH — single-author commit, no co-maintainer; CT primitive + HMAC + CSRF token all in 56 lines |
| `src/lib/csrf.ts` | `42f3ecc` 2026-08-08 | delwarnetwork | HIGH — depends on `security.ts` + `staff-cookies.ts`; same author |
| `src/lib/payment-webhook-ingress.ts` | `42f3ecc` 2026-08-08 | delwarnetwork | HIGH — PAY-003 open, no reviewer signature |
| `src/lib/pii-scrubber.ts` | `42f3ecc` 2026-08-08 | delwarnetwork | HIGH — `safeLog` is the only sanctioned logger; no enforcement rule |
| `src/middleware.ts` | `7bee2c6` 2026-08-08 | delwarnetwork | HIGH — single middleware composes CSP, rate-limit, auth, RBAC, CSRF; one author |
| `src/do/variant-inventory-do.ts` | `7bee2c6` 2026-08-08 | delwarnetwork | HIGH — INV-1 introduced here (`this.stock -= qty`) |

**Recommendation:** Introduce mandatory two-reviewer sign-off on all 6 files; add a CODEOWNERS entry pinning them to senior security/engineering owners. The combination of single-author + recent mass commit (everything touched 2026-08-08) + invariant violations is the highest bus-factor risk observed.

---

## Exit Criteria

- [x] Every file in `src/lib/`, `src/do/`, `src/pages/api/`, `src/middleware.ts`, `src/entry-cloudflare.ts` read at least once (via direct read or delegated subagent with verbatim quotes).
- [x] Every guardrail (1..50) has a Y/N/Partial verdict with evidence (§9.1).
- [x] Every drift code (D-01..D-46) verified present-or-absent in `audit-drift.ts` (§2.6: 44 present, D-45/D-46 missing, D-19/D-23 inverted).
- [x] Every trust-primitive invariant verified (§2.4).
- [x] Every K-01..K-45 re-verified — 44 CONFIRMED, 1 PARTIAL-REFUTE (§5.E).
- [x] At least 10 NEW findings documented — 26 delivered (N-1..N-26).
- [x] Top-10 attack trees written, each with a PoC or a note (§4.2 + Appendix A).
- [x] Remediation roadmap has BDT impact estimates and owner assignments (§8).
- [x] Findings cross-checked by the self-verification loop (every cited `file:line` re-read at HEAD on 2026-08-09).

---

*End of report. Generated 2026-08-09. Read-only engagement — no source files modified.*
