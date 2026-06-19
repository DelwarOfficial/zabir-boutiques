# Verification Commands — Zabir Boutiques V7 Audit

**Purpose:** Commands to verify each P0 fix. Run these after applying each fix to confirm the bug is resolved.

**Prerequisites:**
- `npm install` completed (473 packages)
- `npm run typecheck` passes
- `npm test` passes (390/390 — false-confidence baseline; will grow as real tests are added)

---

## Baseline (before any fixes)

```bash
cd /home/z/my-project/audit/zabir-boutiques

# Type check
npm run typecheck

# Run all tests
npm test

# Build (currently fails on sitemap.xml and bundlewatch)
npm run build 2>&1 | tail -50

# Drift audit (currently produces 26 false positives)
npm run audit:drift 2>&1 | tail -10
```

---

## P0-1 · Cancelled orders can be re-confirmed

### Verify fix

```bash
# Run the new tests
npx vitest run tests/order-state-machine.test.ts

# Manual verification (requires running dev server):
# 1. Create an order via POST /api/checkout
# 2. Cancel it via POST /api/staff/orders/{id}/cancel
# 3. POST /api/staff/orders/{id}/confirm
# 4. Verify: 409 response with code='INVALID_TRANSITION'
# 5. Verify: audit_log has row with action='order.invalid_transition'
```

### Verify rollback
```bash
git revert <commit-hash>
npm test  # Should still pass 390/390 (no regression)
```

---

## P0-2 · Stock reservations not persisted to D1

### Verify fix

```bash
# Run the extended reservation lifecycle tests
npx vitest run tests/reservation-lifecycle.test.ts

# Manual verification (requires D1 local):
# 1. Apply migrations: npm run db:migrate:local
# 2. Trigger a checkout (mock insertReservedOrderWithRetry to throw)
# 3. Query: wrangler d1 execute zabir-db --local --command "SELECT * FROM stock_reservations"
# 4. Verify: 1 row per cart item with status='active'
# 5. Run the hourly cleanup cron
# 6. Query: SELECT * FROM stock_reservations
# 7. Verify: rows have status='released'
```

### Verify rollback
```bash
git revert <commit-hash>
npm test  # Should pass (tests added in this fix will fail after rollback — that's expected)
```

---

## P0-3 · Standard checkout never initiates UddoktaPay payment

### Verify fix

```bash
# Run the new checkout-payments tests
npx vitest run tests/checkout-payments.test.ts

# Manual verification (requires dev server + UddoktaPay sandbox):
# 1. POST /api/checkout with body:
#    {
#      "cart": [{"variant_id": "v1", "quantity": 1}],
#      "customer": {"name": "Test", "phone": "+8801711111111", "address": "Dhaka"},
#      "payment_method": "uddoktapay",
#      "session_id": "test-session"
#    }
# 2. Verify: response has checkout_url field
# 3. Query: wrangler d1 execute zabir-db --local --command "SELECT * FROM payments WHERE order_id='<order_id>'"
# 4. Verify: 1 row with status='pending'
# 5. Query: SELECT payment_status FROM orders WHERE id='<order_id>'
# 6. Verify: payment_status='pending'
```

### Verify rollback
```bash
git revert <commit-hash>
# After rollback, the new tests will fail (expected — the bug is back)
```

---

## P0-4 · POS directSale no stock check

### Verify fix

```bash
# Run the extended inventory tests
npx vitest run tests/inventory.test.ts

# Manual verification (requires D1 local + DO bound):
# 1. Setup: variant with quantity=1, reserved=0, sold=1
# 2. Call doDirectSale with qty=1
# 3. Verify: returns { ok: false, error: 'INSUFFICIENT_STOCK' }
# 4. Verify: sold_quantity still = 1 (not incremented)
```

### Verify rollback
```bash
git revert <commit-hash>
npm test  # Should pass (new tests will fail after rollback — expected)
```

---

## P0-5 · UddoktaPay client has no timeout

### Verify fix

```bash
# Run the extended provider-adapters tests
npx vitest run tests/provider-adapters.test.ts

# Manual verification:
# 1. Point UddoktaPay base URL at a slow server (nc -l 8080)
# 2. Trigger a webhook
# 3. Verify: webhook returns within ~10s (not hung indefinitely)
# 4. Verify: queue consumer logs error_code='TIMEOUT'
```

### Verify rollback
```bash
git revert <commit-hash>
npm test  # Should pass
```

