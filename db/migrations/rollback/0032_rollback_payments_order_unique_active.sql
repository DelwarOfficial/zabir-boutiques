-- 0032 Rollback: payments_order_unique_active
DROP INDEX IF EXISTS idx_payments_order_unique_active;
DROP INDEX IF EXISTS idx_payments_order_status;
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
