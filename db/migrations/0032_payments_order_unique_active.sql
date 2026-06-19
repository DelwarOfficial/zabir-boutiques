-- 0032_payments_order_unique_active
-- Prevents TOCTOU race where two concurrent payment creation requests for the
-- same order_id can both succeed (Master Plan §2.6, P0-07).
--
-- Partial unique index: at most one active payment (created/pending/processing)
-- per order. Paid, cancelled, or failed payments are excluded so historical
-- records do not conflict.

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_order_unique_active
  ON payments(order_id)
  WHERE status IN ('created', 'pending', 'processing');

-- Update the existing non-unique index to include status for query efficiency
DROP INDEX IF EXISTS idx_payments_order;
CREATE INDEX IF NOT EXISTS idx_payments_order_status
  ON payments(order_id, status);
