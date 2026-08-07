/**
 * /api/staff/* route → permission map [Master Plan §8.1]
 *
 * Returns null when authenticated staff is sufficient (logout, step-up).
 * Returns a Permission when the role must pass can(role, permission).
 */
import type { Permission } from './rbac';

export function getRequiredStaffPermission(pathname: string, method: string): Permission | null {
  const p = pathname.toLowerCase();
  const isMut = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

  if (p.endsWith('/logout') || p.includes('/step-up') || p.includes('/totp/')) return null;

  if (p.includes('/refund')) return 'payments.refund';
  if (p.includes('/orders/create')) return 'orders.create';
  if (p.includes('/orders/') && p.includes('/confirm')) return 'orders.confirm';
  if (p.includes('/orders/') && p.includes('/label')) return 'orders.pack';
  if (p.includes('/orders/') && p.includes('/ship')) return 'orders.ship';
  if (p.includes('/orders/') && p.includes('/pack')) return 'orders.pack';
  if (p.includes('/orders/') && p.includes('/courier')) return 'orders.ship';
  if (p.includes('/returns/') && p.includes('/approve')) return 'orders.update';
  if (p.includes('/returns/') && p.includes('/reject')) return 'orders.update';
  if (p.includes('/returns')) return isMut ? 'orders.update' : 'orders.view';
  if (p.includes('/fraud/override')) return 'fraud.override';
  if (p.includes('/invoices/') && p.includes('/void')) return 'orders.cancel';
  if (p.includes('/invoices/') && p.includes('/print')) return 'orders.view';
  if (p.includes('/invoices')) return isMut ? 'orders.create' : 'orders.view';
  if (p.includes('/coupons')) return 'staff.manage';
  if (p.includes('/cache/')) return 'settings.platform.update';
  if (p.includes('/api-keys')) return isMut ? 'api_keys.create' : 'api_keys.read';
  if (p.includes('/api-code')) return isMut ? 'api_code.update' : 'api_code.read';
  if (p.includes('/uploads')) return 'media.upload';
  if (p.includes('/ai/')) return 'products.manage';
  if (p.includes('/roles')) return 'roles.manage';
  if (p.includes('/users')) return 'staff.manage';
  if (p.includes('/settings')) return 'settings.manage';
  if (p.includes('/backups')) return null; // handler enforces assertSuperAdminOnly
  if (p.includes('/audit')) return 'system.audit.view';

  if (p.includes('/products/categories')) return 'products.manage';
  if (p.includes('/products')) return isMut ? 'products.manage' : 'products.manage';

  if (p.includes('/inventory/adjust')) return 'inventory.adjust';
  if (p.includes('/inventory/movements')) return 'inventory.manage';
  if (p.includes('/inventory/variants')) return 'inventory.manage';

  if (p.includes('/orders')) return isMut ? 'orders.update' : 'orders.view';

  return isMut ? 'orders.update' : 'orders.view';
}
