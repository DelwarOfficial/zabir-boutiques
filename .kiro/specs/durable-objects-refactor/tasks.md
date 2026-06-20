# DO Refactor Tasks

## Task 1: Create D1 Migration File

Create D1 migration with 3 new tables (guest_carts, checkout_sessions, provider_health).

**Subtasks:**
- Create migration file in `src/migrations/` (or Wrangler migration dir)
- Define guest_carts schema (sessionId PK, items JSON, lastUpdatedAt, version)
- Define checkout_sessions schema (sessionId PK, productId, variantId, quantity, options JSON, createdAt, deletedAt)
- Define provider_health schema (provider PK, state TEXT, lastFailureAt, failureCount, resetAt, updatedAt)
- Verify migration syntax
- Run migration in dev environment

**Success Criteria:**
- All 3 tables created in D1
- D1 explorer shows tables with correct columns
- Migration tag incremented (v5)

---

## Task 2: Update `src/lib/do-client.ts`

Remove DO types/helpers for CartDO, DirectCheckoutSessionDO, ProviderHealthDO. Add D1 equivalents.

**Subtasks:**
- Remove CartDO interface + doGetCart() + doUpdateCart() functions
- Remove DirectCheckoutSessionDO interface + doCreateCheckoutSession() + doGetCheckoutSession() functions
- Add D1 functions: dbGetCart(), dbSetCart(), dbDeleteCart()
- Add D1 functions: dbCreateCheckoutSession(), dbGetCheckoutSession(), dbDeleteCheckoutSession()
- Update doCheckProviderHealth() to query D1 instead of DO
- Update doRecordProviderResult() to update D1 instead of DO
- Keep VariantInventoryDO, IdempotencyDO, BudgetCounterDO, WafRules helpers unchanged
- Remove or stub CART_DO?, DIRECT_CHECKOUT_DO?, PROVIDER_HEALTH_DO? from DoEnv type

**Success Criteria:**
- No DO types for removed DOs
- All D1 helpers compile
- Existing DO clients (VariantInventoryDO, IdempotencyDO, etc.) unchanged
- Tests pass (or no TS errors)

---

## Task 3: Update `src/pages/api/cart/index.ts`

Replace CartDO with D1 + KV.

**Subtasks:**
- Replace DO binding check with D1 check
- Implement cart read: check KV (`SESSION` namespace), fallback to D1 query
- Implement cart write: update D1, invalidate KV
- Use KV TTL 30 min for cache
- Keep existing response structure unchanged
- Add error handling for D1 query failures

**Success Criteria:**
- GET /api/cart returns same structure as before
- POST /api/cart actions (add, remove, clear) work via D1
- KV caching speeds up reads
- No breaking API changes
- Tests pass

---

## Task 4: Update `src/pages/api/checkout.ts`

Replace CartDO load with D1.

**Subtasks:**
- Replace CART_DO binding check with DB check
- Change cart load: query D1 `guest_carts` by sessionId
- Keep existing validation + reservation logic unchanged
- After order creation, delete cart row from D1
- Keep response structure unchanged

**Success Criteria:**
- Checkout flow accepts same input as before
- Cart loaded from D1
- Cart deleted after order
- No breaking changes
- Tests pass

---

## Task 5: Update `src/pages/api/buy-now/session.ts`

Replace DirectCheckoutSessionDO creation with D1.

**Subtasks:**
- Replace DIRECT_CHECKOUT_DO binding check with DB check
- Change session create: insert into D1 `checkout_sessions`
- Generate sessionId server-side (HMAC or UUID)
- Return sessionId in response
- Keep response structure unchanged

**Success Criteria:**
- POST /api/buy-now/session returns same structure
- Session inserted into D1
- sessionId persists
- Tests pass

---

## Task 6: Update `src/pages/api/buy-now/submit.ts`

Replace DirectCheckoutSessionDO load + cleanup with D1.

**Subtasks:**
- Replace DIRECT_CHECKOUT_DO binding check with DB check
- Change session load: query D1 `checkout_sessions` by sessionId
- After order creation, softdelete session (set deletedAt = now)
- Keep existing checkout logic unchanged
- Keep response structure unchanged

