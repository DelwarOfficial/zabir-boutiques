-- Migration: customer phone OTP verification for GDPR data access/delete [v7.1]
-- Used by /api/me/verify-phone to prove phone ownership before
-- returning or anonymizing customer PII.

CREATE TABLE IF NOT EXISTS customer_phone_otps (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_customer_phone_otps_phone
  ON customer_phone_otps(phone, expires_at)
  WHERE consumed_at IS NULL;
