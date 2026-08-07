-- Rollback for 0035_password_reset_tokens.sql
-- Reverses: password_reset_tokens + password_reset_rate_limits tables + indexes.
-- Indexes are dropped automatically with their tables in SQLite.

DROP TABLE IF EXISTS password_reset_rate_limits;
DROP TABLE IF EXISTS password_reset_tokens;
