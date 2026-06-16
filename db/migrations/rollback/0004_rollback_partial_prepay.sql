-- Rollback for 0004_partial_prepay.sql
-- Drops the partial-prepay index. The payment_method CHECK and
-- payment_status enum were already in 0001 (or updated in 0013);
-- those are not reverted here.
DROP INDEX IF EXISTS idx_orders_partial_prepay;

DELETE FROM schema_migrations WHERE version = '0004_partial_prepay';
