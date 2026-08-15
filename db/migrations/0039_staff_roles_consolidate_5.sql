-- Zabir Boutiques Master Plan §17.2 — Consolidate 8 roles → 5 roles
--
-- Migrates from: super_admin, owner, manager, salesman, packing, support, developer, auditor
-- To:           super_admin, owner, manager, staff, viewer
--
-- Mapping:
--   salesman + packing + support  → staff  (combined permissions)
--   developer + auditor           → viewer (read-only permissions)
--
-- N-16: the original version of this file used `ALTER TABLE ... DROP CHECK
-- IF EXISTS` / `ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)` to swap the
-- role CHECK constraint. SQLite/D1 has no such ALTER TABLE form at all (not
-- a version gate — it was never valid syntax), so that step has never
-- successfully applied anywhere. Rewritten using the table-rebuild pattern
-- already established for staff_users in
-- 0009_staff_roles_developer_auditor.sql's own comments (CREATE ..._new,
-- copy, DROP, RENAME), wrapped in PRAGMA foreign_keys OFF/ON so the FK from
-- staff_sessions/password_reset_tokens/etc. survives the rename. Column
-- list and defaults below were read directly off the live production
-- schema (PRAGMA table_info(staff_users)) to guarantee an exact match.
--
-- Also updates the roles/role_permissions seed tables created in 0036.

PRAGMA foreign_keys = OFF;

-- Step 1 & 2 combined: rebuild staff_users with the 5-role CHECK
-- constraint, remapping old role values to new ones INSIDE the copying
-- SELECT (a CASE expression), not as a separate UPDATE beforehand. A
-- pre-UPDATE on the OLD table would itself violate the OLD table's
-- still-active 8-role CHECK the moment it tries to write 'staff' or
-- 'viewer' — those aren't in the old constraint's allowed set. Folding
-- the remap into the INSERT...SELECT means every row is written exactly
-- once, already in its final, valid form.
CREATE TABLE staff_users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff'
    CHECK (role IN ('super_admin','owner','manager','staff','viewer')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  password_salt TEXT,
  totp_secret TEXT,
  totp_enrolled_at TEXT,
  totp_required INTEGER NOT NULL DEFAULT 0,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

INSERT INTO staff_users_new (
  id, email, phone, password_hash, full_name, role, is_active,
  last_login_at, created_at, updated_at, password_salt,
  totp_secret, totp_enrolled_at, totp_required
)
SELECT
  id, email, phone, password_hash, full_name,
  CASE
    WHEN role IN ('salesman', 'packing', 'support') THEN 'staff'
    WHEN role IN ('developer', 'auditor') THEN 'viewer'
    ELSE role
  END,
  is_active,
  last_login_at, created_at, updated_at, password_salt,
  totp_secret, totp_enrolled_at, totp_required
FROM staff_users;

DROP TABLE staff_users;
ALTER TABLE staff_users_new RENAME TO staff_users;

PRAGMA foreign_keys = ON;

-- Step 3: Update roles table: replace old 8 roles with 5 consolidated roles
UPDATE roles SET name = 'staff', display_name = 'Staff', description = 'Combined sales + packing + support. Create orders, pack, ship, support notes.' WHERE name = 'salesman';
UPDATE roles SET name = 'staff', display_name = 'Staff', description = 'Combined sales + packing + support. Create orders, pack, ship, support notes.' WHERE name = 'packing' AND NOT EXISTS (SELECT 1 FROM roles WHERE name = 'staff');
UPDATE roles SET name = 'staff', display_name = 'Staff', description = 'Combined sales + packing + support. Create orders, pack, ship, support notes.' WHERE name = 'support' AND NOT EXISTS (SELECT 1 FROM roles WHERE name = 'staff');
DELETE FROM roles WHERE name IN ('packing', 'support') AND EXISTS (SELECT 1 FROM roles WHERE name = 'staff');

UPDATE roles SET name = 'viewer', display_name = 'Viewer', description = 'Read-only: audit logs, reports, API code view.' WHERE name = 'developer';
UPDATE roles SET name = 'viewer', display_name = 'Viewer', description = 'Read-only: audit logs, reports, API code view.' WHERE name = 'auditor' AND NOT EXISTS (SELECT 1 FROM roles WHERE name = 'viewer');
DELETE FROM roles WHERE name = 'auditor' AND EXISTS (SELECT 1 FROM roles WHERE name = 'viewer');

-- Step 4: Update role_permissions: replace old role IDs with consolidated IDs
-- Staff gets: orders.view, orders.create, orders.update, orders.pack, orders.ship, support.view, support.note
-- First, find the staff role ID
-- If we merged salesman/packing/support into one 'staff', we need to update permissions

DELETE FROM role_permissions WHERE role_id IN (
  SELECT id FROM roles WHERE name IN ('salesman', 'packing', 'support', 'developer', 'auditor')
);

-- Staff role permissions (merged salesman + packing + support)
-- N-16: neither `CROSS JOIN (VALUES ...) AS p(permission)` nor a chained
-- `UNION ALL` derived table survive D1's stricter compound-SELECT limits
-- (confirmed against a live production apply attempt). Flat one-statement-
-- per-permission inserts — the same pattern already used, unmodified, in
-- this file's own rollback — are the portable option.
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'orders.view' FROM roles WHERE name = 'staff';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'orders.create' FROM roles WHERE name = 'staff';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'orders.update' FROM roles WHERE name = 'staff';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'orders.pack' FROM roles WHERE name = 'staff';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'orders.ship' FROM roles WHERE name = 'staff';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'support.view' FROM roles WHERE name = 'staff';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'support.note' FROM roles WHERE name = 'staff';

-- Viewer role permissions (merged developer + auditor)
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'api_code.read' FROM roles WHERE name = 'viewer';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'system.audit.view' FROM roles WHERE name = 'viewer';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'reports.view' FROM roles WHERE name = 'viewer';

-- Step 5: Delete old role entries that no longer exist
DELETE FROM roles WHERE name IN ('salesman', 'packing', 'support', 'developer', 'auditor');
