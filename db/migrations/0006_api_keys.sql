-- Zabir Boutiques v6.8D — API Key Infrastructure
-- External API keys for programmatic access (checkout, webhooks, etc.)
-- Keys are stored as HMAC-SHA256 hashes; the raw key is shown once at creation.

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL DEFAULT '[]',
  is_revoked INTEGER NOT NULL DEFAULT 0 CHECK (is_revoked IN (0,1)),
  last_used_at TEXT,
  created_by TEXT REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ('0006_api_keys', '2026-06-07 00:00:00');
