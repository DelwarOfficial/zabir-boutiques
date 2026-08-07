# V8 Migration Plan — Zabir Boutiques

**Status:** Authoritative. This file is the standalone form of Section 35 of the Master Plan. Where this file and Section 35 differ, this file wins.
**Date:** 2026-08-07
**Repository head at time of writing:** `db/migrations/0033_direct_checkout_activity.sql`. The next free number is **0034**.

---

## 0. Rules That Govern Every Migration Here

1. **One statement per file.** D1 migrations are not transactional. A two-statement file can half-apply and leave a schema that the diff script accepts and the code does not expect.
2. **Numbering is against the repository, not against a document.** There is no plan-number-to-repo-number mapping. `NNNN` is exactly one greater than the highest number in `db/migrations/`.
3. **Every migration has three files:**
   - `db/migrations/{NNNN}_{slug}.sql`
   - `db/migrations/rollback/{NNNN}_{slug}.rollback.sql`
   - `db/migrations/preflight/{NNNN}_{slug}.preflight.sql`
4. **A pre-flight is a query that returns zero rows when it is safe to apply.** A `PRAGMA` followed by "inspect the result" is not a pre-flight.
5. **Risk is rated against a non-empty production database.** This is an existing production system, not a greenfield build. "Additive table, no existing data touched" is not automatically Low when the table carries a foreign key into live data.
6. **Never edit an applied migration.** Supersede it with a new one.
7. Money is integer paisa in every column added here.

### Risk classes

| Class | Meaning | Soak |
|---|---|---|
| Low | Additive, no FK into live data, no uniqueness added over existing rows | None |
| Medium | Adds a constraint or FK evaluated against existing rows, or removes protection | 24h staging |
| High | Adds uniqueness over an existing populated column, where existing duplicates would abort the apply | 24h staging + Owner sign-off |

### Dependency order

```
0034 ──► 0036 ──► 0037            (checkout_id must exist before the checkout index)
0035 ──► 0036                     (old index dropped before the new one is created)
0038 ─── independent
0039..0043 ── independent (orders columns)
0044 ──► 0045 ──► 0046            (columns before the unique index)
0047 ─── independent
0048 ──► 0049                     (table before its unique index)
0050 ──► 0051                     (table before its seed)
0052..0060 ── independent
0061 requires 0047 (refunds/orders present)
0062 ─── independent
```

**0035, 0036, 0037 MUST be applied as a set in one maintenance window.** Between 0035 and 0036 the table has no active-reservation uniqueness protection at all.

---

## 1. P0 Set — Reservation Correctness (RT-002, RT-001, F-02)

Nothing else ships before these five.

### 0034 — `stock_reservations_add_checkout_id`

| Property | Value |
|---|---|
| Depends on | (none) |
| Milestone | M4 Inventory, Phase 1 |
| Risk | **Low** — additive nullable column |
| Finding | RT-002 |

`checkout_id` is passed to `reserve()` in Section 11.3 but was never defined as a column anywhere in V7.

**Forward SQL**

```sql
-- db/migrations/0034_stock_reservations_add_checkout_id.sql
ALTER TABLE stock_reservations ADD COLUMN checkout_id TEXT;
```

**Rollback SQL**

```sql
-- db/migrations/rollback/0034_stock_reservations_add_checkout_id.rollback.sql
-- ROLLBACK_EXCEPTION: column checkout_id left in place; harmless and idempotent.
-- Dropping it would require a table rebuild, which is riskier than the residue.
SELECT 1 WHERE 0;
```

**Pre-flight** (zero rows = safe)

```sql
-- db/migrations/preflight/0034_stock_reservations_add_checkout_id.preflight.sql
-- Returns a row if the column already exists.
SELECT name FROM pragma_table_info('stock_reservations') WHERE name = 'checkout_id';
```

**Test fixture assertions**

- `PRAGMA table_info('stock_reservations')` contains `checkout_id` after apply.
- Existing rows have `checkout_id IS NULL` and remain readable.
- An insert without `checkout_id` still succeeds (the column is nullable; historical rows have no checkout).

---

### 0035 — `drop_idx_stock_reservations_order_active`

| Property | Value |
|---|---|
| Depends on | (none) |
| Milestone | M4 Inventory, Phase 1 |
| Risk | **Medium** — removes the only active-reservation uniqueness protection until 0036 lands |
| Finding | RT-002 |

The repository index is named `idx_stock_reservations_order_active` and is missing the `order_id IS NOT NULL` predicate. Because SQLite treats NULLs as distinct, the index matches nothing during reservation (when `order_id` is NULL) — so the constraint that was supposed to stop a double-hold on a retried checkout does nothing. The name is retired along with the shape so that no code, test, or audit check can reference the old semantics by accident.

**Forward SQL**

```sql
-- db/migrations/0035_drop_idx_stock_reservations_order_active.sql
DROP INDEX IF EXISTS idx_stock_reservations_order_active;
```

**Rollback SQL**

```sql
-- db/migrations/rollback/0035_drop_idx_stock_reservations_order_active.rollback.sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_reservations_order_active
  ON stock_reservations(order_id, variant_id)
  WHERE status = 'active';
```

**Pre-flight** (zero rows = safe)

```sql
-- db/migrations/preflight/0035_drop_idx_stock_reservations_order_active.preflight.sql
-- Returns a row if 0036 has already created the replacement, which would mean
-- this migration is being applied out of order.
SELECT name FROM sqlite_master
WHERE type = 'index' AND name = 'idx_stock_res_order_variant_active';
```

**Test fixture assertions**

- After apply, `PRAGMA index_list('stock_reservations')` does not contain `idx_stock_reservations_order_active`.
- Rollback recreates an index of the same name.
- No data rows are affected.

---

