-- Rollback: Restore 8 roles from 5-role consolidation
--
-- Inverse mapping:
--   staff  → salesman (default), packing and support entries are re-added
--   viewer → developer (default), auditor entry is re-added
--
-- N-16: rewritten to use the same table-rebuild pattern as the forward
-- migration — SQLite/D1 has no ALTER TABLE ADD/DROP CONSTRAINT syntax.

PRAGMA foreign_keys = OFF;

-- Step 1 & 2 combined: rebuild staff_users with the old 8-role CHECK,
-- remapping staff/viewer back to salesman/developer INSIDE the copying
-- SELECT — same reasoning as the forward migration: a pre-UPDATE would
-- violate whichever CHECK is active at the time it runs.
CREATE TABLE staff_users_old (
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
  totp_secret TEXT,
  totp_enrolled_at TEXT,
  totp_required INTEGER NOT NULL DEFAULT 0,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

INSERT INTO staff_users_old (
  id, email, phone, password_hash, full_name, role, is_active,
  last_login_at, created_at, updated_at, password_salt,
  totp_secret, totp_enrolled_at, totp_required
)
SELECT
  id, email, phone, password_hash, full_name,
  CASE
    WHEN role = 'staff' THEN 'salesman'
    WHEN role = 'viewer' THEN 'developer'
    ELSE role
  END,
  is_active,
  last_login_at, created_at, updated_at, password_salt,
  totp_secret, totp_enrolled_at, totp_required
FROM staff_users;

DROP TABLE staff_users;
ALTER TABLE staff_users_old RENAME TO staff_users;

PRAGMA foreign_keys = ON;

-- Step 3: Restore roles that were deleted
INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system, created_at, updated_at)
VALUES ('r0000000-0000-0000-0000-000000000004', 'salesman', 'Sales Staff', 'Sales + COD order creation. View orders, create/update, support notes.', 1, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system, created_at, updated_at)
VALUES ('r0000000-0000-0000-0000-000000000005', 'packing', 'Packing Staff', 'Packing queue + courier handoff. View orders, pack, ship.', 1, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system, created_at, updated_at)
VALUES ('r0000000-0000-0000-0000-000000000006', 'support', 'Support', 'Order search + support notes. View orders, add notes.', 1, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system, created_at, updated_at)
VALUES ('r0000000-0000-0000-0000-000000000007', 'developer', 'Developer', 'Read-only API Code / Developer area.', 1, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system, created_at, updated_at)
VALUES ('r0000000-0000-0000-0000-000000000008', 'auditor', 'Auditor', 'Read-only audit logs + reports.', 1, datetime('now'), datetime('now'));

-- Step 4: Restore role_permissions
-- salesman
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'orders.view' FROM roles WHERE name = 'salesman';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'orders.create' FROM roles WHERE name = 'salesman';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'orders.update' FROM roles WHERE name = 'salesman';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'support.note' FROM roles WHERE name = 'salesman';

-- packing
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'orders.view' FROM roles WHERE name = 'packing';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'orders.pack' FROM roles WHERE name = 'packing';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'orders.ship' FROM roles WHERE name = 'packing';

-- support
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'support.view' FROM roles WHERE name = 'support';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'support.note' FROM roles WHERE name = 'support';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'orders.view' FROM roles WHERE name = 'support';

-- developer
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'api_code.read' FROM roles WHERE name = 'developer';

-- auditor
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'system.audit.view' FROM roles WHERE name = 'auditor';
INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'reports.view' FROM roles WHERE name = 'auditor';