---

## P0-6 · Webhook + reconciliation cron race

### Verify fix

```bash
# Run the extended payments tests
npx vitest run tests/payments.test.ts

# Manual verification (requires D1 local + mocked UddoktaPay):
# 1. Create order with payment_status='pending', age=2h+1min
# 2. Run reconciliation cron
# 3. Verify: order.status='cancelled' (cron cancelled it)
# 4. Fire webhook with paid event
# 5. Verify: payments.status='paid' (webhook recorded payment)
# 6. Verify: orders.status='cancelled' (NOT payment_verified — cron already cancelled)
# 7. Verify: stock_reservations.status='released' (NOT confirmed — guard worked)
# 8. Verify: audit_log has reconciliation.payment_missed entry
```

### Verify rollback
```bash
git revert <commit-hash>
npm test  # Should pass
```

---

## P0-7 · Cart source-of-truth is localStorage

### Verify fix

```bash
# Run the new cart-do tests
npx vitest run tests/cart-do.test.ts

# Manual verification (requires dev server):
# 1. Open site in Browser A, add item to cart
# 2. Open site in Browser B (different browser), verify cart is empty (different session)
# 3. In Browser A, open DevTools → Application → Local Storage
# 4. Verify: no zb_cart_v68a key (or it's empty / unused)
# 5. In Browser A, open DevTools → Application → Cookies
# 6. Verify: __Host-cart-session cookie exists
# 7. Query: wrangler d1 execute zabir-db --local --command "SELECT COUNT(*) FROM cart_activity"
# 8. Verify: count > 0 (cart_activity is now populated)

# Cross-tab test:
# 1. Open site in Tab A, add item X
# 2. Open site in Tab B (same browser), verify item X is visible
# 3. In Tab B, add item Y
# 4. Verify: Tab A shows both X and Y (after storage event refresh)

# Persistence test:
# 1. Add items to cart
# 2. Clear localStorage (DevTools → Application → Local Storage → Clear)
# 3. Refresh page
# 4. Verify: cart still has items (CartDO is authority, not localStorage)
```

### Verify rollback
```bash
git revert <commit-hash>
# After rollback, cart reverts to localStorage. Existing CartDO sessions are orphaned.
npm test  # Should pass
```

---

## P0-8 · `direct_checkout_activity` table missing

### Verify fix

```bash
# Apply the new migration locally
npm run db:migrate:local

# Verify table exists
wrangler d1 execute zabir-db --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='direct_checkout_activity'"
# Expected: direct_checkout_activity

# Verify schema
wrangler d1 execute zabir-db --local --command ".schema direct_checkout_activity"

# Run the migration tests
npx vitest run tests/migration-fixtures.test.ts

# Manual verification:
# 1. Trigger a Buy Now flow
# 2. wrangler d1 execute zabir-db --local --command "SELECT * FROM direct_checkout_activity"
# 3. Verify: rows present with event_type='buy_now_landing_viewed' etc.
```

### Verify rollback
```bash
# Run the rollback
wrangler d1 execute zabir-db --local --file=db/migrations/rollback/0032_rollback_create_direct_checkout_activity.sql

# Verify table dropped
wrangler d1 execute zabir-db --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='direct_checkout_activity'"
# Expected: no rows
```

---

## P0-9 · Partial unique index has wrong shape

### Verify fix

```bash
# Apply the new migration locally
npm run db:migrate:local

# Verify index shape
wrangler d1 execute zabir-db --local --command "PRAGMA index_info(idx_stock_reservations_order_active)"
# Expected: 1 row (cids=[0] for order_id only, NOT [0,1] for order_id+variant_id)

# Run the migration tests
npx vitest run tests/migration-fixtures.test.ts

# Run the schema constraint tests (requires P0-10 fix)
npx vitest run tests/schema-constraints.test.ts

# Manual verification:
# 1. INSERT INTO stock_reservations (id, order_id, variant_id, quantity, status, created_at, updated_at)
#    VALUES ('r1', 'order1', 'v1', 1, 'active', 'now', 'now');
# 2. INSERT INTO stock_reservations (id, order_id, variant_id, quantity, status, created_at, updated_at)
#    VALUES ('r2', 'order1', 'v2', 1, 'active', 'now', 'now');
# 3. Verify: second INSERT fails with UNIQUE constraint violation
```

