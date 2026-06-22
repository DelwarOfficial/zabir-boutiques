-- RBAC Management Tables [v6.8D]
-- Enables dynamic role + permission management via the staff UI.
-- Backed by the static matrix in src/lib/rbac.ts for runtime enforcement.

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT REFERENCES staff_users(id),
  updated_by TEXT REFERENCES staff_users(id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_by TEXT REFERENCES staff_users(id),
  PRIMARY KEY (role_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);

-- Seed system roles
INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system, created_at, updated_at) VALUES ('r0000000-0000-0000-0000-000000000001', 'super_admin', 'Super Admin', 'Full platform + business access. System configuration, API keys, integrations, backups, all operations.', 1, datetime('now'), datetime('now'));
INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system, created_at, updated_at) VALUES ('r0000000-0000-0000-0000-000000000002', 'owner', 'Owner', 'Full business-level access. Staff, roles, products, orders, payments, fraud, reports. No platform-level controls.', 1, datetime('now'), datetime('now'));
INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system, created_at, updated_at) VALUES ('r0000000-0000-0000-0000-000000000003', 'manager', 'Manager', 'Daily operations: products, categories, inventory, orders, fraud review, media, support, reports.', 1, datetime('now'), datetime('now'));
INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system, created_at, updated_at) VALUES ('r0000000-0000-0000-0000-000000000004', 'salesman', 'Sales Staff', 'Sales + COD order creation. View orders, create/update, support notes.', 1, datetime('now'), datetime('now'));
INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system, created_at, updated_at) VALUES ('r0000000-0000-0000-0000-000000000005', 'packing', 'Packing Staff', 'Packing queue + courier handoff. View orders, pack, ship.', 1, datetime('now'), datetime('now'));
INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system, created_at, updated_at) VALUES ('r0000000-0000-0000-0000-000000000006', 'support', 'Support', 'Order search + support notes. View orders, add notes.', 1, datetime('now'), datetime('now'));
INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system, created_at, updated_at) VALUES ('r0000000-0000-0000-0000-000000000007', 'developer', 'Developer', 'Read-only API Code / Developer area.', 1, datetime('now'), datetime('now'));
INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system, created_at, updated_at) VALUES ('r0000000-0000-0000-0000-000000000008', 'auditor', 'Auditor', 'Read-only audit logs + reports.', 1, datetime('now'), datetime('now'));

-- super_admin: all permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'owner.full_access');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'staff.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'roles.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'settings.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'system.api_code.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'system.backup.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'system.audit.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'products.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'categories.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'inventory.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'inventory.adjust');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'orders.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'orders.create');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'orders.update');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'orders.confirm');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'orders.cancel');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'orders.pack');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'orders.ship');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'payments.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'payments.verify');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'payments.refund');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'fraud.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'fraud.override');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'media.upload');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'support.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'support.note');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'reports.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'platform.full_access');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'integrations.read');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'integrations.test');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'integrations.logs.read');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'api_keys.read');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'api_keys.create');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'api_keys.revoke');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'api_keys.delete');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'api_code.read');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'api_code.update');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'backups.read');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'backups.download');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'backups.restore');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'webhooks.read');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'webhooks.update');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'settings.platform.read');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000001', 'settings.platform.update');

-- owner: business-level
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'staff.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'roles.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'settings.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'system.audit.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'system.backup.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'products.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'categories.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'inventory.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'inventory.adjust');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'orders.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'orders.create');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'orders.update');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'orders.confirm');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'orders.cancel');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'orders.pack');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'orders.ship');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'fraud.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'fraud.override');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'media.upload');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'support.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'support.note');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'reports.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'payments.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'payments.verify');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'payments.refund');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'api_code.read');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'backups.read');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'backups.download');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000002', 'integrations.read');

-- manager
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'products.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'categories.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'inventory.manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'inventory.adjust');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'orders.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'orders.create');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'orders.update');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'orders.confirm');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'orders.cancel');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'orders.pack');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'orders.ship');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'fraud.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'media.upload');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'support.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'support.note');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'reports.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000003', 'payments.view');

-- salesman
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000004', 'orders.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000004', 'orders.create');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000004', 'orders.update');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000004', 'support.note');

-- packing
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000005', 'orders.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000005', 'orders.pack');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000005', 'orders.ship');

-- support
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000006', 'support.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000006', 'support.note');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000006', 'orders.view');

-- developer
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000007', 'api_code.read');

-- auditor
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000008', 'system.audit.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('r0000000-0000-0000-0000-000000000008', 'reports.view');
