-- Migration: allow release_requested reservation status [Master Plan V7 §12.3]

CREATE TABLE stock_reservations_v7 (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','release_requested','confirmed','released','expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  release_requested_at TEXT
);

INSERT INTO stock_reservations_v7 (
  id, order_id, variant_id, quantity, status, expires_at, created_at, updated_at, release_requested_at
)
SELECT
  id, order_id, variant_id, quantity, status, expires_at, created_at, updated_at, release_requested_at
FROM stock_reservations;

DROP TABLE stock_reservations;
ALTER TABLE stock_reservations_v7 RENAME TO stock_reservations;

CREATE INDEX IF NOT EXISTS idx_reservations_status_expires ON stock_reservations(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_reservations_order ON stock_reservations(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_reservations_order_active
  ON stock_reservations(order_id, variant_id)
  WHERE status = 'active';