### 0036 — `create_idx_stock_res_order_variant_active`

| Property | Value |
|---|---|
| Depends on | 0034, 0035 |
| Milestone | M4 Inventory, Phase 1 |
| Risk | **Medium** — uniqueness evaluated against existing rows |
| Finding | RT-002 |

**Forward SQL**

```sql
-- db/migrations/0036_create_idx_stock_res_order_variant_active.sql
CREATE UNIQUE INDEX idx_stock_res_order_variant_active
  ON stock_reservations(order_id, variant_id)
  WHERE status = 'active' AND order_id IS NOT NULL;
```

**Rollback SQL**

```sql
-- db/migrations/rollback/0036_create_idx_stock_res_order_variant_active.rollback.sql
DROP INDEX IF EXISTS idx_stock_res_order_variant_active;
```

**Pre-flight** (zero rows = safe)

```sql
-- db/migrations/preflight/0036_create_idx_stock_res_order_variant_active.preflight.sql
-- Returns one row per duplicate that would abort the CREATE UNIQUE INDEX.
-- Correct grain: (order_id, variant_id), not order_id alone. The V7 pre-flight
-- grouped by order_id only and therefore passed on any dataset with no
-- multi-item orders, then failed in production on the first two-item purchase.
SELECT order_id, variant_id, COUNT(*) AS active_rows
FROM stock_reservations
WHERE status = 'active' AND order_id IS NOT NULL
GROUP BY order_id, variant_id
HAVING COUNT(*) > 1;
```

If this returns rows, the Cluster 2 Owner resolves each duplicate (release all but the most recent) before the migration proceeds, and the finding is recorded as a `GV-{YYYY}-{NN}`.

**Test fixture assertions**

- Three active rows sharing one `order_id` across three different `variant_id` values all insert successfully.
- A second active row for the same `(order_id, variant_id)` fails with a UNIQUE violation.
- Two rows with the same `(order_id, variant_id)` where one is `active` and one is `released` both succeed (partial index).
- Rows with `order_id IS NULL` are not constrained by this index, regardless of how many share a `variant_id`.

---

### 0037 — `create_idx_stock_res_checkout_variant_active`

| Property | Value |
|---|---|
| Depends on | 0034 |
| Milestone | M4 Inventory, Phase 1 |
| Risk | **Medium** — uniqueness evaluated against existing rows (all of which have `checkout_id IS NULL`, so the predicate matches nothing historically) |
| Finding | RT-002 |

This is the index that actually prevents a double-hold on a retried checkout, because `checkout_id` exists at reserve time and `order_id` does not.

**Forward SQL**

```sql
-- db/migrations/0037_create_idx_stock_res_checkout_variant_active.sql
CREATE UNIQUE INDEX idx_stock_res_checkout_variant_active
  ON stock_reservations(checkout_id, variant_id)
  WHERE status = 'active';
```

**Rollback SQL**

```sql
-- db/migrations/rollback/0037_create_idx_stock_res_checkout_variant_active.rollback.sql
DROP INDEX IF EXISTS idx_stock_res_checkout_variant_active;
```

**Pre-flight** (zero rows = safe)

```sql
-- db/migrations/preflight/0037_create_idx_stock_res_checkout_variant_active.preflight.sql
SELECT checkout_id, variant_id, COUNT(*) AS active_rows
FROM stock_reservations
WHERE status = 'active' AND checkout_id IS NOT NULL
GROUP BY checkout_id, variant_id
HAVING COUNT(*) > 1;
```

**Test fixture assertions**

- Two `reserve()` calls with the same `checkout_id` and `variant_id` while the first is active: the second insert fails.
- The same `checkout_id` across different `variant_id` values succeeds (a multi-item checkout).
- Historical rows with `checkout_id IS NULL` are unaffected.

---

### 0038 — `orders_add_reservation_expires_at`

| Property | Value |
|---|---|
| Depends on | (none) |
| Milestone | M4 Inventory, Phase 1 |
| Risk | **Low** — additive nullable column |
| Finding | RT-001, F-02 |

**Forward SQL**

```sql
-- db/migrations/0038_orders_add_reservation_expires_at.sql
ALTER TABLE orders ADD COLUMN reservation_expires_at TEXT;
```

**Rollback SQL**

```sql
-- db/migrations/rollback/0038_orders_add_reservation_expires_at.rollback.sql
-- ROLLBACK_EXCEPTION: column reservation_expires_at left in place; harmless and idempotent.
SELECT 1 WHERE 0;
```

**Pre-flight** (zero rows = safe)

```sql
-- db/migrations/preflight/0038_orders_add_reservation_expires_at.preflight.sql
SELECT name FROM pragma_table_info('orders') WHERE name = 'reservation_expires_at';
```

**Test fixture assertions**

- The column exists and is nullable after apply.
- Historical orders have `reservation_expires_at IS NULL`; the cleanup cron's `OR (o.reservation_expires_at IS NOT NULL AND ...)` clause therefore never releases their reservations on the basis of this column.
- A newly created order has `reservation_expires_at = datetime(created_at, '+60 minutes')`.

---

## 2. Order and Payment Correctness

### 0039 — `orders_add_payment_status`

Risk **Low**. Finding F-05. Milestone M3, Phase 1.

```sql
-- db/migrations/0039_orders_add_payment_status.sql
ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid','partially_paid','paid','refunded','partially_refunded'));
```

```sql
-- db/migrations/rollback/0039_orders_add_payment_status.rollback.sql
-- ROLLBACK_EXCEPTION: column payment_status left in place; harmless and idempotent.
SELECT 1 WHERE 0;
```

```sql
-- db/migrations/preflight/0039_orders_add_payment_status.preflight.sql
SELECT name FROM pragma_table_info('orders') WHERE name = 'payment_status';
```

