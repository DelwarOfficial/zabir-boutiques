CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         TEXT PRIMARY KEY,
  staff_id   TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_tokens_staff ON password_reset_tokens(staff_id);

-- Rate limiting for forgot-password attempts per IP
CREATE TABLE IF NOT EXISTS password_reset_rate_limits (
  ip_address    TEXT NOT NULL,
  attempted_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_rate_ip ON password_reset_rate_limits(ip_address);
