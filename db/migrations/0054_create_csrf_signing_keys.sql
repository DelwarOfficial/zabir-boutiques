CREATE TABLE IF NOT EXISTS csrf_signing_keys (
  id TEXT PRIMARY KEY,
  key_cipher BLOB NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_csrf_signing_keys_current ON csrf_signing_keys(is_current, created_at);