### Verify rollback
```bash
wrangler d1 execute zabir-db --local --file=db/migrations/rollback/0033_rollback_fix_stock_reservations_index_shape.sql

# Verify index reverted (wrong shape)
wrangler d1 execute zabir-db --local --command "PRAGMA index_info(idx_stock_reservations_order_active)"
# Expected: 2 rows (cids=[0,1] for order_id+variant_id)
```

---

## P0-10 · Schema constraint tests are fake

### Verify fix

```bash
# Run the rewritten schema-constraints tests (should use real D1)
npx vitest run tests/schema-constraints.test.ts

# Verify D1Mock is no longer used
grep -r "D1Mock" tests/
# Expected: no matches (or only in deprecated stubs/ directory)

# Verify real D1 is used
grep -r "miniflare\|wrangler d1" tests/
# Expected: matches in test helpers
```

### Manual verification of constraint enforcement

```bash
# Apply migrations locally
npm run db:migrate:local

# Test NOT NULL constraint
wrangler d1 execute zabir-db --local --command "INSERT INTO orders (id, subtotal_paisa) VALUES ('test', NULL)"
# Expected: SQLITE_CONSTRAINT_NOT_NULL error

# Test CHECK constraint
wrangler d1 execute zabir-db --local --command "INSERT INTO orders (id, subtotal_paisa) VALUES ('test', -100)"
# Expected: SQLITE_CONSTRAINT_CHECK error

# Test UNIQUE constraint (after P0-9 fix)
wrangler d1 execute zabir-db --local --command "INSERT INTO stock_reservations (id, order_id, variant_id, quantity, status, created_at, updated_at) VALUES ('r1', 'order1', 'v1', 1, 'active', 'now', 'now')"
wrangler d1 execute zabir-db --local --command "INSERT INTO stock_reservations (id, order_id, variant_id, quantity, status, created_at, updated_at) VALUES ('r2', 'order1', 'v2', 1, 'active', 'now', 'now')"
# Expected: second INSERT fails with SQLITE_CONSTRAINT_UNIQUE
```

### Verify rollback
```bash
git revert <commit-hash>
# After rollback, schema-constraints tests revert to regex matching (false confidence returns)
npm test  # Should pass 390/390 (false baseline)
```

---

## P0-11 · `sitemap.xml.ts` prerendered

### Verify fix

```bash
# Verify prerender = true is removed
grep "prerender" src/pages/sitemap.xml.ts
# Expected: no matches

# Run build (should succeed without D1 binding)
npm run build 2>&1 | grep -E "D1_ERROR|sitemap"
# Expected: no D1_ERROR lines; sitemap.xml is built dynamically (not prerendered)

# Manual verification (requires dev server):
# 1. Visit /sitemap.xml
# 2. Verify: valid XML returned
# 3. Verify: products are listed (from D1 fallback or R2)
```

### Verify rollback
```bash
git revert <commit-hash>
npm run build 2>&1 | grep "D1_ERROR"
# Expected: D1_ERROR returns (bug is back)
```

---

## P0-12 · POS voidInvoice swallows reverseDirectSale failure

### Verify fix

```bash
# Run the extended pos-invoices tests
npx vitest run tests/pos-invoices.test.ts

# Manual verification (requires D1 local + DO bound):
# 1. Create a POS invoice with 2 items
# 2. Mock doReverseDirectSale to throw on first item
# 3. Call voidInvoice
# 4. Verify: response is error
# 5. Query: SELECT * FROM audit_log WHERE action='pos_void_reversal_failure'
# 6. Verify: 1 row with severity='P0'
# 7. Verify: metadata.compensationFailures has entries (if compensation also failed)
```

### Verify rollback
```bash
git revert <commit-hash>
npm test  # Should pass (new tests will fail after rollback — expected)
```

---

## Full Test Suite (after all P0 fixes)

