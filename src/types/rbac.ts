export interface Role {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  is_system: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface RoleWithPermissions extends Role {
  permissions: string[];
  staff_count: number;
}

export interface CreateRoleInput {
  name: string;
  display_name: string;
  description?: string;
  permissions: string[];
}

export interface UpdateRoleInput {
  display_name?: string;
  description?: string;
}

export interface StaffMember {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string;
  role: string;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
}

export interface PermissionMeta {
  name: string;
  label: string;
  description: string;
}

export interface PermissionGroup {
  category: string;
  label: string;
  permissions: PermissionMeta[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    category: 'orders',
    label: 'Orders',
    permissions: [
      { name: 'orders.view', label: 'View Orders', description: 'View all orders and order details' },
      { name: 'orders.create', label: 'Create Orders', description: 'Create new orders' },
      { name: 'orders.update', label: 'Update Orders', description: 'Modify existing orders' },
      { name: 'orders.confirm', label: 'Confirm Orders', description: 'Confirm and approve orders' },
      { name: 'orders.cancel', label: 'Cancel Orders', description: 'Cancel existing orders' },
      { name: 'orders.pack', label: 'Pack Orders', description: 'Mark orders as packed' },
      { name: 'orders.ship', label: 'Ship Orders', description: 'Mark orders as shipped via courier' },
    ],
  },
  {
    category: 'payments',
    label: 'Payments',
    permissions: [
      { name: 'payments.view', label: 'View Payments', description: 'View payment details and history' },
      { name: 'payments.verify', label: 'Verify Payments', description: 'Verify and confirm payments' },
      { name: 'payments.refund', label: 'Process Refunds', description: 'Issue refunds to customers' },
    ],
  },
  {
    category: 'products',
    label: 'Products & Categories',
    permissions: [
      { name: 'products.manage', label: 'Manage Products', description: 'Create, edit, and publish products' },
      { name: 'categories.manage', label: 'Manage Categories', description: 'Create and organize categories' },
    ],
  },
  {
    category: 'inventory',
    label: 'Inventory',
    permissions: [
      { name: 'inventory.manage', label: 'Manage Inventory', description: 'View and manage stock levels' },
      { name: 'inventory.adjust', label: 'Adjust Inventory', description: 'Make manual stock adjustments' },
    ],
  },
  {
    category: 'fraud',
    label: 'Fraud Management',
    permissions: [
      { name: 'fraud.view', label: 'View Fraud Flags', description: 'View fraud review queue and decisions' },
      { name: 'fraud.override', label: 'Override Fraud', description: 'Override fraud block decisions' },
    ],
  },
  {
    category: 'support',
    label: 'Support',
    permissions: [
      { name: 'support.view', label: 'View Support', description: 'View customer support tickets' },
      { name: 'support.note', label: 'Add Support Notes', description: 'Add notes to orders and tickets' },
    ],
  },
  {
    category: 'staff',
    label: 'Staff & Roles',
    permissions: [
      { name: 'staff.manage', label: 'Manage Staff', description: 'Add, edit, and deactivate staff users' },
      { name: 'roles.manage', label: 'Manage Roles', description: 'Create and modify roles and permissions' },
    ],
  },
  {
    category: 'settings',
    label: 'Settings',
    permissions: [
      { name: 'settings.manage', label: 'Manage Settings', description: 'Configure site settings' },
      { name: 'settings.platform.read', label: 'Read Platform Settings', description: 'View platform-level settings' },
      { name: 'settings.platform.update', label: 'Update Platform Settings', description: 'Modify platform-level settings' },
    ],
  },
  {
    category: 'integrations',
    label: 'Integrations',
    permissions: [
      { name: 'integrations.read', label: 'View Integrations', description: 'View integration configurations' },
      { name: 'integrations.test', label: 'Test Integrations', description: 'Run integration connection tests' },
      { name: 'integrations.logs.read', label: 'View Integration Logs', description: 'Read integration request logs' },
    ],
  },
  {
    category: 'api_keys',
    label: 'API Keys',
    permissions: [
      { name: 'api_keys.read', label: 'View API Keys', description: 'List and view API key metadata' },
      { name: 'api_keys.create', label: 'Create API Keys', description: 'Generate new API keys' },
      { name: 'api_keys.revoke', label: 'Revoke API Keys', description: 'Revoke active API keys' },
      { name: 'api_keys.delete', label: 'Delete API Keys', description: 'Permanently delete API keys' },
    ],
  },
  {
    category: 'api_code',
    label: 'API Code',
    permissions: [
      { name: 'api_code.read', label: 'View API Code', description: 'View API code and documentation' },
      { name: 'api_code.update', label: 'Update API Code', description: 'Modify API code and endpoints' },
    ],
  },
  {
    category: 'backups',
    label: 'Backups',
    permissions: [
      { name: 'backups.read', label: 'View Backups', description: 'List available backups' },
      { name: 'backups.download', label: 'Download Backups', description: 'Download backup archives' },
      { name: 'backups.restore', label: 'Restore Backups', description: 'Trigger backup restoration' },
    ],
  },
  {
    category: 'webhooks',
    label: 'Webhooks',
    permissions: [
      { name: 'webhooks.read', label: 'View Webhooks', description: 'List webhook configurations' },
      { name: 'webhooks.update', label: 'Update Webhooks', description: 'Modify webhook settings' },
    ],
  },
  {
    category: 'media',
    label: 'Media',
    permissions: [
      { name: 'media.upload', label: 'Upload Media', description: 'Upload images and assets to R2' },
    ],
  },
  {
    category: 'reports',
    label: 'Reports',
    permissions: [
      { name: 'reports.view', label: 'View Reports', description: 'Access sales and performance reports' },
    ],
  },
  {
    category: 'system',
    label: 'System',
    permissions: [
      { name: 'system.audit.view', label: 'View Audit Logs', description: 'View tamper-proof audit trail' },
      { name: 'system.backup.manage', label: 'Manage System Backups', description: 'Full backup management' },
      { name: 'system.api_code.manage', label: 'Manage API Code', description: 'Full API code administration' },
    ],
  },
  {
    category: 'platform',
    label: 'Platform Access',
    permissions: [
      { name: 'owner.full_access', label: 'Owner Full Access', description: 'Grants all business-level permissions' },
      { name: 'platform.full_access', label: 'Platform Full Access', description: 'Grants all platform-level permissions (super_admin only)' },
    ],
  },
];

export function getAllPermissions(): string[] {
  return PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.name));
}

export function getPermissionLabel(name: string): string {
  for (const group of PERMISSION_GROUPS) {
    for (const perm of group.permissions) {
      if (perm.name === name) return perm.label;
    }
  }
  return name;
}

export function getPermissionDescription(name: string): string {
  for (const group of PERMISSION_GROUPS) {
    for (const perm of group.permissions) {
      if (perm.name === name) return perm.description;
    }
  }
  return '';
}
