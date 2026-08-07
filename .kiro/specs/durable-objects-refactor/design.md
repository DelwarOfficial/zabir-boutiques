# DO Refactor Design

## Overview

Replace 3 non-critical DOs (CartDO, DirectCheckoutSessionDO, ProviderHealthDO) with D1 + KV equivalents. Retain 4 critical DOs (VariantInventoryDO, IdempotencyDO, BudgetCounterDO, WafRules) for atomic SQLite operations.

## Architecture

### 1. Guest Cart (CartDO → D1 + KV)

**Flow:**
- Guest adds items → write to D1 `guest_carts` table, cache in KV `SESSION` (30min TTL)
- Guest reads cart → read from KV (fast), fallback to D1 if expired
- Checkout → query D1 `guest_carts`, reserve variants via VariantInventoryDO, insert order, delete cart row

**Schema:**
```sql
CREATE TABLE guest_carts (
  sessionId TEXT PRIMARY KEY,
  items JSON NOT NULL,  -- [{variantId, quantity}, ...]
  lastUpdatedAt TEXT NOT NULL,  -- ISO 8601
  version INTEGER NOT NULL
);
```

**KV Key:** `cart:{sessionId}` → JSON { items, version, expiry }

### 2. Buy Now Session (DirectCheckoutSessionDO → D1)

**Flow:**
- Buy Now creates session → insert D1 `checkout_sessions`, return sessionId
- Buy Now loads session → query D1 `checkout_sessions` by sessionId
- Buy Now confirms order → softdelete session (set deletedAt), create order

**Schema:**
```sql
CREATE TABLE checkout_sessions (
  sessionId TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  variantId TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  selectedOptions JSON,
  sourcePage TEXT,
  utmParams JSON,
  createdAt TEXT NOT NULL,
  deletedAt TEXT
);
```

**Cleanup:** Cron deletes rows where deletedAt < now - 1hr OR (createdAt < now - 1hr AND deletedAt IS NULL).

### 3. Provider Health (ProviderHealthDO → D1)

**Flow:**
- Circuit breaker checks health → query D1 `provider_health` for provider
- Payment/courier/AI integration fails → record result in D1 (increment failureCount, update lastFailureAt, possibly flip state to 'open')
- Circuit opener (hourly) → scan D1, reset 'open' to 'half_open' if resetAt < now, check health on half_open

**Schema:**
```sql
CREATE TABLE provider_health (
  provider TEXT PRIMARY KEY,
  state TEXT NOT NULL,  -- 'closed', 'open', 'half_open'
  lastFailureAt TEXT,
  failureCount INTEGER DEFAULT 0,
  resetAt TEXT,
  updatedAt TEXT NOT NULL
);
```

**Defaults:**
- state='closed', failureCount=0, resetAt=null (new provider)

### 4. wrangler.jsonc Updates

**Remove from all envs (root, prod, staging, dev):**
```json
{
  "name": "CART_DO",
  "class_name": "CartDO"
},
{
  "name": "DIRECT_CHECKOUT_DO",
  "class_name": "DirectCheckoutSessionDO"
},
{
  "name": "PROVIDER_HEALTH_DO",
  "class_name": "ProviderHealthDO"
}
```

**Remove migrations v3–v4:**
```json
{ "tag": "v3", "new_classes": ["CartDO"] },
{ "tag": "v4", "new_classes": ["DirectCheckoutSessionDO", "ProviderHealthDO"] }
```

**Keep only:**
- VariantInventoryDO (inventory reservation)
- IdempotencyDO (payment dedup)
- BudgetCounterDO (AI budget)
- WafRules (security rules cache)

### 5. Code Changes by File

#### `src/pages/api/cart/index.ts`
- Replace DO fetches with D1 queries
- Use KV for fast reads with 30min TTL
- Invalidate KV on write

#### `src/pages/api/checkout.ts`
- Load cart from D1 instead of DO
- Delete cart row after order insertion

#### `src/pages/api/buy-now/session.ts`
- Insert checkout_sessions into D1
- Return sessionId

#### `src/pages/api/buy-now/submit.ts`
- Load session from D1
- Softdelete session after order

#### `src/lib/do-client.ts`
- Remove CartDO types/helpers
- Remove DirectCheckoutSessionDO types/helpers
- Update ProviderHealthDO helpers to use D1 queries
- Add D1 query helpers for new tables

#### `src/lib/turnstile.ts`, `src/lib/tinify.ts`, `src/lib/payments.ts`, `src/lib/fraud.ts`
- Replace DO provider health calls with D1 equivalents
- No logic changes

#### Integration clients (courier, workers_ai, etc.)
- No changes (helpers handle D1 internally)

### 6. Cron Jobs

Add to `src/entry-cloudflare.ts` (or scheduled handler):

1. **Guest cart cleanup (0 * * * *):**
   ```typescript
   DELETE FROM guest_carts WHERE lastUpdatedAt < DATE('now', '-30 minutes');
   ```

2. **Checkout session cleanup (0 2 * * *):**
   ```typescript
   DELETE FROM checkout_sessions
   WHERE deletedAt < DATE('now', '-1 hour')
      OR (createdAt < DATE('now', '-1 hour') AND deletedAt IS NULL);
   ```

3. **Provider health cleanup (0 3 * * *):**
   ```typescript
   DELETE FROM provider_health
   WHERE state = 'closed' AND resetAt < DATE('now');
   
   UPDATE provider_health
   SET state = 'half_open', resetAt = NULL
   WHERE state = 'open' AND resetAt < DATE('now');
   ```

### 7. Testing Strategy

1. **Unit tests:** Mock D1/KV, verify cart/session operations
2. **Integration tests:** Deploy to dev env, test cart + checkout flows
3. **Regression tests:** Verify existing DO clients (VariantInventoryDO, IdempotencyDO, etc.) still work
4. **Load tests:** Verify D1 can handle cart read/write volume (concurrent guests)

## Migration Path

1. ✅ Update wrangler.jsonc (remove DO bindings + migrations v3–v4)
2. Create D1 migration file (new tables)
3. Update `do-client.ts` (new D1 helpers, stub removed DO types)
4. Update cart API (`src/pages/api/cart/index.ts`)
5. Update checkout API (`src/pages/api/checkout.ts`)
6. Update buy-now API (`src/pages/api/buy-now/session.ts` + `submit.ts`)
7. Update integration clients (turnstile, tinify, payments, fraud, courier, workers_ai)
8. Add cron cleanup jobs
9. Test & deploy

## Rollback

If deployment fails:
- Revert wrangler.jsonc to include removed DOs
- Upgrade CF account to Paid tier
- Redeploy with original config
