DROP INDEX IF EXISTS idx_stock_reservations_order_active;
-- ROLLBACK_EXCEPTION: column release_requested_at left in place; harmless and idempotent.