Assertions: the column defaults to `'unpaid'` on every existing row; an insert with `payment_status = 'settled'` fails the CHECK; the fulfilment `status` column is unaffected.

---

### 0040 — `orders_add_fraud_score`

Risk **Low**. Finding: Section 4 of the review (required by Section 11.2 step 3, never in the schema). Milestone M10, Phase 2.

```sql
-- db/migrations/0040_orders_add_fraud_score.sql
ALTER TABLE orders ADD COLUMN fraud_score INTEGER CHECK (fraud_score BETWEEN 0 AND 100);
```

```sql
-- db/migrations/rollback/0040_orders_add_fraud_score.rollback.sql
-- ROLLBACK_EXCEPTION: column fraud_score left in place; harmless and idempotent.
SELECT 1 WHERE 0;
```

```sql
-- db/migrations/preflight/0040_orders_add_fraud_score.preflight.sql
SELECT name FROM pragma_table_info('orders') WHERE name = 'fraud_score';
```

Assertions: `fraud_score = 101` fails; NULL is permitted (POS and pre-FraudBD orders).

---

### 0041 — `orders_add_fraud_source`

Risk **Low**. Finding: Section 4. Milestone M10, Phase 2.

```sql
-- db/migrations/0041_orders_add_fraud_source.sql
ALTER TABLE orders ADD COLUMN fraud_source TEXT
  CHECK (fraud_source IN ('fraudbd','circuit_open_fallback','fraud_check_failed','client_error','manual'));
```

```sql
-- db/migrations/rollback/0041_orders_add_fraud_source.rollback.sql
-- ROLLBACK_EXCEPTION: column fraud_source left in place; harmless and idempotent.
SELECT 1 WHERE 0;
```

```sql
-- db/migrations/preflight/0041_orders_add_fraud_source.preflight.sql
SELECT name FROM pragma_table_info('orders') WHERE name = 'fraud_source';
```

Assertions: the four values used by Sections 11.2 and 37 all insert; an unknown value fails.

---

### 0042 — `orders_add_created_by_staff_id`

Risk **Low** (nullable, no FK — see the note below). Finding: Section 4 (Staff `orders.cancel` is scoped to "Own orders" with no column recording ownership). Milestone M5, Phase 1.

```sql
-- db/migrations/0042_orders_add_created_by_staff_id.sql
ALTER TABLE orders ADD COLUMN created_by_staff_id TEXT;
```

```sql
-- db/migrations/rollback/0042_orders_add_created_by_staff_id.rollback.sql
-- ROLLBACK_EXCEPTION: column created_by_staff_id left in place; harmless and idempotent.
SELECT 1 WHERE 0;
```

```sql
-- db/migrations/preflight/0042_orders_add_created_by_staff_id.preflight.sql
SELECT name FROM pragma_table_info('orders') WHERE name = 'created_by_staff_id';
```

**No FK is declared deliberately (M-06).** SQLite cannot add a foreign key to an existing table via `ALTER TABLE`, and a rebuild of `orders` on a live system is a far larger risk than the referential integrity gained. Ownership is validated in the application layer and by a nightly orphan-check query. Assertions: guest orders keep `NULL`; a staff-assisted order records the staff id; the RBAC "own orders" check reads this column.

---

### 0043 — `orders_add_staff_override`

Risk **Low**. Finding: Section 4 (referenced by Section 14.3, never in the schema). Milestone M5, Phase 1.

```sql
-- db/migrations/0043_orders_add_staff_override.sql
ALTER TABLE orders ADD COLUMN staff_override INTEGER NOT NULL DEFAULT 0 CHECK (staff_override IN (0,1));
```

```sql
-- db/migrations/rollback/0043_orders_add_staff_override.rollback.sql
-- ROLLBACK_EXCEPTION: column staff_override left in place; harmless and idempotent.
SELECT 1 WHERE 0;
```

```sql
-- db/migrations/preflight/0043_orders_add_staff_override.preflight.sql
SELECT name FROM pragma_table_info('orders') WHERE name = 'staff_override';
```

Assertions: defaults to 0; `staff_override = 2` fails; an override order also has a matching `audit_log` row.

---

### 0044 — `payment_events_add_provider`

Risk **Low**. Finding F-01. Milestone M3, Phase 1.

The repository `payment_events` table has `id`, `payment_id`, `invoice_id`, `event_type`, `status`, `raw_payload`, `created_at` and `UNIQUE(invoice_id, event_type, status)`. It has no provider identity at all, so provider-level replay protection is impossible without these two columns.

```sql
-- db/migrations/0044_payment_events_add_provider.sql
ALTER TABLE payment_events ADD COLUMN provider TEXT;
```

```sql
-- db/migrations/rollback/0044_payment_events_add_provider.rollback.sql
-- ROLLBACK_EXCEPTION: column provider left in place; harmless and idempotent.
SELECT 1 WHERE 0;
```

```sql
-- db/migrations/preflight/0044_payment_events_add_provider.preflight.sql
SELECT name FROM pragma_table_info('payment_events') WHERE name = 'provider';
```

Assertions: the column exists; historical rows are NULL.

---

### 0045 — `payment_events_add_provider_event_id`

Risk **Low**. Finding F-01. Milestone M3, Phase 1.

```sql
-- db/migrations/0045_payment_events_add_provider_event_id.sql
ALTER TABLE payment_events ADD COLUMN provider_event_id TEXT;
```

```sql
-- db/migrations/rollback/0045_payment_events_add_provider_event_id.rollback.sql
-- ROLLBACK_EXCEPTION: column provider_event_id left in place; harmless and idempotent.
SELECT 1 WHERE 0;
```

