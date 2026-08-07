# Design Note: `src/lib/csrf.ts` — CSRF Double-Submit Validation

**Bus factor:** 1 (sole author: delwarnetwork; last touched 2026-06-18)
**Why it matters:** Every state-changing staff request (`/api/staff/*` POST/PUT/PATCH/DELETE, `/staff/*` form posts) passes through `validateCsrfDoubleSubmit` in the middleware before reaching the handler. If it can be bypassed or weakened, a malicious third-party page can make the owner's browser create refunds, void invoices, adjust stock, or change staff roles — the entire staff mutation surface becomes cross-site forgeable.

---

## What it provides

A **double-submit cookie** pattern with an **HMAC-signed token**, split across two files:

- `lib/security.ts` — `createCsrfToken(secret)` and `verifyCsrfToken(token, secret)` (see that design note).
- `lib/csrf.ts` (this file) — the **wire protocol**: cookie reading, cookie setting, and the request-time validation that ties cookie + header + secret together.

### Token shape
```
<nonce>.<HMAC(nonce)>
```
- `nonce` = 32 random bytes (hex) from the CSPRNG.
- `HMAC(nonce)` = `hmacSha256Hex(nonce, SESSION_SECRET)`.
- The token is **independent of the session token** by design (see `lib/security.ts` header comment): an XSS that can read the non-HttpOnly `__Host-csrf-token` cookie *cannot* recover the session token. This is the key defense-in-depth property.

### Cookie attributes
```
__Host-csrf-token=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=...
```
- `__Host-` prefix → guaranteed Secure, no Domain, Path=/. Browsers refuse to set it over plain HTTP, so it cannot exist on a dev HTTP origin.
- `HttpOnly` → JS cannot read it. (Note: the middleware reads it server-side via `readStaffCsrfCookie`, not via `document.cookie`.)
- `SameSite=Strict` → not sent on cross-site requests at all, which is itself a CSRF defense.

### Validation — `validateCsrfDoubleSubmit(request, secret)`
```ts
const cookieToken = readCsrfCookie(request);
const headerToken = request.headers.get('X-CSRF-Token');
if (!cookieToken || !headerToken || cookieToken !== headerToken) return { ok: false, reason: 'token_mismatch' };
if (!secret || !(await verifyCsrfToken(cookieToken, secret))) return { ok: false, reason: 'invalid_signature' };
return { ok: true };
```
Three independent checks, all must pass:
1. **Presence** — both cookie and header exist.
2. **Equality** — the cookie token and header token are identical (the "double submit"). An attacker site cannot read the cookie (HttpOnly + same-origin), so it cannot construct a matching header.
3. **Signature** — the token's HMAC verifies against `SESSION_SECRET`. This stops an attacker from injecting a forged cookie value (e.g. via a subdomain write) that they then match with their own header.

---

## Where it's enforced

`src/middleware.ts` — the gate is:
```ts
if (STAFF_MUTATION_PATHS.test(pathname) && !SAFE_METHODS.has(method) && !CSRF_EXEMPT_PATHS.has(pathname)) {
  const csrf = await validateCsrfDoubleSubmit(request, SESSION_SECRET);
  if (!csrf.ok) return 403;
}
```
- `STAFF_MUTATION_PATHS = /^(?:/api/staff/|/staff/)/`
- `CSRF_EXEMPT_PATHS = {'/api/staff/login'}` — login is exempt because the CSRF cookie is issued *by* login.
- **Guest checkout (`/api/checkout`) is intentionally NOT CSRF-protected** — it's an unauthenticated public endpoint. Its protection is Turnstile + idempotency + server-authoritative pricing, not CSRF. Do not "add CSRF to checkout" without thinking through the unauthenticated caller case.

---

## The invariants a reviewer must protect

1. **Never remove any of the three checks.** Dropping the equality check reverts to single-submit (a subdomain cookie-injection bypass). Dropping the HMAC check lets any random string that matches cookie↔header pass. Both must stay.
2. **The token must stay independent of the session token.** Never derive the CSRF nonce from the session ID or a hash of it — that collapses the XSS→session-theft boundary the design relies on.
3. **Keep `SameSite=Strict` on the cookie.** Downgrading to `Lax` reopens cross-site POST exposure (Lax sends cookies on top-level GETs but the threat model includes staff landing on attacker pages). Strict is correct here because staff are on a single origin.
4. **Never exempt a new state-changing staff route from CSRF** without a written threat-model note. The exempt set should grow very slowly.
5. **`SESSION_SECRET` must be present in production.** If it's missing, `validateCsrfDoubleSubmit` returns `{ok:false, reason:'invalid_signature'}` — staff mutations fail closed. Do not "fix" an env issue by skipping the check when the secret is absent.

---

## What breaks if this file is wrong

| Failure | Blast radius |
|---|---|
| Equality check removed | Subdomain cookie-injection → attacker forges any staff mutation (refund, stock adjust, role change). |
| HMAC check removed | Any value that matches cookie↔header passes → CSRF fully defeated if a cookie can be planted. |
| Token derived from session token | XSS that reads the CSRF cookie can derive/forge the session → account takeover. |
| A new route exempted carelessly | That route becomes cross-site forgeable. |
| Secret missing and check skipped | Silent CSRF disable in a misconfigured env. |

---

## Second-touch checklist (to raise bus factor to 2)

- [ ] Read this note and both files (`lib/csrf.ts`, `lib/security.ts`); explain aloud why the token is *not* derived from the session token.
- [ ] Write a test: a request with matching cookie+header but wrong HMAC signature must fail with `invalid_signature`; a request with header but no cookie must fail with `token_mismatch`.
- [ ] Confirm the exempt set is still just `/api/staff/login`; flag any drift.
- [ ] Make one small git touch so history records a second author on this file.
