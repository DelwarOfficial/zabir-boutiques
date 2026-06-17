-- Rollback for 0018_schema_constraints.sql
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- Revert invoice_payments (drop CHECK on amount_paisa)
CREATE TABLE invoice_payments_old (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  method TEXT NOT NULL
    CHECK (method IN ('cash','card','bkash','nagad','rocket','bank_transfer','other')),
  amount_paisa INTEGER NOT NULL,
  reference TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO invoice_payments_old SELECT * FROM invoice_payments;
DROP TABLE invoice_payments;
ALTER TABLE invoice_payments_old RENAME TO invoice_payments;

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice
  ON invoice_payments(invoice_id);

-- Revert coupons (drop tightened money CHECKs)
CREATE TABLE coupons_old (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('fixed','percentage')),
  discount_amount_paisa INTEGER,
  discount_percent INTEGER CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100)),
  max_discount_paisa INTEGER,
  min_order_paisa INTEGER NOT NULL DEFAULT 0,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  starts_at TEXT,
  expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by TEXT REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO coupons_old SELECT * FROM coupons;
DROP TABLE coupons;
ALTER TABLE coupons_old RENAME TO coupons;

-- SQLite cannot DROP COLUMN; rebuild inventory_baseline without sold_quantity
CREATE TABLE inventory_baseline_old (
  variant_id TEXT PRIMARY KEY REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  baseline_hash TEXT NOT NULL,
  set_at TEXT NOT NULL,
  set_by TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
  reconciliation_count INTEGER NOT NULL DEFAULT 0
);

INSERT INTO inventory_baseline_old (variant_id, quantity, reserved_quantity, baseline_hash, set_at, set_by, reconciliation_count)
SELECT variant_id, quantity, reserved_quantity, baseline_hash, set_at, set_by, reconciliation_count
FROM inventory_baseline;

DROP TABLE inventory_baseline;
ALTER TABLE inventory_baseline_old RENAME TO inventory_baseline;

CREATE INDEX IF NOT EXISTS idx_inventory_baseline_set_at
  ON inventory_baseline(set_at);

DELETE FROM schema_migrations WHERE version = '0018_schema_constraints';

COMMIT;
PRAGMA foreign_keys = ON;