```sql
-- db/migrations/preflight/0045_payment_events_add_provider_event_id.preflight.sql
SELECT name FROM pragma_table_info('payment_events') WHERE name = 'provider_event_id';
```

Assertions: the column exists; historical rows are NULL.

---

### 0046 — `create_idx_payment_events_provider_event`

| Property | Value |
|---|---|
| Depends on | 0044, 0045 |
| Milestone | M3 Payment, Phase 1 |
| Risk | **High** — adds uniqueness over a populated table |
| Finding | F-01 — the single most important missing constraint in the plan |

Historical rows have `provider IS NULL` and `provider_event_id IS NULL`. The partial predicate excludes them, so the index applies only to rows written by V8 code. Without the predicate, every historical row would collide on `(NULL, NULL)` — except that SQLite treats NULLs as distinct in a unique index, which is exactly the subtlety that made the V7 reservation index a no-op. The predicate is written explicitly rather than relying on NULL semantics.

**Forward SQL**

```sql
-- db/migrations/0046_create_idx_payment_events_provider_event.sql
CREATE UNIQUE INDEX idx_payment_events_provider_event
  ON payment_events(provider, provider_event_id)
  WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL;
```

**Rollback SQL**

```sql
-- db/migrations/rollback/0046_create_idx_payment_events_provider_event.rollback.sql
DROP INDEX IF EXISTS idx_payment_events_provider_event;
```

**Pre-flight** (zero rows = safe)

```sql
-- db/migrations/preflight/0046_create_idx_payment_events_provider_event.preflight.sql
SELECT provider, provider_event_id, COUNT(*) AS duplicate_rows
FROM payment_events
WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL
GROUP BY provider, provider_event_id
HAVING COUNT(*) > 1;
```

**Test fixture assertions**

- Inserting the same `(provider, provider_event_id)` twice fails on the second insert.
- Different providers may share an event id.
- Historical rows with NULLs are unaffected and remain readable.
- `payment-webhook-replay.test.ts`: the same signed event delivered three times yields exactly one `payment_events` row, one `payment_transactions` row, and one credit, including a simulated consumer crash-and-redeliver between the ledger write and the ack.

---

### 0047 — `create_payment_transactions`

Risk **Low** (new table; FK to `orders` is declared at create time, which SQLite supports). Findings F-03, RV8-001. Milestone M3, Phase 1.

```sql
-- db/migrations/0047_create_payment_transactions.sql
CREATE TABLE payment_transactions (
  transaction_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_event_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('capture','refund','cod_collection','cod_remittance')),
  provider TEXT NOT NULL,
  provider_reference TEXT,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  settled_at TEXT NOT NULL,
  recorded_by_staff_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(payment_event_id, direction)
);
```

```sql
-- db/migrations/rollback/0047_create_payment_transactions.rollback.sql
DROP TABLE IF EXISTS payment_transactions;
```

```sql
-- db/migrations/preflight/0047_create_payment_transactions.preflight.sql
-- Returns a row if the table already exists, AND asserts the FK target has the
-- shape this migration assumes (M-06: never assume the referenced schema).
SELECT 'table_exists' AS problem FROM sqlite_master WHERE type='table' AND name='payment_transactions'
UNION ALL
SELECT 'orders_pk_not_id' AS problem
WHERE NOT EXISTS (SELECT 1 FROM pragma_table_info('orders') WHERE name='id' AND pk=1);
```

Assertions: `amount_paisa = 0` fails; an unknown `direction` fails; deleting an order with transactions is restricted; a capture and a refund for the same order both insert; inserting the same `(payment_event_id, direction)` twice fails on the second insert.

---

## 3. Coupons, VAT, Cart

### 0048 — `create_coupon_redemptions`

Risk **Low**. Finding RT-007. Milestone M2, Phase 1. The table is named in Section 6.1 but does not exist in the repository.

```sql
-- db/migrations/0048_create_coupon_redemptions.sql
CREATE TABLE coupon_redemptions (
  redemption_id TEXT PRIMARY KEY,
  coupon_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  discount_paisa INTEGER NOT NULL CHECK (discount_paisa >= 0),
  redeemed_at TEXT NOT NULL
);
```

```sql
-- db/migrations/rollback/0048_create_coupon_redemptions.rollback.sql
DROP TABLE IF EXISTS coupon_redemptions;
```

```sql
-- db/migrations/preflight/0048_create_coupon_redemptions.preflight.sql
SELECT name FROM sqlite_master WHERE type='table' AND name='coupon_redemptions';
```

Assertions: a negative discount fails; the row is written in the same D1 batch as the order (integration test `coupon-rollback.test.ts`).

---

### 0049 — `create_idx_coupon_redemptions_coupon_order`

Risk **Low** (new empty table). Finding RT-007. Depends on 0048.

```sql
-- db/migrations/0049_create_idx_coupon_redemptions_coupon_order.sql
CREATE UNIQUE INDEX idx_coupon_redemptions_coupon_order
  ON coupon_redemptions(coupon_id, order_id);
```

```sql
-- db/migrations/rollback/0049_create_idx_coupon_redemptions_coupon_order.rollback.sql
DROP INDEX IF EXISTS idx_coupon_redemptions_coupon_order;
```

```sql
-- db/migrations/preflight/0049_create_idx_coupon_redemptions_coupon_order.preflight.sql
SELECT coupon_id, order_id, COUNT(*) AS duplicate_rows
FROM coupon_redemptions
GROUP BY coupon_id, order_id
HAVING COUNT(*) > 1;
```

Assertions: the same coupon cannot be redeemed twice against one order; the same coupon against two orders succeeds; the rollback path in Section 11.3 is exactly-once because of this index.

---

### 0050 — `create_tax_rates`

Risk **Low**. Finding C-09, F-06. Milestone M2, Phase 1.

