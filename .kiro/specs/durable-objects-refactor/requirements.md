# DO Refactor Requirements

## Context

Cloudflare Workers free plan does not support Durable Objects (DO). Removing 3 non-critical DOs (CartDO, DirectCheckoutSessionDO, ProviderHealthDO) while retaining 4 critical DOs (VariantInventoryDO, IdempotencyDO, BudgetCounterDO, WafRules) that require SQLite persistence.

## Requirement 1: Replace CartDO with D1 + KV

**User Story:** Guest cart sessions must persist across requests without DO, using D1 for data durability and KV for fast lookups.

**Acceptance Criteria:**
1. Cart state shall be stored in D1 `guest_carts` table (sessionId, items, lastUpdatedAt, version).
2. Fast reads shall use KV `SESSION` namespace with TTL (30 min).
3. `src/pages/api/cart/index.ts` shall load/update cart via D1, invalidate KV on write.
4. CartDO helpers in `src/lib/do-client.ts` shall be removed or stubbed.
5. `src/pages/api/checkout.ts` cart load shall use D1 query instead of DO.

## Requirement 2: Replace DirectCheckoutSessionDO with D1

**User Story:** Buy Now checkout sessions must persist as D1 records with automatic cleanup.

**Acceptance Criteria:**
1. Session state shall be stored in D1 `checkout_sessions` table (sessionId, productId, variantId, quantity, options, createdAt).
2. `src/pages/api/buy-now/session.ts` create endpoint shall insert into D1, return sessionId.
3. `src/pages/api/buy-now/submit.ts` load endpoint shall query D1 by sessionId, soft-delete after successful order.
4. DirectCheckoutSessionDO helpers in `src/lib/do-client.ts` shall be removed or stubbed.
5. Stale sessions (>1hr old) shall be cleaned via scheduled cron job.

## Requirement 3: Replace ProviderHealthDO with D1

**User Story:** Circuit breaker state for payment/courier/AI providers shall persist in D1 instead of DO.

**Acceptance Criteria:**
1. Health status shall be stored in D1 `provider_health` table (provider, state, lastFailureAt, failureCount, resetAt).
2. Circuit breaker logic remains identical; reads/writes use D1 instead of DO.
3. `doCheckProviderHealth()` and `doRecordProviderResult()` in `src/lib/do-client.ts` shall query/update D1.
4. All integration callers (UddoktaPay, FraudBD, Courier, Workers AI) shall work unchanged.
5. Stale health records (>24hrs, state='closed') shall be cleaned via cron job.

## Requirement 4: Update wrangler.jsonc

**User Story:** Configuration shall reflect only the 4 critical DOs that remain.

**Acceptance Criteria:**
1. Root `durable_objects.bindings` shall list only: VariantInventoryDO, IdempotencyDO, BudgetCounterDO, WafRules.
2. Migrations v3–v4 (CartDO, DirectCheckoutSessionDO, ProviderHealthDO) shall be removed.
3. All env configs (prod, staging, dev) shall match root.
4. No breaking changes to existing DO clients (VariantInventoryDO, IdempotencyDO, BudgetCounterDO, WafRules).

## Requirement 5: Create D1 Schema Migrations

**User Story:** New tables for cart, checkout_sessions, provider_health shall be created via D1 migrations.

**Acceptance Criteria:**
1. Migration file creates `guest_carts` table with (sessionId PK, items JSON, lastUpdatedAt, version).
2. Migration file creates `checkout_sessions` table with (sessionId PK, productId, variantId, quantity, options JSON, createdAt, deletedAt).
3. Migration file creates `provider_health` table with (provider PK, state, lastFailureAt, failureCount, resetAt).
4. Migration runs successfully in dev/staging/prod envs.
5. Existing tables (carts, orders, variants, etc.) remain unchanged.

## Requirement 6: Cleanup Cron Jobs

**User Story:** Stale session and health records shall be auto-cleaned by scheduled jobs.

**Acceptance Criteria:**
1. Cron job (0 * * * *) cleans guest_carts older than 30 min.
2. Cron job (0 2 * * *) cleans checkout_sessions older than 1 hr and deleted_at < now.
3. Cron job (0 3 * * *) cleans provider_health where resetAt < now and state='closed'.
4. Jobs log cleanup stats to audit or diagnostic table.

## Requirement 7: Verify No Breaking Changes

**User Story:** Core checkout, payment, inventory, and AI/courier integrations shall work unchanged.

**Acceptance Criteria:**
1. Existing DO clients (VariantInventoryDO, IdempotencyDO, BudgetCounterDO, WafRules) unchanged.
2. All existing API endpoints return same response structure.
3. All integration tests pass.
4. Production deploy succeeds (error 10097 resolved).
