-- Courier handoff tracking on orders (Master Plan §2.4 courier APIs)

ALTER TABLE orders ADD COLUMN courier_provider TEXT;
ALTER TABLE orders ADD COLUMN courier_tracking_number TEXT;
ALTER TABLE orders ADD COLUMN courier_handoff_at TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_courier_handoff
  ON orders(courier_handoff_at)
  WHERE courier_tracking_number IS NOT NULL;