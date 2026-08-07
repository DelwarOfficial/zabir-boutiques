# Design Note: `src/lib/payment-webhook-ingress.ts` — Webhook Authenticity

**Bus factor:** 1 (sole author: delwarnetwork; last touched 2026-06-18)
**Why it matters:** This is the **money-in path**. It decides whether an HTTP request claiming "UddoktaPay received a payment" is genuine. If it can be spoofed, an attacker marks orders paid without sending money to the gateway. It sits directly in front of `applyPaymentVerified` (which deducts stock and advances order state), so a forgery here is a direct revenue loss.

---

## What it provides

Five functions that together authenticate and record an incoming payment webhook:

### 1. `verifyPaymentWebhookSignature(rawBody, receivedSig, secret)` — the gate
```ts
const normalized = receivedSig.replace(/^sha256=/i, '').trim().toLowerCase();
if (!normalized) return false;
const expected = await hmacSha256Hex(rawBody, secret);   // from lib/security.ts
return timingSafeEqualHex(normalized, expected);
```
- **Invariant:** returns true only if `HMAC-SHA256(rawBody, UDDOKTAPAY_WEBHOOK_SECRET)` matches the signature the provider sent.
- **Critical dependency:** it reuses the bf=1 `hmacSha256Hex` + `timingSafeEqualHex` from `lib/security.ts`. If those primitives leak timing, this verification is forgeable. The two files are coupled in trust.
- **Subtlety:** the HMAC is computed over `rawBody` (the raw bytes), **not** a re-serialized JSON object. The webhook handler must pass the exact bytes it received, never a parsed-then-re-stringified version — any whitespace difference invalidates the signature. This is why `webhook.ts` calls `await context.request.text()` first and feeds that same string to both the verifier and the parser.

### 2. `readWebhookSignature(request)` — header reader
- Currently accepts `X-UddoktaPay-Signature`, `X-Signature`, and `Signature` as fallbacks.
- **⚠️ Known weak spot (security review PAY-003):** the two generic fallbacks (`X-Signature`, `Signature`) are undocumented and widen the surface. The fix is to accept only `X-UddoktaPay-Signature` (or branch on detected provider for SSLCommerz). A reviewer should not add further generic headers here.

### 3. `parseWebhookPayload(rawBody)` — safe JSON parse
- Returns `null` on malformed JSON rather than throwing. Does **not** trust the parsed shape — callers must field-check (`typeof body.invoice_id === 'string'`, etc.).

### 4. `resolveWebhookEventId(body, rawBody)` — stable idempotency key
- Picks the first present provider event id from `event_id | eventId | id | transaction_id | trx_id`.
- **Fallback:** SHA-256 of the raw body. This guarantees every webhook gets a unique, stable key even if the provider omits an id — essential because `payment_events` uses this as a PRIMARY KEY for replay protection (F-01).

### 5. `recordWebhookReceipt(db, ...)` — idempotent persistence
```ts
const result = await db.prepare(
  `INSERT OR IGNORE INTO payment_events (id, ...) VALUES (...)`
).bind(opts.eventId, ...).run();
return result.meta.changes === 1 ? 'recorded' : 'duplicate';
```
- **Invariant:** at most one `payment_events` row per `(provider_event_id)`. A replayed webhook returns `'duplicate'` and the caller short-circuits with 200 — it does **not** create a second credit. This is the F-01 double-credit defense.
- Returns `'payment_not_found'` if the `invoice_id` doesn't match a row in `payments`, so forged webhooks referencing unknown invoices are rejected before queue processing.

---

## The invariants a reviewer must protect

1. **Always verify before any state change.** The webhook handler (`webhook.ts`) calls `verifyPaymentWebhookSignature` *before* `recordWebhookReceipt`, and `recordWebhookReceipt` runs *before* `applyPaymentVerified`. Never reorder these — a single early `applyPaymentVerified` without verification is a direct-pay forgery.
2. **The signature is over the raw body, always.** If a refactor "tidies" the body through `JSON.stringify(JSON.parse(raw))`, signatures stop matching and either (a) all webhooks fail (DoS on payment confirmation) or (b) someone "fixes" it by relaxing verification (catastrophe). Reject any diff that re-serializes before HMAC.
3. **`INSERT OR IGNORE` + `changes === 1` is the replay defense.** Do not replace it with a read-then-write; that reintroduces the TOCTOU double-credit race (F-01).
4. **The IPN API-key check in `webhook.ts` is currently optional** (skipped when the header is absent — see security review PAY-004). If you tighten it to required, do so for both HMAC + API key, never HMAC alone replaced by API key.

---

## What breaks if this file is wrong

| Failure | Blast radius |
|---|---|
| Signature verification bypass / weakened | Attacker marks arbitrary orders `paid` → free goods, stock deducted, no money received. |
| Raw-body HMAC replaced with parsed-body | Verification fails on legitimate webhooks → payments never confirm → orders stuck in `pending_payment` until reconciliation cron. |
| Event-id idempotency removed | Replayed webhook double-credits → double stock deduction / double fulfilment. |
| Generic signature header used by a proxy | Confused-deputy forgery via an intermediary that supplies `X-Signature`. |

---

## The trust chain (one-page view)

```
UddoktaPay POST → webhook.ts
   ├─ verifyPaymentWebhookSignature(rawBody, sig, secret)   ← THIS FILE + lib/security.ts
   │     └─ hmacSha256Hex + timingSafeEqualHex              ← bf=1 root primitive
   ├─ IPN API-key check (optional, see PAY-004)
   ├─ recordWebhookReceipt(db, ...)                          ← THIS FILE (idempotent INSERT)
   │     └─ payment_events UNIQUE(provider, provider_event_id)
   └─ enqueuePaymentWebhook  →  queue consumer
          └─ applyPaymentVerified                            ← lib/payments.ts (stock deduct, status)
```

Every arrow is load-bearing. The first verification is the only thing standing between "the internet" and `applyPaymentVerified`.

---

## Second-touch checklist (to raise bus factor to 2)

- [ ] Read this note and the source; be able to explain why HMAC is over raw bytes, not parsed JSON.
- [ ] Write a test: a webhook with a tampered body byte must fail verification; a replayed `event_id` must return `'duplicate'`.
- [ ] Review the PAY-003 fix (drop `X-Signature` / `Signature` fallbacks) and either apply it or document why it's retained.
- [ ] Make one small git touch so history records a second author on this file.
