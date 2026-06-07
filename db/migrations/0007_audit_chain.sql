-- Zabir Boutiques v6.8D — Tamper-Evident Audit Ledger
-- Adds hash chain columns to audit_log for integrity verification.
-- Each row stores SHA-256(previous_row_hash + row_fields) as chain_hash.
-- A checkpoint row is inserted daily by cron for forward integrity.

ALTER TABLE audit_log ADD COLUMN previous_hash TEXT;
ALTER TABLE audit_log ADD COLUMN chain_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS audit_checkpoints (
  id TEXT PRIMARY KEY,
  last_audit_id TEXT NOT NULL REFERENCES audit_log(id),
  chain_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ('0007_audit_chain', '2026-06-07 00:00:00');
