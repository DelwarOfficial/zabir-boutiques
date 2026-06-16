-- Rollback for 0008_security_hardening.sql
-- Drops the api_keys hardening columns, the media_objects table,
-- the audit-integrity alerts table, the audit_log append-only
-- triggers, and reverts the api_keys data migration.
DROP TRIGGER IF EXISTS trg_audit_log_no_delete;
DROP TRIGGER IF EXISTS trg_audit_log_no_update;
DROP TABLE IF EXISTS audit_integrity_alerts;
DROP INDEX IF EXISTS idx_media_objects_api_key;
DROP INDEX IF EXISTS idx_media_objects_staff;
DROP INDEX IF EXISTS idx_media_objects_owner;
DROP TABLE IF EXISTS media_objects;
DROP INDEX IF EXISTS idx_api_keys_active_expiry;
ALTER TABLE api_keys DROP COLUMN scope_version;
ALTER TABLE api_keys DROP COLUMN purpose;
ALTER TABLE api_keys DROP COLUMN environment;
ALTER TABLE api_keys DROP COLUMN rate_limit_profile;
ALTER TABLE api_keys DROP COLUMN allowed_ips_json;
ALTER TABLE api_keys DROP COLUMN revoked_at;
ALTER TABLE api_keys DROP COLUMN expires_at;
ALTER TABLE api_keys DROP COLUMN scopes_json;

DELETE FROM schema_migrations WHERE version = '0008_security_hardening';
