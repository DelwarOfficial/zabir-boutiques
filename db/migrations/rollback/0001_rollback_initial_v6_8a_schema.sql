-- Rollback for 0001_initial_v6_8a_schema.sql
-- Drops the 21 tables created by the initial schema.
-- WARNING: this is destructive and irreversible. Run only on a known
-- recoverable environment (e.g. a fresh staging D1 seeded from a
-- backup).
DROP TABLE IF EXISTS fraud_polls;
DROP TABLE IF EXISTS checkout_idempotency;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS site_settings;
DROP TABLE IF EXISTS low_stock_alerts;
DROP TABLE IF EXISTS payment_events;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS order_status_history;
DROP TABLE IF EXISTS stock_reservations;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS fraud_checks;
DROP TABLE IF EXISTS coupons;
DROP TABLE IF EXISTS inventory_items;
DROP TABLE IF EXISTS product_images;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS staff_sessions;
DROP TABLE IF EXISTS staff_users;
DROP TABLE IF EXISTS schema_migrations;

DELETE FROM schema_migrations WHERE version = '0001_initial_v6_8a';
