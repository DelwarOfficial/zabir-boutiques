-- Migration: Add TOTP 2FA secret to staff_users [Master_Prompt v7.0 §18.1]
-- Owner role requires TOTP 2FA for login.

ALTER TABLE staff_users ADD COLUMN totp_secret TEXT;
ALTER TABLE staff_users ADD COLUMN totp_enrolled_at TEXT;
ALTER TABLE staff_users ADD COLUMN totp_required INTEGER NOT NULL DEFAULT 0;
