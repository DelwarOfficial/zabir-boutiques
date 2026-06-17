-- Rollback for 0017: drop view and revert inventory_items (strip generated/sold)
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

DROP VIEW IF EXISTS variants;

-- Rebuild without the new columns
CREATE TABLE inventory_items_old (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL UNIQUE REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1)),
  updated_at TEXT NOT NULL
);

INSERT INTO inventory_items_old (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
SELECT id, variant_id, quantity, reserved_quantity, is_available, updated_at
FROM inventory_items;

DROP TABLE inventory_items;
ALTER TABLE inventory_items_old RENAME TO inventory_items;

DELETE FROM schema_migrations WHERE version = '0017_variants_stock_generated';

COMMIT;
PRAGMA foreign_keys = ON;
