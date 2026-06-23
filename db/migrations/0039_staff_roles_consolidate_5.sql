-- Zabir Boutiques Master Plan §17.2 — Consolidate 8 roles → 5 roles
--
-- Migrates from: super_admin, owner, manager, salesman, packing, support, developer, auditor
-- To:           super_admin, owner, manager, staff, viewer
--
-- Mapping:
--   salesman + packing + support  → staff  (combined permissions)
--   developer + auditor           → viewer (read-only permissions)
--
-- Also updates the roles/role_permissions seed tables created in 0036.

-- Step 1: Migrate existing staff_users.role values
UPDATE staff_users SET role = 'staff' WHERE role IN ('salesman', 'packing', 'support');
UPDATE staff_users SET role = 'viewer' WHERE role IN ('developer', 'auditor');

-- Step 2: Drop old CHECK constraint on staff_users.role (D1 SQLite supports DROP CHECK since 3.25.2)
ALTER TABLE staff_users DROP CHECK IF EXISTS "staff_users_role_check";

-- Step 3: Add new CHECK constraint for 5 roles
ALTER TABLE staff_users ADD CONSTRAINT "staff_users_role_check" CHECK (role IN ('super_admin', 'owner', 'manager', 'staff', 'viewer'));

-- Step 4: Update roles table: replace old 8 roles with 5 consolidated roles
UPDATE roles SET name = 'staff', display_name = 'Staff', description = 'Combined sales + packing + support. Create orders, pack, ship, support notes.' WHERE name = 'salesman';
UPDATE roles SET name = 'staff', display_name = 'Staff', description = 'Combined sales + packing + support. Create orders, pack, ship, support notes.' WHERE name = 'packing' AND NOT EXISTS (SELECT 1 FROM roles WHERE name = 'staff');
UPDATE roles SET name = 'staff', display_name = 'Staff', description = 'Combined sales + packing + support. Create orders, pack, ship, support notes.' WHERE name = 'support' AND NOT EXISTS (SELECT 1 FROM roles WHERE name = 'staff');
DELETE FROM roles WHERE name IN ('packing', 'support') AND EXISTS (SELECT 1 FROM roles WHERE name = 'staff');

UPDATE roles SET name = 'viewer', display_name = 'Viewer', description = 'Read-only: audit logs, reports, API code view.' WHERE name = 'developer';
UPDATE roles SET name = 'viewer', display_name = 'Viewer', description = 'Read-only: audit logs, reports, API code view.' WHERE name = 'auditor' AND NOT EXISTS (SELECT 1 FROM roles WHERE name = 'viewer');
DELETE FROM roles WHERE name = 'auditor' AND EXISTS (SELECT 1 FROM roles WHERE name = 'viewer');

-- Step 5: Update role_permissions: replace old role IDs with consolidated IDs
-- Staff gets: orders.view, orders.create, orders.update, orders.pack, orders.ship, support.view, support.note
-- First, find the staff role ID
-- If we merged salesman/packing/support into one 'staff', we need to update permissions

DELETE FROM role_permissions WHERE role_id IN (
  SELECT id FROM roles WHERE name IN ('salesman', 'packing', 'support', 'developer', 'auditor')
);

-- Staff role permissions (merged salesman + packing + support)
INSERT OR IGNORE INTO role_permissions (role_id, permission)
SELECT r.id, p.permission FROM (SELECT id FROM roles WHERE name = 'staff') r
CROSS JOIN (VALUES
  ('orders.view'), ('orders.create'), ('orders.update'),
  ('orders.pack'), ('orders.ship'),
  ('support.view'), ('support.note')
) AS p(permission);

-- Viewer role permissions (merged developer + auditor)
INSERT OR IGNORE INTO role_permissions (role_id, permission)
SELECT r.id, p.permission FROM (SELECT id FROM roles WHERE name = 'viewer') r
CROSS JOIN (VALUES
  ('api_code.read'), ('system.audit.view'), ('reports.view')
) AS p(permission);

-- Step 6: Delete old role entries that no longer exist
DELETE FROM roles WHERE name IN ('salesman', 'packing', 'support', 'developer', 'auditor');
