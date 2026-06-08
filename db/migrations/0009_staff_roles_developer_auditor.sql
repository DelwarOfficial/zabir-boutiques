-- Zabir Boutiques v6.8D -- 0009: add 'developer' and 'auditor' staff roles.
--
-- WHY: The RBAC model gains two scoped roles:
--   developer -> read-only API Code / Developer area (system.api_code.manage).
--                API key minting stays owner-only.
--   auditor   -> read-only audit log + reports (system.audit.view, reports.view).
--
-- staff_users.role carries a CHECK constraint and SQLite cannot ALTER a CHECK
-- in place, so the table is rebuilt (the official 12-step procedure). The table
-- is referenced by foreign keys from staff_sessions, orders, coupons, products,
-- order_status_history, audit_log, api_keys, and media_objects. The rebuilt
-- table keeps the same name, so those references remain valid; defer_foreign_keys
-- lets the DROP + RENAME complete before constraints are re-checked.
--
-- This rebuild preserves every column (including password_salt added in 0005)
-- and the inline UNIQUE(email)/UNIQUE(phone) constraints. There are no separate
-- indexes on staff_users to recreate.

PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE staff_users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'support'
    CHECK (role IN ('super_admin','owner','manager','salesman','packing','support','developer','auditor')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  password_salt TEXT,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

INSERT INTO staff_users_new
  (id, email, phone, password_hash, full_name, role, is_active, last_login_at, created_at, updated_at, password_salt)
SELECT
  id, email, phone, password_hash, full_name, role, is_active, last_login_at, created_at, updated_at, password_salt
FROM staff_users;

DROP TABLE staff_users;

ALTER TABLE staff_users_new RENAME TO staff_users;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0009_staff_roles_developer_auditor', '2026-06-08 00:00:00');