```sql
-- db/migrations/0050_create_tax_rates.sql
CREATE TABLE tax_rates (
  tax_rate_id TEXT PRIMARY KEY,
  rate_percent INTEGER NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  applies_to TEXT NOT NULL CHECK (applies_to IN ('goods','delivery')),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL
);
```

```sql
-- db/migrations/rollback/0050_create_tax_rates.rollback.sql
DROP TABLE IF EXISTS tax_rates;
```

```sql
-- db/migrations/preflight/0050_create_tax_rates.preflight.sql
SELECT name FROM sqlite_master WHERE type='table' AND name='tax_rates';
```

Assertions: `rate_percent = 101` fails; an unknown `applies_to` fails; an open-ended row (`effective_to IS NULL`) is selectable by the Section 11.7 query.

---

### 0051 — `seed_tax_rates`

Risk **Low**. Finding C-09. Depends on 0050. Seed data is its own numbered migration (M-04): if a `CREATE` succeeds and a seed `INSERT` fails inside one file, the reader caches an empty config and silently enforces nothing.

```sql
-- db/migrations/0051_seed_tax_rates.sql
INSERT INTO tax_rates (tax_rate_id, rate_percent, applies_to, effective_from, effective_to, created_at)
VALUES ('tax_goods_launch', 0, 'goods', '2026-01-01T00:00:00Z', NULL, datetime('now'));
```

```sql
-- db/migrations/rollback/0051_seed_tax_rates.rollback.sql
DELETE FROM tax_rates WHERE tax_rate_id = 'tax_goods_launch';
```

```sql
-- db/migrations/preflight/0051_seed_tax_rates.preflight.sql
SELECT tax_rate_id FROM tax_rates WHERE tax_rate_id = 'tax_goods_launch';
```

The launch rate is `0`, matching the V7 default. A `delivery` row is **not** seeded — that is blocked on DECISION REQUIRED (D-03) in Section 11.7. Assertions: exactly one active `goods` row after apply; the Section 11.7 lookup returns it; VAT computes to zero at launch.

---

### 0052 — `cart_activity_add_cart_version`

Risk **Low**. Finding CF-04. Milestone M9, Phase 2.

```sql
-- db/migrations/0052_cart_activity_add_cart_version.sql
ALTER TABLE cart_activity ADD COLUMN cart_version INTEGER NOT NULL DEFAULT 0;
```

```sql
-- db/migrations/rollback/0052_cart_activity_add_cart_version.rollback.sql
-- ROLLBACK_EXCEPTION: column cart_version left in place; harmless and idempotent.
SELECT 1 WHERE 0;
```

```sql
-- db/migrations/preflight/0052_cart_activity_add_cart_version.preflight.sql
SELECT name FROM pragma_table_info('cart_activity') WHERE name = 'cart_version';
```

Assertions: existing rows default to 0, so the first versioned write from either writer always wins; `cart-activity-out-of-order-upsert.test.ts` passes.

---

## 4. Operations, Courier, POS, Supply Chain

### 0053 — `create_courier_shipments`

Risk **Low**. Finding F-03. Milestone M10, Phase 2.

```sql
-- db/migrations/0053_create_courier_shipments.sql
CREATE TABLE courier_shipments (
  shipment_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  courier TEXT NOT NULL CHECK (courier IN ('pathao','steadfast','redx','manual')),
  tracking_ref TEXT,
  cod_amount_paisa INTEGER NOT NULL DEFAULT 0 CHECK (cod_amount_paisa >= 0),
  cod_collected_paisa INTEGER NOT NULL DEFAULT 0 CHECK (cod_collected_paisa >= 0),
  handed_off_at TEXT NOT NULL,
  delivered_at TEXT,
  created_at TEXT NOT NULL
);
```

```sql
-- db/migrations/rollback/0053_create_courier_shipments.rollback.sql
DROP TABLE IF EXISTS courier_shipments;
```

```sql
-- db/migrations/preflight/0053_create_courier_shipments.preflight.sql
SELECT 'table_exists' AS problem FROM sqlite_master WHERE type='table' AND name='courier_shipments'
UNION ALL
SELECT 'orders_pk_not_id' AS problem
WHERE NOT EXISTS (SELECT 1 FROM pragma_table_info('orders') WHERE name='id' AND pk=1);
```

Assertions: negative COD amounts fail; an unknown courier fails; `cod_collected_paisa` starts at 0 and is updated on delivery.

---

### 0054 — `create_courier_cod_remittance`

Risk **Low**. Finding F-03. Milestone M10, Phase 2.

```sql
-- db/migrations/0054_create_courier_cod_remittance.sql
CREATE TABLE courier_cod_remittance (
  remittance_id TEXT PRIMARY KEY,
  courier TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  expected_paisa INTEGER NOT NULL CHECK (expected_paisa >= 0),
  received_paisa INTEGER NOT NULL CHECK (received_paisa >= 0),
  reconciled_by_staff_id TEXT,
  reconciled_at TEXT,
  created_at TEXT NOT NULL
);
```

```sql
-- db/migrations/rollback/0054_create_courier_cod_remittance.rollback.sql
DROP TABLE IF EXISTS courier_cod_remittance;
```

```sql
-- db/migrations/preflight/0054_create_courier_cod_remittance.preflight.sql
SELECT name FROM sqlite_master WHERE type='table' AND name='courier_cod_remittance';
```

Assertions: a shortfall (`received < expected`) inserts and is reportable; negative amounts fail.

---

### 0055 — `create_pos_cash_drawer_sessions`

Risk **Low**. Finding F-09. Milestone M11, Phase 2.

