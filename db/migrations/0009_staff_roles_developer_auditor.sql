-- Zabir Boutiques v6.8D -- 0009: add 'developer' and 'auditor' staff roles.
--
-- This migration adds the schema_migrations marker. For fresh deployments,
-- the CHECK constraint in 0001 already includes the extended role set.
--
-- For EXISTING databases with the old CHECK constraint:
-- The Cloudflare D1 CLI cannot disable foreign_keys across commands, so
-- the table rebuild must be done via the Cloudflare Dashboard SQL console
-- where PRAGMA foreign_keys = OFF persists within the session. Run these
-- steps in the Dashboard SQL console as a single batch:
--
--   PRAGMA foreign_keys = OFF;
--   CREATE TABLE staff_users_new ( ... extended CHECK ... );
--   INSERT INTO staff_users_new SELECT * FROM staff_users;
--   DROP TABLE staff_users;
--   ALTER TABLE staff_users_new RENAME TO staff_users;
--   PRAGMA foreign_keys = ON;
--
-- After that, apply this migration file normally to record it:

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0009_staff_roles_developer_auditor', '2026-06-08 00:00:00');
