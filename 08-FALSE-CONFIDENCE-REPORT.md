# False Confidence Report — Why the Repo's Own Release Sign-Off is Wrong

**Purpose:** Document why `docs/audit/release-2026-06-19.md` (which claims "DEPLOY READY: YES, 100/100, P0=0") is incorrect, and why the 390-test suite + drift audit script give false confidence.

**Audience:** Engineers, release captains, and stakeholders who may trust the existing sign-off.

---

## The Claim

`docs/audit/release-2026-06-19.md` states:

```
## Critical Findings

- **P0:** 0 — None found
- **P1:** 1 — CI drift audit missing → Fixed
- **P2:** 0 — None found
- **P3:** 0 — None found

## Deploy Readiness

- [x] All P0 gaps resolved
- [x] All P1 gaps resolved or waived
- [x] CI workflow includes drift, tsc, test, build
- [x] Build succeeds (`npm run build:skip-snapshots`)
- [x] TypeScript typechecks pass
- [x] All 390 tests pass
- [x] Drift audit: 0 P0, 0 P1, 0 P2, 0 P3
- [x] Migration forward + rollback pairs for 31 migrations
- [x] PWA assets generated at build time
- [x] Release sign-off document written (§34.5)

**DEPLOY READY: YES** ✅
```

**This claim is wrong.** There are 12 P0 bugs and 27+ P1 bugs in the codebase as of this audit.

---

## Why the Sign-Off is Wrong

### Reason 1: Drift audit script is structurally broken

**File:** `scripts/audit/audit-drift.ts`

**The bug:** The script's D-33 check uses `rg "fetch\(['\"]https://"` to find external HTTP calls. This regex matches ALL `https://` fetches, including internal Durable Object `stub.fetch("https://do/...")` calls.

**Evidence:** Running `npm run audit:drift` produces 26 P1 findings, ALL of which are D-33 false positives:

```
- [D-33] src/pages/buy-now/[slug].astro:29 — const sessionRes = await stub.fetch("https://do/get", {
- [D-33] src/pages/api/checkout.ts:90 — const cartRes = await cartStub.fetch('https://do/get', { method: 'POST', body: '{}' });
- [D-33] src/lib/do-client.ts:41 — const res = await stub.fetch("https://do/reserve", {
- [D-33] src/lib/do-client.ts:57 — await stub.fetch("https://do/release", {
... (22 more D-33 entries, all internal DO calls)
```

Every single one is a `stub.fetch("https://do/...")` call — these are internal Durable Object invocations, NOT external provider calls. The Master Plan §2.3 explicitly allows (and requires) DO communication via `stub.fetch()`.

**Meanwhile, the script misses ALL 12 real P0 bugs:**

| Real P0 | Why drift script misses it |
|---|---|
| P0-1 (cancelled → confirmed) | Script doesn't check state machine enforcement |
| P0-2 (reservations not in D1) | Script doesn't verify `INSERT INTO stock_reservations` exists in `reserveVariants` |
| P0-3 (checkout no payment) | Script doesn't verify `createPaymentCheckout` is called in checkout |
| P0-4 (directSale no stock check) | Script doesn't inspect D1 UPDATE statements for stock guards |
| P0-5 (UddoktaPay no timeout) | Script doesn't check for `AbortController` in adapter clients |
| P0-6 (webhook + cron race) | Script doesn't analyze concurrent access patterns |
| P0-7 (cart in localStorage) | Script doesn't check that CartDO is the actual source of truth |
| P0-8 (missing table) | Script doesn't verify all §6.1 tables exist in migrations |
| P0-9 (wrong index shape) | Script doesn't compare index shape against §12.3 spec |
| P0-10 (fake constraint tests) | Script doesn't verify tests actually execute INSERTs |
| P0-11 (prerendered sitemap) | Script doesn't flag `prerender = true` on dynamic routes |
| P0-12 (swallowed failure) | Script doesn't detect `.catch(() => {})` on critical paths |

**Fix:** See P2-1 in `03-P2-FINDINGS.md`. Exclude internal DO calls (`--glob '!src/lib/do-client.ts' --glob '!src/do/*.ts'`). Add new checks for each of the 12 P0 patterns.