```sql
-- db/migrations/0055_create_pos_cash_drawer_sessions.sql
CREATE TABLE pos_cash_drawer_sessions (
  drawer_session_id TEXT PRIMARY KEY,
  opened_by_staff_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  opening_float_paisa INTEGER NOT NULL CHECK (opening_float_paisa >= 0),
  closed_by_staff_id TEXT,
  closed_at TEXT,
  expected_cash_paisa INTEGER,
  counted_cash_paisa INTEGER,
  variance_paisa INTEGER,
  notes TEXT
);
```

```sql
-- db/migrations/rollback/0055_create_pos_cash_drawer_sessions.rollback.sql
DROP TABLE IF EXISTS pos_cash_drawer_sessions;
```

```sql
-- db/migrations/preflight/0055_create_pos_cash_drawer_sessions.preflight.sql
SELECT name FROM sqlite_master WHERE type='table' AND name='pos_cash_drawer_sessions';
```

Assertions: an open session has NULL close fields; `variance_paisa = counted - expected` on close; POS refuses a cash invoice with no open session (integration test).

---

### 0056 — `create_suppliers`

Risk **Low**. Finding RT-003 / Section 8. Milestone M4, Phase 1.

```sql
-- db/migrations/0056_create_suppliers.sql
CREATE TABLE suppliers (
  supplier_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL
);
```

```sql
-- db/migrations/rollback/0056_create_suppliers.rollback.sql
DROP TABLE IF EXISTS suppliers;
```

```sql
-- db/migrations/preflight/0056_create_suppliers.preflight.sql
SELECT name FROM sqlite_master WHERE type='table' AND name='suppliers';
```

---

### 0057 — `create_purchase_orders`

Risk **Low**. Depends on 0056. Finding RT-003 / Section 8.

```sql
-- db/migrations/0057_create_purchase_orders.sql
CREATE TABLE purchase_orders (
  purchase_order_id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(supplier_id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('draft','ordered','received','cancelled')),
  total_cost_paisa INTEGER NOT NULL DEFAULT 0 CHECK (total_cost_paisa >= 0),
  created_by_staff_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

```sql
-- db/migrations/rollback/0057_create_purchase_orders.rollback.sql
DROP TABLE IF EXISTS purchase_orders;
```

```sql
-- db/migrations/preflight/0057_create_purchase_orders.preflight.sql
SELECT 'table_exists' AS problem FROM sqlite_master WHERE type='table' AND name='purchase_orders'
UNION ALL
SELECT 'suppliers_missing' AS problem
WHERE NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='suppliers');
```

Assertions: an order referencing a non-existent supplier fails; an unknown status fails.

---

### 0058 — `create_goods_receipts`

Risk **Low**. Depends on 0057. Finding RT-003.

```sql
-- db/migrations/0058_create_goods_receipts.sql
CREATE TABLE goods_receipts (
  goods_receipt_id TEXT PRIMARY KEY,
  purchase_order_id TEXT REFERENCES purchase_orders(purchase_order_id) ON DELETE RESTRICT,
  variant_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_paisa INTEGER NOT NULL CHECK (unit_cost_paisa >= 0),
  adjustment_id TEXT NOT NULL,
  received_by_staff_id TEXT NOT NULL,
  received_at TEXT NOT NULL
);
```

```sql
-- db/migrations/rollback/0058_create_goods_receipts.rollback.sql
DROP TABLE IF EXISTS goods_receipts;
```

```sql
-- db/migrations/preflight/0058_create_goods_receipts.preflight.sql
SELECT 'table_exists' AS problem FROM sqlite_master WHERE type='table' AND name='goods_receipts'
UNION ALL
SELECT 'purchase_orders_missing' AS problem
WHERE NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchase_orders');
```

Assertions: `quantity = 0` fails; `adjustment_id` matches the `adjustStock()` idempotency key that applied the receipt, so a replayed receipt does not double-count stock.

---

### 0059 — `return_requests_add_restocked_at`

Risk **Low**. Finding C-06. Milestone M10, Phase 2. The repository table is `return_requests`.

```sql
-- db/migrations/0059_return_requests_add_restocked_at.sql
ALTER TABLE return_requests ADD COLUMN restocked_at TEXT;
```

```sql
-- db/migrations/rollback/0059_return_requests_add_restocked_at.rollback.sql
-- ROLLBACK_EXCEPTION: column restocked_at left in place; harmless and idempotent.
SELECT 1 WHERE 0;
```

```sql
-- db/migrations/preflight/0059_return_requests_add_restocked_at.preflight.sql
SELECT 'column_exists' AS problem FROM pragma_table_info('return_requests') WHERE name='restocked_at'
UNION ALL
SELECT 'return_requests_missing' AS problem
WHERE NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='return_requests');
```

Assertions: an approved resaleable return sets `restocked_at` and produces a `stock_adjustments` row; a non-resaleable return leaves it NULL. `restocked` is not, and never becomes, an order status.

---

### 0060 — `product_variants_add_cost_paisa`

Risk **Low**. Finding: Section 8 (COGS is uncomputable without it). Milestone M4, Phase 1 — added now because backfilling cost onto historical stock later is guesswork.

```sql
-- db/migrations/0060_product_variants_add_cost_paisa.sql
ALTER TABLE product_variants ADD COLUMN cost_paisa INTEGER CHECK (cost_paisa >= 0);
```

```sql
-- db/migrations/rollback/0060_product_variants_add_cost_paisa.rollback.sql
-- ROLLBACK_EXCEPTION: column cost_paisa left in place; harmless and idempotent.
SELECT 1 WHERE 0;
```

```sql
-- db/migrations/preflight/0060_product_variants_add_cost_paisa.preflight.sql
SELECT name FROM pragma_table_info('product_variants') WHERE name = 'cost_paisa';
```

Assertions: negative cost fails; NULL is permitted for variants with unknown historical cost; the column is integer paisa, not a float.

---

### 0061 — `create_trg_refund_cap`

Risk **Medium** — a trigger changes write behaviour on a live table. Finding F-03. Milestone M10, Phase 2.

```sql
-- db/migrations/0061_create_trg_refund_cap.sql
CREATE TRIGGER trg_refund_cap
AFTER INSERT ON refunds
FOR EACH ROW
WHEN (
  SELECT COALESCE(SUM(r.refund_paisa), 0) FROM refunds r WHERE r.order_id = NEW.order_id
) > (
  SELECT o.advance_paisa FROM orders o WHERE o.id = NEW.order_id
)
BEGIN
  SELECT RAISE(ABORT, 'refund_exceeds_advance');
