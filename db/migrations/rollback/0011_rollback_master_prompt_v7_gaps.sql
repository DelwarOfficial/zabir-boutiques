-- Rollback for 0011_master_prompt_v7_gaps.sql
-- Drops the 8 tables introduced in 0011. The CHECK-constraint
-- extensions for orders.status / payments.status / order_status_history
-- were applied in 0013, not 0011, so they are not reverted here.
DROP INDEX IF EXISTS idx_session_blacklist_expires;
DROP TABLE IF EXISTS session_blacklist;
DROP TABLE IF EXISTS coupon_brute_force;
DROP INDEX IF EXISTS idx_customer_consent_type;
DROP INDEX IF EXISTS idx_customer_consent_session;
DROP TABLE IF EXISTS customer_consent;
DROP INDEX IF EXISTS idx_sitemap_metadata_modified;
DROP TABLE IF EXISTS sitemap_metadata;
DROP INDEX IF EXISTS idx_return_requests_status;
DROP INDEX IF EXISTS idx_return_requests_order;
DROP TABLE IF EXISTS return_requests;
DROP INDEX IF EXISTS idx_email_log_status;
DROP INDEX IF EXISTS idx_email_log_order;
DROP TABLE IF EXISTS email_log;
DROP INDEX IF EXISTS idx_stock_adjustments_variant;
DROP TABLE IF EXISTS stock_adjustments;

DELETE FROM schema_migrations WHERE version = '0011_master_prompt_v7_gaps';