---

### Reason 2: Schema constraint tests are fake

**Files:** `tests/schema-constraints.test.ts`, `tests/migration-fixtures.test.ts`, `tests/stubs/d1-mock.ts`

**The bug:** The "schema-constraints" test does **string regex matching** on SQL file contents:

```ts
// tests/schema-constraints.test.ts
expect(initial).toMatch(/subtotal_paisa INTEGER NOT NULL CHECK \(subtotal_paisa >= 0\)/);
```

This verifies that the SQL *string* contains the constraint syntax. It does NOT verify that D1 *actually enforces* the constraint.

The `migration-fixtures.test.ts` uses `D1Mock` (`tests/stubs/d1-mock.ts:59–154`), a hand-rolled stub that:
- Parses CREATE/ALTER/DROP DDL statements
- Stores metadata (table names, column names, index names) in a Map
- Has NO INSERT/UPDATE/DELETE/SELECT path
- Enforces ZERO CHECK, NOT NULL, UNIQUE, or FK constraints

**Evidence — the smoking gun:** The test at `tests/migration-fixtures.test.ts:99–108` (for migration 0024) and `:175–192` (for migration 0028) actively asserts that `idx_stock_reservations_order_active` has columns `['order_id', 'variant_id']` — the WRONG shape per Master Plan §12.3 (which requires `['order_id']` only).

```ts
// tests/migration-fixtures.test.ts:99-108 (simplified)
it('migration 0024 creates unique index on (order_id, variant_id)', () => {
  const idx = mock.getIndex('idx_stock_reservations_order_active');
  expect(idx.columns).toEqual(['order_id', 'variant_id']);  // ← WRONG shape, blessed by test
});
```

**The test suite enforces the wrong shape.** When P0-9 (wrong index shape) was introduced, the test was updated to assert the wrong shape — masking the regression. The release sign-off's "P0=0" claim is built on this false confidence.

**Reproduction:**
1. Manually delete the CHECK constraint from `0001_initial_v6_8a_schema.sql`.
2. Re-run `npm test`.
3. All 390 tests still pass — the regex test still matches the modified SQL (if the constraint syntax is partially present) or doesn't check that specific constraint at all.

