/**
 * Role-aware staff menu configuration [v6.8D — Platform Security Hardening]
 *
 * Menu hiding is UX only — server-side RBAC remains mandatory on every route.
 *
 * Role markers:
 *   'super-admin-only' → only super_admin
 *   'owner-tier'       → super_admin + owner (business-level full access)
 *   literal role name  → that specific role
 */
import type { StaffRole } from './rbac';
import { isSuperAdmin, isOwnerTier } from './rbac';

export interface MenuItem {
  label: string;
  href: string;
  roles: Array<StaffRole | 'owner-tier' | 'super-admin-only'>;
}

const ALL: MenuItem[] = [
  { label: 'Dashboard', href: '/staff', roles: ['owner-tier', 'manager', 'staff', 'viewer'] },
  { label: 'Orders', href: '/staff/orders', roles: ['owner-tier', 'manager', 'staff'] },
  { label: 'Products', href: '/staff/products', roles: ['owner-tier', 'manager'] },
  { label: 'New Product', href: '/staff/products/new', roles: ['owner-tier', 'manager'] },
  { label: 'Inventory', href: '/staff/inventory', roles: ['owner-tier', 'manager'] },
  { label: 'Fraud Review', href: '/staff/fraud', roles: ['owner-tier', 'manager'] },
  { label: 'Reports', href: '/staff/reports', roles: ['owner-tier', 'manager', 'viewer'] },
  { label: 'Media Upload', href: '/staff/media', roles: ['owner-tier', 'manager'] },
  { label: 'Support', href: '/staff/support', roles: ['owner-tier', 'manager', 'staff'] },
  // Staff operations (merged sales + packing + support)
  { label: 'Sales Dashboard', href: '/staff/sales', roles: ['staff'] },
  { label: 'Create Order', href: '/staff/sales/new', roles: ['owner-tier', 'manager', 'staff'] },
  { label: 'In-Store Order', href: '/staff/sales/instore', roles: ['owner-tier', 'manager', 'staff'] },
  { label: 'POS Invoice', href: '/staff/sales/pos', roles: ['owner-tier', 'manager', 'staff'] },
  { label: 'POS History', href: '/staff/sales/pos-history', roles: ['owner-tier', 'manager', 'staff'] },
  { label: 'My Orders', href: '/staff/sales/orders', roles: ['staff'] },
  { label: 'Product Search', href: '/staff/sales/search', roles: ['staff'] },
  { label: 'Customer Notes', href: '/staff/sales/notes', roles: ['staff'] },
  { label: 'Packing Queue', href: '/staff/packing', roles: ['staff'] },
  { label: 'Packed Orders', href: '/staff/packing/packed', roles: ['staff'] },
  { label: 'Courier Handoff', href: '/staff/packing/courier', roles: ['staff'] },
  { label: 'Print Slips', href: '/staff/packing/slips', roles: ['staff'] },
  { label: 'Order Search', href: '/staff/support/search', roles: ['staff'] },
  { label: 'Escalations', href: '/staff/support/escalations', roles: ['staff'] },
  // Business owner-level (super_admin + owner)
  { label: 'Coupon Management', href: '/staff/coupons', roles: ['owner-tier'] },
  { label: 'Staff Users', href: '/staff/users', roles: ['owner-tier'] },
  { label: 'Roles & Permissions', href: '/staff/roles', roles: ['super-admin-only'] },
  { label: 'Site Settings', href: '/staff/settings', roles: ['owner-tier'] },
  { label: 'Security (2FA)', href: '/staff/settings/totp', roles: ['owner-tier'] },
  { label: 'Media / R2', href: '/staff/media-admin', roles: ['owner-tier'] },
  { label: 'Audit Logs', href: '/staff/audit', roles: ['owner-tier', 'viewer'] },
  { label: 'Guardrails', href: '/staff/guardrails', roles: ['owner-tier', 'viewer'] },
  // Platform-control (super_admin ONLY)
  { label: 'API Code / Developer', href: '/staff/api-code', roles: ['super-admin-only', 'viewer'] },
  { label: 'Backups', href: '/staff/backups', roles: ['super-admin-only'] },
];

export function menuForRole(role: StaffRole): MenuItem[] {
  const superAdmin = isSuperAdmin(role);
  const owner = isOwnerTier(role);
  return ALL.filter(item =>
    item.roles.some(r => {
      if (r === 'super-admin-only') return superAdmin;
      if (r === 'owner-tier') return owner;
      return r === role;
    })
  );
}
