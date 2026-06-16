-- Rollback for 0007_audit_chain.sql
-- Drops the audit chain columns and the audit_checkpoints table.
-- All chain_hash / previous_hash data is lost. The append-only
-- trigger was added in 0008 (not 0007), so this rollback does not
-- touch triggers.
DROP TABLE IF EXISTS audit_checkpoints;
DROP INDEX IF EXISTS idx_audit_log_created_at;
ALTER TABLE audit_log DROP COLUMN chain_hash;
ALTER TABLE audit_log DROP COLUMN previous_hash;

DELETE FROM schema_migrations WHERE version = '0007_audit_chain';