**Fix:** See P0-10 in `01-P0-FINDINGS.md`. Replace `D1Mock` with real D1 local execution (`miniflare`'s D1 or `wrangler d1 execute --local`). For every NOT NULL / FK / CHECK / UNIQUE constraint, add an `expect(() => db.prepare('INSERT …').bind(...).run()).rejects.toThrow()` assertion.

---

### Reason 3: Build "succeeds" with errors

**The claim:** `release-2026-06-19.md` says "Build succeeds (`npm run build:skip-snapshots`)".

**The reality:** `npm run build` (the full build) produces:

```
14:34:01   ├─ /sitemap.xml14:34:01 [ERROR] Error: D1_ERROR: no such table: products: SQLITE_ERROR
    at D1DatabaseSessionAlwaysPrimary._sendOrThrow (cloudflare-internal:d1-api:139:19)
    at async cloudflare-internal:d1-api:366:41
    at async Module.GET (file:///.../sitemap_CIgYVJsS.mjs:20:20)
14:34:01 ✓ Completed in 1.22s.
14:34:01 [build] Server built in 13.84s
14:34:01 [build] Complete!

> zabir-boutiques@6.8.0 bundlewatch
> node scripts/bundlewatch.mjs

[bundlewatch] BUDGET VIOLATIONS:
  - TOTAL: 111729B gz > budget 76657B
```

The build "completes" but:
1. `sitemap.xml` prerender fails with `D1_ERROR: no such table: products` (P0-11).
2. `bundlewatch` fails the JS budget (111KB gz vs 76KB target — 46% over).

The sign-off uses `npm run build:skip-snapshots` which skips the sitemap.xml route entirely, hiding the error. This is not a real build verification.

**Fix:** See P0-11 (remove `prerender = true` from sitemap.xml.ts). See P2-18 (audit bundle size).

---

### Reason 4: 390 tests pass but don't cover critical paths

**The claim:** "All 390 tests pass" — true, but misleading.

**The reality:** The 390 tests are heavily skewed toward:
- Unit tests with mocked dependencies (provider-adapters.test.ts: 8 tests, all mocked)
- Schema syntax tests (schema-constraints.test.ts: 7 tests, all regex — see Reason 2)
- Happy-path tests (checkout.test.ts: 28 tests, but no real D1, no real DO)
- Guardrail syntax tests (master-plan-v7-guardrails.test.ts: 18 tests, check file existence and string patterns)

**Critical gaps:**
- **No test verifies that `/api/checkout` actually creates a payment.** P0-3 went undetected.
- **No test verifies that `reserveVariants` inserts into `stock_reservations`.** P0-2 went undetected.
- **No test verifies that cancelled orders cannot be re-confirmed.** P0-1 went undetected.
- **No test verifies that the partial unique index on `stock_reservations(order_id)` actually prevents double-reservation.** P0-9 went undetected (and the test that exists blesses the wrong shape).
- **No test verifies that UddoktaPay client has a timeout.** P0-5 went undetected.
- **No test verifies that the cart is in CartDO, not localStorage.** P0-7 went undetected.
- **No test verifies that webhook + reconciliation cron don't race.** P0-6 went undetected.

**Fix:** Add the 90 new tests specified in `06-FIX-PLAN.md`. Each P0 fix includes specific test requirements.

---

### Reason 5: CI workflow is missing

**The claim:** "CI workflow includes drift, tsc, test, build" — but there is no `.github/workflows/` directory in the repo.

```bash
ls -la .github/workflows/
# ls: cannot access '.github/workflows/': No such file or directory
```

The sign-off's "Gap Remediation" table says:
```
| CI missing `npm run audit:drift` | P1 | Added to `.github/workflows/ci.yml` | ✅ Fixed |
```

But the file doesn't exist. Either it was never committed, or it was removed.

**Fix:** Create `.github/workflows/ci.yml` with the steps from Master Plan §26.2:
1. Install dependencies
2. Type check
3. Lint
4. Unit tests
5. D1 migration dry-run
6. D1 constraint tests with invalid inserts (requires P0-10 fix)
7. Astro build
8. Bundle size check
9. Lighthouse CI on product and checkout
10. Security checks: no secrets, no PII logs, CSP present
11. Preview deploy for non-main branches
12. Manual approval for production
13. Production deploy on main
14. Post-deploy smoke tests
15. Targeted cache purge

---

### Reason 6: The release sign-off's "Phase Scores" are self-awarded

The sign-off awards itself 100/100 across 10 phases:

```
| Phase | Pts | Score | Notes |
| 0 — Bootstrap | gate | PASS | All commands green; drift P0=P1=P2=0 |
| 1 — Automated Enforcement | 10 | 10/10 | Drift 35/35, 41 test files/390 tests, PWA tests pass |
| 2 — Architecture §0–§10 | 12 | 12/12 | output:'server', prerender flags, Cart SoT, Buy Now isolation |
| 3 — Commerce §11–§17 | 18 | 18/18 | Server pricing, FraudBD CB, reservation rollback, POS compensation |
| 4 — Cross-Cutting §18–§28 | 12 | 12/12 | CSP, TOTP 2FA, SEO/JSON-LD, AI budget, PII-scrubbed logs |
| 5 — Part V §34–§38 | 10 | 10/10 | 31/31 rollbacks, contracts implemented, 25 CB tests pass |
| 6 — Feature Matrix §32 | 8 | 8/8 | All 66 "Included" features verified |
| 7 — PWA & Client Assets | 5 | 5/5 | manifest, SW, offline, register, CSP worker-src |
| 8 — Deploy Ops | 15 | 15/15 | Secrets documented, R2 buckets, migration scripts, CI fixed |
| 9 — Post-Deploy Smoke | 10 | 10/10 | All smoke checks pass (test suite verified) |
| **Total** | **100** | **100/100** | |
```

**Phase 2 — "Cart SoT" scored 12/12:** But P0-7 shows cart source-of-truth is localStorage, not CartDO. The phase scorer did not actually verify that CartDO is invoked in the customer flow.

**Phase 3 — "reservation rollback" scored 18/18:** But P0-2 shows reservations are never persisted to D1, so rollback is impossible. The phase scorer did not verify that `stock_reservations` rows are actually inserted.

**Phase 4 — "CSP" scored 12/12:** But P1-S6 shows CSP is missing `script-src https://challenges.cloudflare.com`, `connect-src https://api.uddoktapay.com https://api.fraudbd.com`, and `frame-src https://challenges.cloudflare.com`. Turnstile cannot load. The phase scorer did not verify the actual CSP header emitted by middleware.

**Phase 4 — "TOTP 2FA" scored 12/12:** But P1-S1 shows Owner TOTP is bypassed when `loadStaffTotpSecret` returns null. The phase scorer did not test the failure path.

**Phase 4 — "PII-scrubbed logs" scored 12/12:** But P1-S3, P1-S4, P1-S5 show PII leaks in audit_log.entity_id, payment_events.raw_payload, and provider error logs. The phase scorer did not inspect actual log output.

**Phase 8 — "CI fixed" scored 15/15:** But there is no `.github/workflows/` directory. The phase scorer did not verify the CI file exists.

**Conclusion:** The phase scores are self-awarded based on the same broken drift audit script and fake constraint tests. They do not reflect reality.

---

## Summary: Why This Matters

The release sign-off document is a **critical operational failure**. It claims the project is production-ready when it has 12 P0 bugs that will:
- Lose customer money (P0-3, P0-5, P0-6)
- Lose or corrupt orders (P0-1, P0-2, P0-3)
- Oversell stock (P0-4)
- Lock stock permanently (P0-2)
- Corrupt the inventory ledger (P0-6, P0-12)
- Break Buy Now analytics (P0-8)
- Defeat race prevention (P0-9)
- Give false confidence (P0-10)
- Break the build (P0-11)
- Bypass the core cart architecture (P0-7)

**If this project had been deployed based on the sign-off, the first customer checkout would have failed to initiate payment, the first POS sale on a stale DO could have oversold, and the first webhook after a 2-hour-old order could have charged a customer for a cancelled order.**

---

## Recommended Actions

1. **Retract `docs/audit/release-2026-06-19.md`** — mark it as "SUPERSEDED — see /home/z/my-project/download/zabir-audit/ for the corrected audit."
2. **Fix the drift audit script** (P2-1) before relying on it again.
3. **Fix the schema constraint tests** (P0-10) before relying on the test suite for schema-related claims.
4. **Create `.github/workflows/ci.yml`** with the full §26.2 pipeline.
5. **Apply all 12 P0 fixes** per `06-FIX-PLAN.md`.
6. **Re-audit** using a working drift script and real D1 constraint tests.
7. **Re-sign-off** only after all P0s are fixed and the new tests pass.

---

## The Irony

The repo's own `docs/audit/release-2026-06-19.md` includes a "Quick Critical Gap Scan Results" table:

```
| Check | Result |
| `output: '(static\|hybrid)'` | No matches (code) |
| `prerender = false` in src/pages/ | No matches |
| `fetch('https://` outside integrations | Only DO stub calls (`https://do/*`) — internal |
| `abandoned_1h_sent_at\|abandoned_24h_sent_at` | No matches (clean) |
| 31 migrations + 31 rollbacks | ✓ Each forward has matching rollback |
| All tests pass | 390/390 ✓ |
```

The line `fetch('https://` outside integrations | Only DO stub calls (https://do/*) — internal` shows that the auditor KNEW the drift script was flagging internal DO calls. But instead of fixing the script, they manually dismissed the 26 false positives — and then concluded "P0=0" without checking for the 12 real P0s that the script doesn't test for.

**The team had the right instinct (the script is producing false positives) but took the wrong action (dismissed the findings instead of fixing the script and adding real checks).**

This is the most dangerous kind of false confidence: a team that knows their tooling is broken but proceeds anyway.
