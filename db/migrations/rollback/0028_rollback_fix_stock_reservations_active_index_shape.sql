DROP INDEX IF EXISTS idx_stock_reservations_order_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_reservations_order_active
  ON stock_reservations(order_id)
  WHERE status = 'active';
