# Security Best Practices Report — Checkout & Payments

**Project:** Zabir Boutiques (Astro 6 SSR + React 19 on Cloudflare Workers)
**Scope:** Checkout & payment surface — `src/pages/api/checkout.ts`, `src/pages/api/payments/*`, `src/lib/payments.ts`, `src/lib/payment-webhook-ingress.ts`, `src/lib/checkout-pricing.ts`, `src/middleware.ts`, `src/lib/security.ts`, `src/lib/csrf.ts`, `src/lib/turnstile.ts`
**Method:** Reviewed against the `security-best-practices` skill references (Express backend, React/Vanilla frontend security specs).
**Date:** 2026-08-07

---

## Executive Summary

The checkout and payment core is **architecturally strong** for a payment-handling storefront. The highest-value defenses are present and correctly implemented:

- ✅ **Server-authoritative pricing** — client money fields are ignored; all prices from D1 (`assertNoClientMoneyTrust`, `loadVariantSnapshots`). Price-tampering is closed.
- ✅ **Webhook authenticity** — HMAC-SHA256 verified over the raw body with timing-safe comparison before any processing (`verifyPaymentWebhookSignature`).
- ✅ **Forward-only payment state** — guarded `UPDATE … WHERE status IN (…)` + atomic D1 batch claim prevents replay/re-flip (`applyPaymentVerified`).
- ✅ **Amount authority** — verified gateway amount must equal stored `payments.amount_paisa`, else `AMOUNT_MISMATCH`.
- ✅ **CSRF** — double-submit `nonce.HMAC(nonce)` token in an `HttpOnly; Secure; SameSite=Strict; __Host-` cookie, validated for all non-GET `/api/staff/*` and `/staff/*` mutations.
- ✅ **AuthN/AuthZ** — central staff guard + RBAC permission check per route (`getRequiredStaffPermission`).
- ✅ **Rate limiting** — per-IP KV limits on checkout, payments/create, login, fraud-check, etc.; critical routes fail closed (503) on KV errors.
- ✅ **CSP** — per-request nonce + `strict-dynamic` + build-time SHA-256 hashes; `frame-ancestors 'none'`; `form-action 'self'`.

That said, I found **1 High**, **2 Medium**, and **2 Low** findings. None are catastrophic given the compensating controls, but the High finding should be fixed before accepting it as production-safe.

---

## Findings

### [HIGH] PAY-001 — Payment redirect/cancel URLs built from attacker-influenced `Origin` / body fields (open-redirect to attacker-controlled domain via payment gateway)

**Severity:** High

**Locations:**
- `src/pages/api/checkout.ts:347-358` — `redirectUrl: \`${origin}/order-track\`` where `origin = context.request.headers.get('Origin')`
- `src/pages/api/payments/create.ts:75-76` — `redirectUrl: \`${body.redirect_url ?? env.PUBLIC_SITE_URL}/order-track\`` and `cancelUrl: \`${body.cancel_url ?? env.PUBLIC_SITE_URL}/checkout\``

**Evidence (checkout.ts):**
```ts
const origin = context.request.headers.get('Origin') ?? '';
const checkout = await createPaymentCheckout(env, {
  ...
  redirectUrl: `${origin}/order-track`,
  cancelUrl:     `${origin}/cart`,
});
```

**Evidence (payments/create.ts):**
```ts
redirectUrl: `${body.redirect_url ?? env.PUBLIC_SITE_URL}/order-track`,
cancelUrl:   `${body.cancel_url  ?? env.PUBLIC_SITE_URL}/checkout`,
```

**Impact:** The `Origin` header and `body.redirect_url` / `body.cancel_url` are attacker-controllable. They are interpolated **unsanitized** into the `redirectUrl`/`cancelUrl` passed to the UddoktaPay/SSLCommerz checkout. After a customer pays, the gateway redirects the browser to this URL. An attacker who can shape the request (e.g., a malicious page that POSTs to `/api/payments/create` for a known `order_id`, or any flow that lets them influence the stored redirect target) can send a paying customer to `https://attacker.example/order-track` after a successful UddoktaPay charge. This is a classic post-payment phishing/credential-harvest path: the victim lands on a look-alike "enter your card details again" page. It also undermines the trust signal of a gateway-issued redirect.

