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
  { label: 'Dashboard', href: '/staff', roles: ['owner-tier', 'manager', 'salesman', 'packing', 'support', 'developer', 'auditor'] },
  { label: 'Orders', href: '/staff/orders', roles: ['owner-tier', 'manager'] },
  { label: 'Products', href: '/staff/products', roles: ['owner-tier', 'manager'] },
  { label: 'New Product', href: '/staff/products/new', roles: ['owner-tier', 'manager'] },
  { label: 'Inventory', href: '/staff/inventory', roles: ['owner-tier', 'manager'] },
  { label: 'Fraud Review', href: '/staff/fraud', roles: ['owner-tier', 'manager'] },
  { label: 'Reports', href: '/staff/reports', roles: ['owner-tier', 'manager', 'auditor'] },
  { label: 'Media Upload', href: '/staff/media', roles: ['owner-tier', 'manager'] },
  { label: 'Support', href: '/staff/support', roles: ['owner-tier', 'manager', 'support'] },
  // Sales
  { label: 'Sales Dashboard', href: '/staff/sales', roles: ['salesman'] },
  { label: 'Create Order', href: '/staff/sales/new', roles: ['owner-tier', 'manager', 'salesman'] },
  { label: 'In-Store Order', href: '/staff/sales/instore', roles: ['owner-tier', 'manager', 'salesman'] },
  { label: 'POS Invoice', href: '/staff/sales/pos', roles: ['owner-tier', 'manager', 'salesman'] },
  { label: 'POS History', href: '/staff/sales/pos-history', roles: ['owner-tier', 'manager', 'salesman'] },
  { label: 'My Orders', href: '/staff/sales/orders', roles: ['salesman'] },
  { label: 'Product Search', href: '/staff/sales/search', roles: ['salesman'] },
  { label: 'Customer Notes', href: '/staff/sales/notes', roles: ['salesman'] },
  // Packing
  { label: 'Packing Queue', href: '/staff/packing', roles: ['packing'] },
  { label: 'Packed Orders', href: '/staff/packing/packed', roles: ['packing'] },
  { label: 'Courier Handoff', href: '/staff/packing/courier', roles: ['packing'] },
  { label: 'Print Slips', href: '/staff/packing/slips', roles: ['packing'] },
  // Support extras
  { label: 'Order Search', href: '/staff/support/search', roles: ['support'] },
  { label: 'Escalations', href: '/staff/support/escalations', roles: ['support'] },
  // Business owner-level (super_admin + owner)
  { label: 'Coupon Management', href: '/staff/coupons', roles: ['owner-tier'] },
  { label: 'Staff Users', href: '/staff/users', roles: ['owner-tier'] },
  { label: 'Roles & Permissions', href: '/staff/roles', roles: ['owner-tier'] },
  { label: 'Site Settings', href: '/staff/settings', roles: ['owner-tier'] },
  { label: 'Security (2FA)', href: '/staff/settings/totp', roles: ['owner-tier'] },
  { label: 'Media / R2', href: '/staff/media-admin', roles: ['owner-tier'] },
  { label: 'Audit Logs', href: '/staff/audit', roles: ['owner-tier', 'auditor'] },
  { label: 'Guardrails', href: '/staff/guardrails', roles: ['owner-tier', 'auditor'] },
  // Platform-control (super_admin ONLY)
  { label: 'API Code / Developer', href: '/staff/api-code', roles: ['super-admin-only', 'developer'] },
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
