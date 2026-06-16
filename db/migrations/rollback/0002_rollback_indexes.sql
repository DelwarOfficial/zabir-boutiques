-- Rollback for 0002_indexes.sql
-- Drops the 27 indexes created by the indexes migration.
DROP INDEX IF EXISTS idx_product_images_product;
DROP INDEX IF EXISTS idx_order_status_history_order;
DROP INDEX IF EXISTS idx_audit_log_actor;
DROP INDEX IF EXISTS idx_audit_log_created;
DROP INDEX IF EXISTS idx_audit_log_entity;
DROP INDEX IF EXISTS idx_fraud_polls_status;
DROP INDEX IF EXISTS idx_fraud_checks_phone;
DROP INDEX IF EXISTS idx_fraud_checks_order;
DROP INDEX IF EXISTS idx_payment_events_invoice;
DROP INDEX IF EXISTS idx_payments_invoice;
DROP INDEX IF EXISTS idx_payments_order;
DROP INDEX IF EXISTS idx_order_items_order;
DROP INDEX IF EXISTS idx_reservations_order;
DROP INDEX IF EXISTS idx_reservations_status_expires;
DROP INDEX IF EXISTS idx_variants_sku;
DROP INDEX IF EXISTS idx_variants_product;
DROP INDEX IF EXISTS idx_categories_sort;
DROP INDEX IF EXISTS idx_categories_slug;
DROP INDEX IF EXISTS idx_products_category;
DROP INDEX IF EXISTS idx_products_status;
DROP INDEX IF EXISTS idx_products_slug;
DROP INDEX IF EXISTS idx_inventory_variant;
DROP INDEX IF EXISTS idx_low_stock_unacknowledged;
DROP INDEX IF EXISTS idx_sessions_token_active;
DROP INDEX IF EXISTS idx_orders_created;
DROP INDEX IF EXISTS idx_orders_number;
DROP INDEX IF EXISTS idx_orders_status;
DROP INDEX IF EXISTS idx_orders_phone;

DELETE FROM schema_migrations WHERE version = '0002_indexes';