Two compounding factors:
1. `/api/payments/create` is **not** CSRF-protected (it is not under `/api/staff/`) and only validates `order_id` existence + status — there is no check that the caller owns the order. So a cross-origin form can call it for any order in a payable state and inject an attacker `redirect_url`.
2. `payments/create.ts:11` declares `let body: any;` and uses `body.order_id`, `body.redirect_url`, etc. with no schema validation — type confusion is wide open.

This violates **EXPRESS-REDIRECT-001 / REACT-REDIRECT-001 / JS-URL-001** (validate redirect targets derived from untrusted input; allowlist origins; fall back to a safe default).

**Fix (minimal, safe-by-default):**
Use a fixed, trusted origin and ignore client-supplied URL fields entirely (the gateway redirect should always return to the shop):

```ts
// checkout.ts — derive a trusted origin instead of trusting the header
const siteOrigin = env.PUBLIC_SITE_URL
  ? new URL(env.PUBLIC_SITE_URL).origin
  : new URL(context.request.url).origin;
const checkout = await createPaymentCheckout(env, {
  ...
  redirectUrl: `${siteOrigin}/order-track`,
  cancelUrl:   `${siteOrigin}/cart`,
});
```

```ts
// payments/create.ts — drop body.redirect_url / body.cancel_url; ignore client URL input
const siteOrigin = env.PUBLIC_SITE_URL ?? new URL(context.request.url).origin;
const checkout = await createPaymentCheckout(env, {
  ...
  redirectUrl: `${siteOrigin}/order-track`,
  cancelUrl:   `${siteOrigin}/checkout`,
});
```

If cross-domain redirect targets are ever genuinely required, gate them behind a strict allowlist of absolute origins and validate scheme = `https:`.

**Mitigation (defense-in-depth):** Add caller-ownership verification to `/api/payments/create` (e.g., require the session-bound CartDO session, or a short-lived signed token minted at checkout) and validate the body with a schema (`zod`) instead of `any`.

**False-positive check:** Confirm whether the gateway ever *needs* a caller-supplied redirect host (e.g., for a whitelabel domain). If not, the fixed-origin fix has no functional downside.

---

### [MEDIUM] PAY-002 — `/api/payments/create` lacks ownership/CSRF protection and accepts an unvalidated body

**Severity:** Medium (defense-in-depth; see PAY-001 for the combined impact)

**Location:** `src/pages/api/payments/create.ts:7-77`

**Evidence:**
```ts
let body: any;
try { body = await context.request.json(); } catch { ... }
const orderId = body.order_id;
...
// no check that the caller owns `orderId` or is authenticated
// no CSRF check (path is not under /api/staff/)
...
redirectUrl: `${body.redirect_url ?? env.PUBLIC_SITE_URL}/order-track`,
```

