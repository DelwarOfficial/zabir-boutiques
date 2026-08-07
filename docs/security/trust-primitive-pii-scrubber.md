# Design Note: `src/lib/pii-scrubber.ts` — Log Redaction Chokepoint

**Bus factor:** 1 (sole author: DelwarOfficial; last touched 2026-06-16)
**Why it matters:** Every structured log line that could contain customer PII flows through `safeLog` in this file. It is the **single chokepoint** between the application and the operational log stream (Logpush to R2, console in dev). If its redaction regresses, customer phone numbers, addresses, emails, and payment card data leak into logs that are retained for 7 years (§25) and aggregated in observability tooling. That is a data-protection incident under the V8 plan's compliance regime (§28), not just a tidiness issue.

---

## What it provides

### 1. A key-based redaction set
```ts
const PII_KEYS = new Set([
  "phone", "phone_number", "address", "delivery_address",
  "email", "customer_email", "password", "token",
  "session_token", "csrf_token", "card_number", "card_cvv", "cardholder",
]);
```
Any object key matching this set (case-insensitive) has its value replaced with `"[REDACTED]"` before logging.

### 2. A regex-based fallback for PII embedded in strings
```ts
const PHONE_REGEX = /(\+?88)?01[3-9]\d{8}/g;        // Bangladeshi mobile
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
```
These catch PII that has been interpolated into free-text message strings (e.g. `"checkout failed for 01712-345678"`), where there is no object key to match.

### 3. Recursive value scrubbing — `scrubValue`
- Walks objects/arrays recursively.
- For each object key: if the key is in `PII_KEYS` → redact the value wholesale; otherwise → recurse.
- For strings: run the phone/email regex replacement.

### 4. `safeLog` — the drop-in `console.*` replacement
```ts
export const safeLog = {
  info:  (message, data?) => console.info(formatLog({ level: "info", message, data })),
  warn:  (message, data?) => console.warn(formatLog({ level: "warn", message, data })),
  error: (message, data?) => console.error(formatLog({ level: "error", message, data })),
  debug: (message, data?) => console.debug(formatLog({ level: "debug", message, data })),
};
```
- Every log goes through `formatLog`, which scrubs both `message` (regex) and `data` (recursive).
- **The lint rule (§25.1) bans raw `console.log`** — `safeLog` is the only sanctioned logger. This is what makes the chokepoint real: there is no other path to the log stream in app code.

---

## The invariants a reviewer must protect

1. **The `PII_KEYS` set is the allowlist of redacted keys — it must be additive only.** Never remove an entry to "clean up" logs. If a new PII-bearing field enters the schema (e.g. a new payment provider returns `card_token`), add it here in the same PR.
2. **Regexes must match the Bangladesh phone format the business actually uses.** The current pattern `(\+?88)?01[3-9]\d{8}` matches Bangladeshi mobile numbers with optional `+88`/`88` prefix. If you add international numbers, extend the pattern — don't weaken it to a generic "any digits" (that over-redacts and hides real data in debugging).
3. **Redaction must be deep, not shallow.** `scrubValue` recurses into nested objects and arrays. A "flatten then check" refactor that only inspects top-level keys would let `data: { customer: { phone: "..." } }` leak. Any change here must preserve recursion.
4. **Never log the raw value before scrubbing.** No `console.log("got", data); safeLog.info(...)` — the first call defeats the chokepoint. If you see a raw `console.*` in a diff, block it.
5. **`formatLog` must scrub both message and data.** A regression that only scrubs `data` (because "PII is always in structured fields") lets interpolated phone numbers in message strings leak.
6. **The email regex must stay case-insensitive (`/gi`).** Uppercase emails are valid and would otherwise bypass it.

---

## Known limitations (acceptable, but document any change)

- **Non-Bangladeshi phone numbers are not regex-redacted.** Acceptable today (market is Bangladesh). If the business goes international, the regex must widen or every phone field must rely on the key-based redaction (which it should, anyway).
- **Nested keys with names NOT in `PII_KEYS` but containing PII are only caught if they're strings matching the regex.** Example: `{ user: { contact: "01712345678" } }` — the key `contact` is not in `PII_KEYS`, but the regex catches the phone-shaped string. This is defense-in-depth, not a primary control. Prefer always using a redacted key name.
- **`raw_payload` in `payment_events` stores truncated provider responses** (sliced to 4000 chars in `recordWebhookReceipt`). That path is separate from this file; treat provider payloads as PII-laden by default.

---

## What breaks if this file is wrong

| Failure | Blast radius |
|---|---|
| A PII key removed from the set | That field leaks into every log line + R2 archive (7-year retention) + observability → data-protection incident. |
| Recursion replaced with shallow scan | Nested customer objects (address, phone in checkout) leak. |
| Raw `console.log` introduced in a handler | Bypasses scrubbing entirely → direct PII leak. |
| Email regex loses case-insensitivity | Uppercase emails leak. |
| Regex widened to "any digits" | Over-redaction hides real data → debugging blind spots, false confidence in logs. |

---

## Second-touch checklist (to raise bus factor to 2)

- [ ] Read this note and the source; explain why redaction is both key-based AND regex-based.
- [ ] Write a test: log `{customer: {phone: "01712345678", address: "Wari"}}` and assert the output contains `[REDACTED]`, not the digits. Also assert a message string containing an email is scrubbed.
- [ ] Grep the repo for any raw `console.log`/`console.error` outside this file and `safeLog` itself — flag violations (§25.1 lint rule).
- [ ] Make one small git touch so history records a second author on this file.
