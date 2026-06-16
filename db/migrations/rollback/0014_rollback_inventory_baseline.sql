-- Rollback for 0014_inventory_baseline.sql
-- Drops the inventory_baseline table and its index. The Phase-7
-- reconcile code reverts to the audit-flagged no-op behavior.
DROP INDEX IF EXISTS idx_inventory_baseline_set_at;
DROP TABLE IF EXISTS inventory_baseline;

DELETE FROM schema_migrations WHERE version = '0014_inventory_baseline';
