-- Rollback for 0015_tamper_lockout.sql
DROP INDEX IF EXISTS idx_tamper_lockout_window;
DROP TABLE IF EXISTS tamper_lockout;

DELETE FROM schema_migrations WHERE version = '0015_tamper_lockout';
