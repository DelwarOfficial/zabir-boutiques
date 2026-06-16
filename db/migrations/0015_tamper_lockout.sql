-- Zabir Boutiques v7.0 — Tamper Lockout Table
-- P1-002 audit fix: replace the non-atomic KV read-modify-write
-- counter in `assertNoClientMoneyTrust` with a D1 table that uses
-- `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1` for
-- atomic per-(ip, window) increment.
--
-- The UNIQUE(ip, window_id) constraint gives us the conflict target
-- for ON CONFLICT. The first INSERT writes a row; subsequent
-- concurrent INSERTs from the same ip+window atomically increment
-- the counter via the DO UPDATE clause. D1 serializes the
-- increment on the unique-key index, so two concurrent requests
-- both observe the post-increment count.

CREATE TABLE IF NOT EXISTS tamper_lockout (
  ip TEXT NOT NULL,
  window_id INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT NOT NULL,
  alerted_at TEXT,
  PRIMARY KEY (ip, window_id)
);

CREATE INDEX IF NOT EXISTS idx_tamper_lockout_window
  ON tamper_lockout(window_id, count);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0015_tamper_lockout', '2026-06-16 00:00:00');
