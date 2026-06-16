-- Rollback for 0003_staff_operations_v2.sql
-- Drops columns and the index added in 0003.
-- Note: SQLite cannot DROP a column with a CHECK constraint referenced
-- by a UNIQUE/PRIMARY KEY. The CHECK constraints on payment_method /
-- order_channel are defined in 0001. If 0001's CHECK was extended
-- after 0003, this rollback may need a table rebuild via
-- PRAGMA foreign_keys = OFF; rebuild; ON.
DROP INDEX IF EXISTS idx_orders_created_by;
ALTER TABLE coupons DROP COLUMN created_by;
ALTER TABLE orders DROP COLUMN balance_paisa;
ALTER TABLE orders DROP COLUMN advance_paisa;
ALTER TABLE orders DROP COLUMN order_channel;
ALTER TABLE orders DROP COLUMN created_by;

DELETE FROM schema_migrations WHERE version = '0003_staff_operations_v2';