END;
```

```sql
-- db/migrations/rollback/0061_create_trg_refund_cap.rollback.sql
DROP TRIGGER IF EXISTS trg_refund_cap;
```

**Pre-flight** (zero rows = safe) — this one matters: if production already contains an over-refunded order, the trigger will abort the next legitimate refund on it.

```sql
-- db/migrations/preflight/0061_create_trg_refund_cap.preflight.sql
SELECT o.id AS order_id,
       o.advance_paisa,
       SUM(r.refund_paisa) AS refunded_paisa
FROM orders o
JOIN refunds r ON r.order_id = o.id
GROUP BY o.id, o.advance_paisa
HAVING SUM(r.refund_paisa) > o.advance_paisa;
```

Assertions: a refund totalling exactly `advance_paisa` succeeds; one paisa more aborts with `refund_exceeds_advance`; the abort leaves no partial row.

**Note:** if `refunds` does not yet exist in the target environment, this migration is deferred until the milestone that creates it, and its number is reissued at that point — numbers are assigned at authoring time against the then-current head.

---

### 0062 — `drop_csrf_nonces`

Risk **Medium** — drops a table. Finding S-10. Milestone M6, Phase 2.

Section 18.3 now specifies a single stateless HMAC-signed double-submit token. The `csrf_nonces` table has no reader and no writer.

```sql
-- db/migrations/0062_drop_csrf_nonces.sql
DROP TABLE IF EXISTS csrf_nonces;
```

```sql
-- db/migrations/rollback/0062_drop_csrf_nonces.rollback.sql
-- ROLLBACK_EXCEPTION: re-creating the table does NOT restore its rows.
-- The table was unused by V8 code paths; schema parity is sufficient.
CREATE TABLE IF NOT EXISTS csrf_nonces (
  nonce TEXT PRIMARY KEY,
  session_id TEXT,
  issued_at TEXT,
  expires_at TEXT
);
```

**Pre-flight** (zero rows = safe)

```sql
-- db/migrations/preflight/0062_drop_csrf_nonces.preflight.sql
-- Returns rows if the table still holds live nonces, which would mean some code
-- path is still writing to it. Resolve that before dropping.
SELECT COUNT(*) AS live_nonces FROM csrf_nonces
WHERE expires_at > datetime('now')
HAVING COUNT(*) > 0;
```

Assertions: after apply, the table is absent and CSRF validation still passes end-to-end (the mechanism is stateless); the dual-key rotation window is exercised by a test that verifies a token signed with the previous key.

---

### 0063 — `invoices_add_idempotency_key`

Risk **Low** (nullable additive column). Finding RV8-002. Milestone M11, Phase 2.

```sql
-- db/migrations/0063_invoices_add_idempotency_key.sql
ALTER TABLE invoices ADD COLUMN idempotency_key TEXT;
```

```sql
-- db/migrations/rollback/0063_invoices_add_idempotency_key.rollback.sql
-- ROLLBACK_EXCEPTION: SQLite cannot drop columns in place; leave nullable column present.
SELECT 1 WHERE 0;
```

```sql
-- db/migrations/preflight/0063_invoices_add_idempotency_key.preflight.sql
SELECT name FROM pragma_table_info('invoices') WHERE name = 'idempotency_key';
```

Assertions: column is nullable; existing rows remain valid; a repeated POS attempt can reuse the same key.

---

### 0064 — `create_idx_invoices_idempotency_key`

Risk **Low** (partial unique index on nullable new column). Finding RV8-002. Milestone M11, Phase 2.

```sql
-- db/migrations/0064_create_idx_invoices_idempotency_key.sql
CREATE UNIQUE INDEX idx_invoices_idempotency_key ON invoices(idempotency_key) WHERE idempotency_key IS NOT NULL;
```

```sql
-- db/migrations/rollback/0064_create_idx_invoices_idempotency_key.rollback.sql
DROP INDEX IF EXISTS idx_invoices_idempotency_key;
```

```sql
-- db/migrations/preflight/0064_create_idx_invoices_idempotency_key.preflight.sql
SELECT idempotency_key, COUNT(*) AS c
FROM invoices
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;
```

Assertions: duplicate non-NULL `idempotency_key` fails; multiple NULL rows remain valid; retry with same key returns existing invoice.

---

### 0065 — `create_site_settings`

Risk **Low** (new table). Finding RV8-006. Milestone M3/M10, Phase 1–2.

```sql
-- db/migrations/0065_create_site_settings.sql
CREATE TABLE site_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by_staff_id TEXT REFERENCES staff_users(staff_id));
```

```sql
-- db/migrations/rollback/0065_create_site_settings.rollback.sql
DROP TABLE IF EXISTS site_settings;
```

```sql
-- db/migrations/preflight/0065_create_site_settings.preflight.sql
SELECT 'table_exists' AS problem FROM sqlite_master WHERE type='table' AND name='site_settings';
```

Assertions: table exists; keys are unique; Owner-editable values are stored as JSON text.

---

### 0066 — `seed_site_settings`

Risk **Low** (idempotent seed insert). Finding RV8-006. Milestone M3/M10, Phase 1–2.

```sql
-- db/migrations/0066_seed_site_settings.sql
INSERT INTO site_settings (key, value_json, updated_at, updated_by_staff_id) VALUES ('MAX_COD_VALUE_PAISA','500000',datetime('now'),NULL), ('COD_ORDERS_PER_PHONE_24H','2',datetime('now'),NULL), ('COD_ORDERS_PER_ADDRESS_24H','3',datetime('now'),NULL), ('RETURN_WINDOW_DAYS','7',datetime('now'),NULL);
```

```sql
-- db/migrations/rollback/0066_seed_site_settings.rollback.sql
DELETE FROM site_settings WHERE key IN ('MAX_COD_VALUE_PAISA','COD_ORDERS_PER_PHONE_24H','COD_ORDERS_PER_ADDRESS_24H','RETURN_WINDOW_DAYS');
```

```sql
-- db/migrations/preflight/0066_seed_site_settings.preflight.sql
SELECT key FROM site_settings WHERE key IN ('MAX_COD_VALUE_PAISA','COD_ORDERS_PER_PHONE_24H','COD_ORDERS_PER_ADDRESS_24H','RETURN_WINDOW_DAYS');
```

Assertions: all four rows insert; repeated reads come through the `site_settings` accessor; defaults are owner-editable after seed.

---

### 0067 — `seed_ai_budget_limits_imagify`

Risk **Low** (idempotent seed insert into existing table). Finding C-14. Milestone M7, Phase 2.

```sql
-- db/migrations/0067_seed_ai_budget_limits_imagify.sql
INSERT OR IGNORE INTO ai_budget_limits (provider, daily_limit_usd_cents, monthly_limit_usd_cents, soft_alert_percent, hard_block_percent, owner_override, updated_at, updated_by_staff_id) VALUES ('imagify', 200, 2000, 80, 100, 0, datetime('now'), NULL);
```

```sql
-- db/migrations/rollback/0067_seed_ai_budget_limits_imagify.rollback.sql
DELETE FROM ai_budget_limits WHERE provider = 'imagify';
```

```sql
-- db/migrations/preflight/0067_seed_ai_budget_limits_imagify.preflight.sql
SELECT provider FROM ai_budget_limits WHERE provider = 'imagify';
```

Assertions: Imagify defaults seed once; existing providers are untouched; owner may edit later.

---

### 0068 — `drop_variants_view`

Risk **Low** (compatibility-view removal; rollback recreates). Finding C-15. Milestone M10/M12, Phase 2.

```sql
-- db/migrations/0068_drop_variants_view.sql
DROP VIEW IF EXISTS variants;
```

```sql
-- db/migrations/rollback/0068_drop_variants_view.rollback.sql
CREATE VIEW variants AS SELECT * FROM product_variants;
```

```sql
-- db/migrations/preflight/0068_drop_variants_view.preflight.sql
SELECT 1 WHERE 0;
```

Assertions: the compatibility view is absent after apply; rollback recreates it; real gate is drift code D-46 returning zero code references before apply.

---

## 5. Risk Summary Against a Non-Empty Production Database

V7 marked its additive migrations "Low — additive table, no existing data touched" and exempted them from the soak. That classification assumed an empty database. This is a live system with migrations already applied through `0033` and a `variants` compatibility view left over from an earlier schema. Every rating below is against real data.

| Migration | V7-style rating | V8 rating | Why it changed |
|---|---|---|---|
| 0034 | Low | Low | Genuinely additive and nullable |
| 0035 | — | **Medium** | Removes the only uniqueness protection until 0036 lands |
| 0036 | Medium | **Medium** | Uniqueness over live rows; pre-flight is at the correct `(order_id, variant_id)` grain now |
| 0037 | — | **Medium** | Uniqueness over live rows, though the predicate excludes all historical rows |
| 0039 | Low | Low | `NOT NULL DEFAULT` backfills cleanly |
| 0042 | Low | Low **only because no FK is declared** | An FK to `staff_users` would have required a table rebuild, and `staff_users`' primary key shape was never confirmed in V7 (M-06) |
| 0046 | Low | **High** | Uniqueness over a populated table; requires the duplicate pre-flight and Owner sign-off |
| 0047, 0053, 0057, 0058 | Low | Low, **with a schema-shape assertion in the pre-flight** | Each declares an FK; the pre-flight asserts the referenced table and primary key exist in the assumed shape before the migration runs |
| 0061 | — | **Medium** | Changes write behaviour on a live table; an existing over-refunded order would block a legitimate refund |
| 0062 | — | **Medium** | Drops a table; the rollback restores the schema but not the rows |

**Migration `0025_create_api_audit_logs` (already applied) is irreversible in practice (M-05).** Section 5 of the Master Plan lists `api_audit_logs` as the persistence layer for `ProviderHealthDO` circuit state. `DROP TABLE api_audit_logs` is a correct schema rollback but destroys every breaker transition record. It MUST be marked irreversible once FraudBD is live, and reversing it requires an explicit Owner decision, not a script run.

---

## 6. Apply Procedure

See Section 35.5 of the Master Plan. The two steps that are new and load-bearing:

- **Step 3: run every pre-flight against production, read-only, before applying to staging.** A pre-flight that only ever runs against staging proves nothing about production data. This is the fix for M-06.
- **Step 8: confirm a fresh D1 export *and* a fresh Durable Object snapshot exist** before applying to production. A D1-only backup cannot recover this system (RT-004).

## 7. Failure Recovery

See Section 35.6 of the Master Plan, including the `_migrations` SHA-256 reconciliation runbook (M-09). With one statement per file, the half-applied state that made V7's recovery procedure ambiguous is structurally impossible: a migration either applied or it did not.
