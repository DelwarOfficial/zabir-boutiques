-- Migration: create otp_secrets table [Master Plan V7 §6.1, §18.1, §35]

CREATE TABLE IF NOT EXISTS otp_secrets (
  staff_id TEXT PRIMARY KEY REFERENCES staff_users(id) ON DELETE CASCADE,
  secret_cipher BLOB NOT NULL,
  backup_codes_hash TEXT NOT NULL,
  enabled_at TEXT NOT NULL,
  last_used_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_otp_secrets_enabled
  ON otp_secrets(enabled_at)
  WHERE last_used_at IS NOT NULL;
