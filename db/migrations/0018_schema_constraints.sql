-- Zabir Boutiques v6.8D+ Phase 1 — Master Plan CHECK constraint gaps
-- Closes G3/G5 audit items:
--   1. invoice_payments.amount_paisa CHECK >= 0
--   2. coupons money columns CHECK >= 0 when non-null
--   3. inventory_baseline.sold_quantity (post-0017 sold tracking)

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- 1. invoice_payments: enforce non-negative amounts (POS refunds are out of scope; see invoices.ts)
CREATE TABLE invoice_payments_new (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  method TEXT NOT NULL
    CHECK (method IN ('cash','card','bkash','nagad','rocket','bank_transfer','other')),
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa >= 0),
  reference TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO invoice_payments_new SELECT * FROM invoice_payments;
DROP TABLE invoice_payments;
ALTER TABLE invoice_payments_new RENAME TO invoice_payments;

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice
  ON invoice_payments(invoice_id);

-- 2. coupons: tighten money CHECK constraints
CREATE TABLE coupons_new (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('fixed','percentage')),
  discount_amount_paisa INTEGER CHECK (discount_amount_paisa IS NULL OR discount_amount_paisa >= 0),
  discount_percent INTEGER CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100)),
  max_discount_paisa INTEGER CHECK (max_discount_paisa IS NULL OR max_discount_paisa >= 0),
  min_order_paisa INTEGER NOT NULL DEFAULT 0 CHECK (min_order_paisa >= 0),
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  starts_at TEXT,
  expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by TEXT REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO coupons_new SELECT * FROM coupons;
DROP TABLE coupons;
ALTER TABLE coupons_new RENAME TO coupons;

-- 3. inventory_baseline: track sold_quantity for post-0017 reconciliation
ALTER TABLE inventory_baseline ADD COLUMN sold_quantity INTEGER NOT NULL DEFAULT 0 CHECK (sold_quantity >= 0);

UPDATE inventory_baseline
SET sold_quantity = COALESCE(
  (SELECT i.sold_quantity FROM inventory_items i WHERE i.variant_id = inventory_baseline.variant_id),
  0
);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0018_schema_constraints', '2026-06-18 00:00:00');

COMMIT;
PRAGMA foreign_keys = ON;