-- Rollback for 0013_order_state_machine_constraints.sql
-- Reverts the orders.status / payments.status / order_status_history
-- CHECK constraints to the pre-0013 (v6.8D) state, and drops the
-- staff_sessions trigger added in this migration.
--
-- SQLite cannot ALTER CHECK constraints, so this rollback uses the
-- standard PRAGMA foreign_keys = OFF → CREATE _new → INSERT → DROP →
-- RENAME pattern. The transaction is all-or-nothing.

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

DROP TRIGGER IF EXISTS trg_staff_sessions_no_refresh_on_revoked;

-- 1. payments.status rebuild to pre-0013 set (drop 'partially_paid' / 'partially_refunded' / 'refunded')
CREATE TABLE payments_new (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  invoice_id TEXT UNIQUE,
  provider TEXT NOT NULL DEFAULT 'uddoktapay',
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa >= 0),
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','pending','processing','paid','failed','cancelled','expired')),
  checkout_url TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO payments_new SELECT * FROM payments;
DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;

-- 2. orders.status rebuild (drop 'returned' / 'refunded')
CREATE TABLE orders_new (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  note TEXT,
  shipping_zone TEXT,
  subtotal_paisa INTEGER NOT NULL CHECK (subtotal_paisa >= 0),
  delivery_paisa INTEGER NOT NULL DEFAULT 0 CHECK (delivery_paisa >= 0),
  discount_paisa INTEGER NOT NULL DEFAULT 0 CHECK (discount_paisa >= 0),
  total_paisa INTEGER NOT NULL CHECK (total_paisa >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cod','uddoktapay','partial_prepay','in_store')),
  payment_status TEXT NOT NULL DEFAULT 'created'
    CHECK (payment_status IN ('created','pending','processing','paid','failed','cancelled','expired')),
  fraud_decision TEXT NOT NULL DEFAULT 'review'
    CHECK (fraud_decision IN ('approved','review','blocked')),
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','pending_payment','payment_verified','paid_over_allocated','staff_confirmed','packing','shipped','delivered','cancelled')),
  created_by TEXT REFERENCES staff_users(id),
  order_channel TEXT DEFAULT 'web'
    CHECK (order_channel IN ('web','in_store','phone','messenger','whatsapp')),
  advance_paisa INTEGER NOT NULL DEFAULT 0 CHECK (advance_paisa >= 0),
  balance_paisa INTEGER NOT NULL DEFAULT 0 CHECK (balance_paisa >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO orders_new SELECT * FROM orders;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

-- 3. order_status_history rebuild (drop CHECK constraints on from/to_status)
CREATE TABLE order_status_history_new (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by TEXT REFERENCES staff_users(id),
  note TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO order_status_history_new SELECT * FROM order_status_history;
DROP TABLE order_status_history;
ALTER TABLE order_status_history_new RENAME TO order_status_history;

-- Re-apply the indexes dropped during rebuild.
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_partial_prepay
  ON orders(payment_status)
  WHERE payment_method = 'partial_prepay';
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id, created_at);

COMMIT;
PRAGMA foreign_keys = ON;

DELETE FROM schema_migrations WHERE version = '0013_order_state_machine_constraints';
