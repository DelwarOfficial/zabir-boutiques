-- Zabir Boutiques v6.8D -- Security hardening for scoped API keys, media object ACLs, and audit integrity.

ALTER TABLE api_keys ADD COLUMN scopes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE api_keys ADD COLUMN expires_at TEXT;
ALTER TABLE api_keys ADD COLUMN revoked_at TEXT;
ALTER TABLE api_keys ADD COLUMN allowed_ips_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE api_keys ADD COLUMN rate_limit_profile TEXT NOT NULL DEFAULT 'strict';
ALTER TABLE api_keys ADD COLUMN environment TEXT NOT NULL DEFAULT 'prod';
ALTER TABLE api_keys ADD COLUMN purpose TEXT NOT NULL DEFAULT '';
ALTER TABLE api_keys ADD COLUMN scope_version INTEGER NOT NULL DEFAULT 1;

UPDATE api_keys SET scopes_json = permissions WHERE scopes_json = '[]' AND permissions IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_active_expiry ON api_keys(is_revoked, expires_at);

CREATE TABLE IF NOT EXISTS media_objects (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  bucket TEXT NOT NULL CHECK (bucket IN ('MEDIA','BACKUPS')),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('product','staff_upload','integration','client_private','backup')),
  owner_id TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public','staff','owner_only','private_client')),
  content_type TEXT NOT NULL,
  sha256 TEXT,
  uploaded_by_staff_id TEXT REFERENCES staff_users(id) ON DELETE RESTRICT,
  uploaded_by_api_key_id TEXT REFERENCES api_keys(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_objects_owner ON media_objects(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_media_objects_staff ON media_objects(uploaded_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_media_objects_api_key ON media_objects(uploaded_by_api_key_id);

INSERT OR IGNORE INTO media_objects (
  id, r2_key, bucket, owner_type, owner_id, visibility, content_type, sha256,
  uploaded_by_staff_id, uploaded_by_api_key_id, created_at
)
SELECT id, r2_key, 'MEDIA', 'product', product_id, 'staff', 'application/octet-stream', NULL,
       NULL, NULL, created_at
FROM product_images;

CREATE TABLE IF NOT EXISTS audit_integrity_alerts (
  id TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL,
  valid INTEGER NOT NULL CHECK (valid IN (0,1)),
  checked_rows INTEGER NOT NULL DEFAULT 0,
  first_bad_index INTEGER,
  details_json TEXT
);

CREATE TRIGGER IF NOT EXISTS trg_audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ('0008_security_hardening', '2026-06-08 00:00:00');
