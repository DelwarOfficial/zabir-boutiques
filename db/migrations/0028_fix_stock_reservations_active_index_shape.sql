-- Migration: align stock reservation active uniqueness with per-variant rows

DROP INDEX IF EXISTS idx_stock_reservations_order_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_reservations_order_active
  ON stock_reservations(order_id, variant_id)
  WHERE status = 'active';
