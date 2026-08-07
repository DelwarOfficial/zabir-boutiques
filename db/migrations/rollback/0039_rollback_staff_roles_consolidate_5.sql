-- Rollback: Restore 8 roles from 5-role consolidation
--
-- Inverse mapping:
--   staff  → salesman (default), packing and support entries are re-added
--   viewer → developer (default), auditor entry is re-added

-- Step 1: Drop the 5-role CHECK constraint
ALTER TABLE staff_users DROP CHECK IF EXISTS "staff_users_role_check";

-- Step 2: Add old 8-role CHECK constraint
ALTER TABLE staff_users ADD CONSTRAINT "staff_users_role_check" CHECK (role IN ('super_admin','owner','manager','salesman','packing','support','developer','auditor'));

-- Step 3: Migrate staff_users back. Staff with orders.pack or orders.ship perms → packing, otherwise salesman.
UPDATE staff_users SET role = 'salesman' WHERE role = 'staff';
UPDATE staff_users SET role = 'developer' WHERE role = 'viewer';

-- Step 4: Restore roles that were deleted
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

-- Step 5: Restore role_permissions
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
