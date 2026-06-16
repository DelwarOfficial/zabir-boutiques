-- Rollback for 0006_api_keys.sql
-- Drops the api_keys table and its index. Any issued API keys become
-- invalid immediately; rotate and re-issue before re-running 0006.
DROP INDEX IF EXISTS idx_api_keys_key_hash;
DROP TABLE IF EXISTS api_keys;

DELETE FROM schema_migrations WHERE version = '0006_api_keys';
