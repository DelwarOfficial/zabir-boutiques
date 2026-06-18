-- Rollback: Remove TOTP 2FA columns from staff_users
ALTER TABLE staff_users DROP COLUMN totp_secret;
ALTER TABLE staff_users DROP COLUMN totp_enrolled_at;
ALTER TABLE staff_users DROP COLUMN totp_required;