```bash
# Run all tests
npm test

# Expected: 390 + (new tests added for each P0 fix) all pass
# New tests added:
# - tests/order-state-machine.test.ts (P0-1: +4 tests)
# - tests/reservation-lifecycle.test.ts (P0-2: +4 tests)
# - tests/checkout-payments.test.ts (P0-3: +5 tests)
# - tests/inventory.test.ts (P0-4: +4 tests)
# - tests/provider-adapters.test.ts (P0-5: +4 tests)
# - tests/payments.test.ts (P0-6: +4 tests)
# - tests/cart-do.test.ts (P0-7: +5 tests)
# - tests/migration-fixtures.test.ts (P0-8: +3 tests)
# - tests/schema-constraints.test.ts (P0-9: +3 tests, P0-10: +50 tests)
# - tests/build.test.ts (P0-11: +1 test)
# - tests/pos-invoices.test.ts (P0-12: +3 tests)
# Total new tests: ~90

# Type check
npm run typecheck

# Build (should succeed)
npm run build 2>&1 | tail -20
# Expected: no D1_ERROR; bundlewatch may still fail (P2-18 not in P0 scope)

# Drift audit (after fixing the script per P2-1)
npm run audit:drift 2>&1 | tail -10
# Expected: P0=0, P1=<reduced count> (false positives fixed)
```

---

## Migration Verification

```bash
# List all migrations
ls db/migrations/*.sql | sort

# Verify all have rollbacks
ls db/migrations/rollback/*.sql | sort

# Apply migrations locally
npm run db:migrate:local

# Check migration status
npm run migrate:status

# Verify schema_migrations ledger is populated
wrangler d1 execute zabir-db --local --command "SELECT * FROM schema_migrations ORDER BY version"
# Expected: 33 rows (0001-0033) after all P0 fixes

# Verify critical tables exist
wrangler d1 execute zabir-db --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
# Expected: includes direct_checkout_activity, stock_reservations, cart_activity, etc.

# Verify critical indexes
wrangler d1 execute zabir-db --local --command "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name"
# Expected: includes idx_stock_reservations_order_active, idx_cart_activity_abandoned, idx_cart_activity_email
```

---

## Forbidden Pattern Scans

```bash
# Verify no output: 'static' or 'hybrid' in src/
rg "output:\s*['\"](?:static|hybrid)['\"]" src/ astro.config.mjs
# Expected: no matches

# Verify no prerender = false in src/pages/
rg "prerender\s*=\s*false" src/pages/
# Expected: no matches

# Verify no localStorage cart as source of truth (after P0-7 fix)
rg "localStorage\.(get|set)Item.*cart" src/
# Expected: no matches (or only in deprecated useLocalCart.ts)

# Verify no client-supplied price trusted (after P0-7 fix)
rg "client.*price|price.*client" src/islands/
# Expected: no matches in cart-related islands

# Verify no money stored as float/real/double in migrations
rg -i "REAL|FLOAT|DOUBLE" db/migrations/ --glob '!*.md'
# Expected: only sitemap_metadata.priority (not money)

# Verify UddoktaPay client has AbortController (after P0-5 fix)
grep "AbortController" src/lib/integrations/uddoktapay/client.ts
# Expected: 3 matches (one per fetch call)
```

---

## Production Readiness Checklist (after all P0 + P1 fixes)

```bash
# 1. All tests pass
npm test  # Expected: 480+ tests pass (390 baseline + 90 new)

# 2. Type check passes
npm run typecheck

# 3. Build succeeds
npm run build  # Expected: no D1_ERROR

# 4. Drift audit clean
npm run audit:drift  # Expected: P0=0, P1=0 (after P2-1 fix)

# 5. Migrations apply cleanly
npm run db:migrate:local
npm run migrate:status  # Expected: all 33+ migrations applied

# 6. Forbidden patterns clean
rg "output:\s*['\"](?:static|hybrid)['\"]" src/  # No matches
rg "prerender\s*=\s*false" src/pages/  # No matches
rg "localStorage\.(get|set)Item.*cart" src/  # No matches

# 7. Bundlewatch budget met (after P2-18 fix)
npm run bundlewatch  # Expected: PASS

# 8. CSP includes all required origins (after P1-S6 fix)
# Manual: inspect Network tab in browser, verify CSP header includes:
# - script-src https://challenges.cloudflare.com
# - connect-src https://api.uddoktapay.com https://api.fraudbd.com
# - frame-src https://challenges.cloudflare.com

# 9. All Cloudflare Secrets set
# Manual: wrangler secret list — verify all secrets are present

# 10. REPLACE_WITH_ placeholders filled in wrangler.jsonc
# Manual: grep "REPLACE_WITH" wrangler.jsonc — expected: no matches

# 11. Zero Trust Access configured for /staff/* and /api/staff/*
# Manual: Cloudflare dashboard → Zero Trust → Applications

# 12. WAF rules configured
# Manual: Cloudflare dashboard → Security → WAF
```

If all 12 items pass, the project is production-ready. If any fail, address before deploy.
