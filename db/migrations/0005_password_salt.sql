-- Zabir Boutiques v6.8D — PBKDF2 Password Hashing Migration
-- Adds per-user salt column and removes the NOT NULL constraint from
-- password_hash during the transition period (old hashes remain valid
-- until the user next logs in, at which point they are upgraded inline).

-- 1. Add password_salt column (nullable for existing HMAC users)
ALTER TABLE staff_users ADD COLUMN password_salt TEXT;

-- Record this migration
INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ('0005_password_salt', '2026-06-07 00:00:00');
