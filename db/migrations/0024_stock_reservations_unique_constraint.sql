-- Migration: stock reservation race prevention [Master Plan V7 §12.3, §35]
-- Pre-flight before remote apply:
-- SELECT order_id, COUNT(*) AS active_reservations
-- FROM stock_reservations
-- WHERE status = 'active'
-- GROUP BY order_id
-- HAVING COUNT(*) > 1;

ALTER TABLE stock_reservations ADD COLUMN release_requested_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_reservations_order_active
  ON stock_reservations(order_id, variant_id)
  WHERE status = 'active';
