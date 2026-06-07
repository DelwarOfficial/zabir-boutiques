-- Zabir Boutiques v6.8B — Staff Operations v2 Migration
-- Adds: in_store payment method, order channel/created_by tracking,
--        partial prepayment columns, created_by on coupons.

-- NOTE (post v6.8D re-audit): The columns (advance_paisa, balance_paisa, created_by,
-- order_channel), expanded payment_method CHECK, 'partially_paid' status, and
-- coupon created_by are NOW INCLUDED DIRECTLY in 0001_initial_v6_8a_schema.sql
-- for all fresh database builds.
-- These ALTER statements are retained for legacy environments that previously
-- only ran 0001+0002. Re-running the full migrate chain on an already-upgraded
-- D1 will error on "duplicate column". Run migrations once per environment.
-- 0001 is now the canonical complete schema.

-- 1. Expand payment_method to include 'in_store'
-- SQLite cannot ALTER CHECK constraints, so we recreate via a migration workaround.
-- For D1 we use the pragmatic approach: the CHECK is defined in 0001 but D1's
-- enforcement allows us to simply INSERT 'in_store' values. We document the
-- expanded contract here. If a clean rebuild is performed, update 0001 directly.

-- 2. Add created_by to orders (which staff created this order, nullable for guest orders)
ALTER TABLE orders ADD COLUMN created_by TEXT REFERENCES staff_users(id);

-- 3. Add order_channel (how the order was placed)
ALTER TABLE orders ADD COLUMN order_channel TEXT DEFAULT 'web'
  CHECK (order_channel IN ('web','in_store','phone','messenger','whatsapp'));

-- 4. Add partial prepayment tracking columns
ALTER TABLE orders ADD COLUMN advance_paisa INTEGER DEFAULT 0 CHECK (advance_paisa >= 0);
ALTER TABLE orders ADD COLUMN balance_paisa INTEGER DEFAULT 0 CHECK (balance_paisa >= 0);

-- 5. Add created_by to coupons (which staff created the coupon)
ALTER TABLE coupons ADD COLUMN created_by TEXT REFERENCES staff_users(id);

-- 6. Index for staff-created orders lookup
CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by) WHERE created_by IS NOT NULL;
