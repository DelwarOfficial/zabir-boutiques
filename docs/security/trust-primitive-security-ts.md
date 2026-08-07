# Design Note: `src/lib/security.ts` — Cryptographic Root of Trust

**Bus factor:** 1 (sole author: DelwarOfficial; last touched 2026-06-06)
**Why it matters:** Every other security control in the repo transitively trusts this file. The payment webhook's HMAC verification, the CSRF token validation, and any future signed-token flow all call `hmacSha256Hex` and `timingSafeEqualHex` from here. A bug or weakening here silently compromises the entire money flow and the staff mutation boundary.

---

## What it provides

Three primitives, all built on the Web Crypto API (`crypto.subtle`):

### 1. `timingSafeEqualHex(a, b)` — constant-time string comparison
```ts
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
```
- **Invariant:** comparison time does not depend on the values of the characters, only their count. This prevents timing side-channels that would let an attacker recover a signature one byte at a time.
- **The one subtlety:** the early `length` check *does* leak length. That is acceptable here because every caller compares equal-length hex digests (HMAC-SHA256 = 64 hex chars), so length is not a secret.

### 2. `generateRandomHex(byteLength)` — CSPRNG
- Uses `crypto.getRandomValues` (platform CSPRNG). Used for CSRF nonces and any random secret. Correct as written; the only requirement is that no caller ever seeds it with `Math.random`.

### 3. `hmacSha256Hex(value, secret)` — keyed hash
```ts
const key = await crypto.subtle.importKey('raw', ..., { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sig = await crypto.subtle.sign('HMAC', key, ...);
```
- Returns lowercase hex. **Invariant:** deterministic for the same `(value, secret)`; infeasible to forge without the secret.
- This is the *only* HMAC implementation in the repo. It backs both webhook verification (`verifyPaymentWebhookSignature`) and CSRF tokens (`createCsrfToken` / `verifyCsrfToken`).

---

## The invariants a reviewer must protect

1. **Never replace the comparison with `===` or `==`.** A `===` on hex signatures leaks a prefix match via timing and enables iterative signature forgery. If you see `a === b` in a diff touching this file, block it.
2. **Never change the hash from SHA-256 to a weaker/faster one** (e.g. MD5, SHA-1) without a written security review. SHA-256 is the floor.
3. **The HMAC key must come from a secret, never from user/request data.** All current callers pass `SESSION_SECRET` or a provider webhook secret — keep it that way.
4. **Do not short-circuit on mismatch.** The loop must run over the full string even after a difference is found. The `result |= ...` accumulator pattern is what makes it constant-time; do not "optimize" it into an early `return false`.

---

## What breaks if this file is wrong

| Failure | Blast radius |
|---|---|
| Timing leak in `timingSafeEqualHex` | Attacker forges UddoktaPay webhooks → marks orders paid without payment. Also forges CSRF tokens → staff endpoint takeover. |
| Weak hash / key confusion | Same as above — webhook forgery becomes trivial. |
| Non-CSPRNG randomness | CSRF nonces and any derived secrets become predictable → full staff-session forgery. |

---

## Second-touch checklist (to raise bus factor to 2)

- [ ] Read this note and the source until you can explain the constant-time property aloud.
- [ ] Write or extend a test: assert `timingSafeEqualHex` returns false for strings differing in one character, and that it does not throw on length mismatch.
- [ ] Make one small touch (a clarifying comment, a JSDoc example, or the test above) so git history records a second author.
- [ ] If you cannot run it locally, at minimum trace one call: webhook → `verifyPaymentWebhookSignature` → `hmacSha256Hex` + `timingSafeEqualHex`.