**Success Criteria:**
- Checkout flow accepts same input as before
- Session loaded from D1
- Session softdeleted after order
- No breaking changes
- Tests pass

---

## Task 7: Update Provider Health in `src/lib/do-client.ts`

Update provider health circuit breaker to use D1 instead of DO.

**Subtasks:**
- Update doCheckProviderHealth() to query D1 `provider_health` table
- Update doRecordProviderResult() to update D1 (insert or update provider row)
- Implement circuit breaker logic: read state, if 'open' check resetAt, flip states as needed
- Keep circuit breaker behavior identical
- Add D1 error handling

**Success Criteria:**
- Circuit breaker logic unchanged (API same)
- D1 queries work
- All callers work unchanged
- Tests pass

---

## Task 8: Update Integration Clients (Turnstile, Tinify, Payments, Fraud)

Ensure integration clients work with new D1-based provider health.

**Subtasks:**
- `src/lib/turnstile.ts`: Replace PROVIDER_HEALTH_DO with DB in env type
- `src/lib/tinify.ts`: Replace PROVIDER_HEALTH_DO with DB in env type + calls
- `src/lib/payments.ts`: Replace PROVIDER_HEALTH_DO with DB in env type + calls
- `src/lib/fraud.ts`: Replace PROVIDER_HEALTH_DO with DB in env type + calls
- `src/lib/integrations/courier/types.ts`: Replace PROVIDER_HEALTH_DO with DB
- `src/lib/integrations/workers_ai/client.ts`: Replace DO calls with D1 helpers
- Verify no breaking changes to integration APIs

**Success Criteria:**
- All integration clients compile
- No DO references for ProviderHealthDO
- Tests pass
- Integrations call D1 helpers instead of DO

---

## Task 9: Add Cleanup Cron Jobs

Add scheduled cleanup for stale guest carts, checkout sessions, provider health.

**Subtasks:**
- Create or update cron handler in `src/entry-cloudflare.ts` (or cron handler file)
- Add job: clean guest_carts older than 30 min (0 * * * *)
- Add job: clean checkout_sessions older than 1 hr (0 2 * * *)
- Add job: reset provider_health 'open'→'half_open' if resetAt < now (0 3 * * *)
- Log cleanup stats (rows deleted)
- Handle D1 errors gracefully

**Success Criteria:**
- Cron jobs execute on schedule
- Stale rows deleted
- Logs show cleanup stats
- Tests pass

---

## Task 10: Verify Integration Tests

Run full checkout + payment flows to ensure no regressions.

**Subtasks:**
- Create test script: guest cart add/remove/checkout flow
- Create test script: buy-now session create + submit
- Create test script: payment integration (UddoktaPay) still works
- Create test script: courier integration still works
- Create test script: AI integration still works
- Run `npm test` to verify all existing tests pass
- Run manual testing on dev environment

**Success Criteria:**
- All tests pass
- No regressions
- Existing DO clients (VariantInventoryDO, IdempotencyDO, BudgetCounterDO, WafRules) work unchanged
- Guest flow: cart → checkout → order works
- Buy Now flow: session → submit → order works
- Payment integrations work

---

## Task 11: Deploy to Staging

Deploy refactored code to staging environment.

**Subtasks:**
- Verify all code changes merged + tested locally
- Deploy via GitHub Actions CI/CD to staging env
- Verify deployment succeeds (no error 10097)
- Smoke test: cart, buy-now, payment flows work
- Monitor staging logs for errors

**Success Criteria:**
- Staging deploy succeeds
- No Durable Objects error (10097)
- Smoke tests pass
- No runtime errors in logs

---

## Task 12: Deploy to Production

Deploy refactored code to production environment.

**Subtasks:**
- Final verification on staging
- Merge to main branch
- Deploy via GitHub Actions to production
- Monitor production logs for errors
- Verify orders still being created successfully
- Test manual: cart, buy-now, payment flows

**Success Criteria:**
- Production deploy succeeds
- No error 10097
- Orders being created
- Payment flows working
- No regressions observed
- Performance acceptable

---

## Rollback Plan

If deployment fails at any point:
1. Revert code changes (git rollback)
2. Revert wrangler.jsonc to include removed DOs
3. Upgrade CF account to Paid tier (if user chooses)
4. Redeploy with original config
