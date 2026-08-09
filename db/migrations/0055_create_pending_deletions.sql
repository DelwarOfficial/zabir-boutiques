CREATE TABLE IF NOT EXISTS pending_deletions (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  phone_local TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'held')),
  requested_at TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  completed_at TEXT,
  hold_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_deletions_due ON pending_deletions(status, scheduled_for);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_deletions_phone_active ON pending_deletions(phone) WHERE status = 'pending';