**Impact:** Any caller (including a cross-origin form via the victim's browser) can initiate a payment for any order that is in a payable state, and inject the redirect target (PAY-001). Even ignoring the redirect issue, an attacker can force-payment-spam orders, or pin an `Idempotency-Key` to lock a victim's order into a chosen payment session.

**Fix:**
- Validate the body with a schema and type (`{ order_id: string }`), reject unknown URL fields.
- Verify the caller is authorized to pay `order_id` — e.g., require a signed "payment token" minted at checkout and stored against the order, or bind to the same session that created the order.
- Apply the same-origin/origin allowlist used by `/api/staff/login` (`originAllowed`) to non-safe methods on this route, or add it to the CSRF-protected path set.

---

### [MEDIUM] PAY-003 — Webhook signature header fallbacks are permissive (`Signature`, `X-Signature`)

**Severity:** Medium

**Location:** `src/lib/payment-webhook-ingress.ts:24-31`

**Evidence:**
```ts
export function readWebhookSignature(request: Request): string {
  return (
    request.headers.get('X-UddoktaPay-Signature')
    || request.headers.get('X-Signature')
    || request.headers.get('Signature')
    || ''
  ).trim();
}
```

**Impact:** `X-Signature` and `Signature` are generic, undocumented header names. Accepting them widens the surface for header-injection / confused-proxy scenarios where an intermediary could supply a forged signature under a generic name. The HMAC secret still protects against forgery, so this is defense-in-depth — but accepting undocumented headers is an unnecessary risk for a money flow.

**Fix:** Accept only the documented UddoktaPay header:
```ts
return (request.headers.get('X-UddoktaPay-Signature') ?? '').trim();
```
If SSLCommerz (the fallback provider) uses a different header, branch on the detected provider rather than accepting generic fallbacks.

---

### [LOW] PAY-004 — Webhook is accepted even when IPN API-key header is absent

**Severity:** Low (defense-in-depth)

**Location:** `src/pages/api/payments/webhook.ts:29-32`

**Evidence:**
```ts
const ipnKey = context.request.headers.get('RT-UDDOKTAPAY-API-KEY');
if (ipnKey && env.UDDOKTAPAY_API_KEY && !timingSafeEqualHex(ipnKey, env.UDDOKTAPAY_API_KEY)) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
```

**Impact:** The API-key check is skipped entirely when the `RT-UDDOKTAPAY-API-KEY` header is missing. Authentication therefore relies solely on the HMAC secret. If that single secret leaks, there is no second factor. This is acceptable as a deliberate design (HMAC is the primary control) but worth tightening: if both the HMAC secret and the API key are configured, **require** the IPN key to be present and match.

**Fix:**
```ts
if (env.UDDOKTAPAY_API_KEY) {
  const ipnKey = context.request.headers.get('RT-UDDOKTAPAY-API-KEY');
  if (!ipnKey || !timingSafeEqualHex(ipnKey, env.UDDOKTAPAY_API_KEY)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
```

---

### [LOW] PAY-005 — `payments/create.ts` uses `any`-typed body; other endpoints validate strictly

**Severity:** Low (consistency / future-proofing)

**Location:** `src/pages/api/payments/create.ts:11-15`

**Evidence:** `let body: any;` followed by unchecked `body.order_id`, `body.redirect_url`, `body.customer_name`, `body.customer_phone`.

**Impact:** Type-confusion risk and inconsistent with the otherwise-strict validation in `checkout.ts` / `checkout-pricing.ts` (`parseCheckoutCart`). Any future field added here will be unvalidated by default.

**Fix:** Parse with a strict schema (e.g., `zod`) and a typed `body`. This dovetails with PAY-001/PAY-002.

---

## What was reviewed and looked good (no action)

- **HMAC + timing-safe compare** (`security.ts`): correct constant-time loop over hex chars; HMAC via Web Crypto. ✅
- **Forward-only payment transitions + atomic batch claim** (`applyPaymentVerified`): replay-safe, race-safe. ✅
- **Amount/metadata authority checks** (`AMOUNT_MISMATCH`, `INVOICE_ORDER_MISMATCH`). ✅
- **CSRF double-submit** with `__Host-` + `HttpOnly` + `Secure` + `SameSite=Strict`, HMAC-signed token independent of the session token. ✅
- **Staff auth guard + RBAC** applied centrally in middleware; auth resolved once per request. ✅
- **Rate limiting** with fail-closed on critical routes; IP from `CF-Connecting-IP` first. ✅
- **CSP** with per-request nonce, `strict-dynamic`, build-time hashes, `frame-ancestors 'none'`, `form-action 'self'`. ✅
- **Server-authoritative pricing**; integer paisa throughout; no client money trust. ✅
- **SQL**: all queries reviewed are parameterized (`?1` bind placeholders); no string interpolation of untrusted input into SQL. ✅
- **PII scrubber** (`safeLog`) used in logging paths; raw provider responses stored only in `payment_events.raw_payload`. ✅

---

## Suggested fix order

1. **PAY-001** (High) — pin redirect/cancel URLs to `PUBLIC_SITE_URL` in both `checkout.ts` and `payments/create.ts`. Small, safe diff.
2. **PAY-002** (Medium) — add ownership + schema validation to `/api/payments/create`.
3. **PAY-003** (Medium) — drop generic signature header fallbacks.
4. **PAY-004 / PAY-005** (Low) — tighten IPN-key requirement; type the body.

I can implement any of these one at a time with tests, per the skill's "fix one finding per change" guidance — just say which to start with.
