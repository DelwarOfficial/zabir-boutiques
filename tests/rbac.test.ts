import { describe, it, expect } from 'vitest';
import { can, isSuperAdmin, isOwnerTier, permissionsFor, canConfirmOrder, type StaffRole, type Permission } from '../src/lib/rbac';

describe('RBAC 5-role permission matrix — Master Plan §17.2', () => {
  it('super_admin has full access to every permission (platform + business)', () => {
    const perms: Permission[] = [
      'platform.full_access', 'api_keys.create', 'api_keys.revoke', 'api_keys.delete',
      'integrations.read', 'integrations.test', 'integrations.logs.read',
      'api_code.read', 'api_code.update', 'backups.restore',
      'webhooks.read', 'webhooks.update', 'settings.platform.update',
      'staff.manage', 'roles.manage', 'fraud.override', 'payments.refund'
    ];
    expect(isSuperAdmin('super_admin')).toBe(true);
    for (const p of perms) expect(can('super_admin', p)).toBe(true);
  });

  it('owner has business access but NOT platform-control access', () => {
    expect(can('owner', 'staff.manage')).toBe(true);
    expect(can('owner', 'fraud.override')).toBe(true);
    expect(can('owner', 'orders.confirm')).toBe(true);
    expect(can('owner', 'payments.refund')).toBe(true);
    expect(can('owner', 'integrations.read')).toBe(true);
    expect(can('owner', 'api_code.read')).toBe(true);
    // Platform-control denied
    expect(can('owner', 'platform.full_access')).toBe(false);
    expect(can('owner', 'roles.manage')).toBe(false);
    expect(can('owner', 'api_keys.create')).toBe(false);
    expect(can('owner', 'api_keys.revoke')).toBe(false);
    expect(can('owner', 'integrations.test')).toBe(false);
    expect(can('owner', 'api_code.update')).toBe(false);
    expect(can('owner', 'backups.read')).toBe(false);
    expect(can('owner', 'backups.restore')).toBe(false);
  });

  it('isSuperAdmin / isOwnerTier checks', () => {
    expect(isSuperAdmin('super_admin')).toBe(true);
    expect(isSuperAdmin('owner')).toBe(false);
    expect(isSuperAdmin('manager')).toBe(false);
    expect(isOwnerTier('super_admin')).toBe(true);
    expect(isOwnerTier('owner')).toBe(true);
    expect(isOwnerTier('manager')).toBe(false);
  });

  it('manager has daily ops but not owner/super_admin powers', () => {
    expect(can('manager', 'products.manage')).toBe(true);
    expect(can('manager', 'orders.confirm')).toBe(true);
    expect(can('manager', 'fraud.view')).toBe(true);
    expect(can('manager', 'inventory.adjust')).toBe(true);
    expect(can('manager', 'reports.view')).toBe(true);
    // Denied
    expect(can('manager', 'api_keys.create')).toBe(false);
    expect(can('manager', 'staff.manage')).toBe(false);
    expect(can('manager', 'payments.refund')).toBe(false);
    expect(can('manager', 'fraud.override')).toBe(false);
  });

  it('staff has combined sales + packing + support permissions', () => {
    // Sales perms
    expect(can('staff', 'orders.create')).toBe(true);
    expect(can('staff', 'orders.view')).toBe(true);
    expect(can('staff', 'orders.update')).toBe(true);
    // Packing perms
    expect(can('staff', 'orders.pack')).toBe(true);
    expect(can('staff', 'orders.ship')).toBe(true);
    // Support perms
    expect(can('staff', 'support.view')).toBe(true);
    expect(can('staff', 'support.note')).toBe(true);
    // Denied
    expect(can('staff', 'payments.refund')).toBe(false);
    expect(can('staff', 'fraud.override')).toBe(false);
    expect(can('staff', 'products.manage')).toBe(false);
  });

  it('viewer has read-only: api_code.read + audit + reports', () => {
    expect(can('viewer', 'api_code.read')).toBe(true);
    expect(can('viewer', 'system.audit.view')).toBe(true);
    expect(can('viewer', 'reports.view')).toBe(true);
    // No mutations
    expect(can('viewer', 'orders.create')).toBe(false);
    expect(can('viewer', 'orders.pack')).toBe(false);
    expect(can('viewer', 'fraud.override')).toBe(false);
    expect(can('viewer', 'staff.manage')).toBe(false);
  });

  it('permissionsFor super_admin returns business + platform perms', () => {
    const perms = permissionsFor('super_admin');
    expect(perms).toContain('staff.manage');
    expect(perms).toContain('platform.full_access');
    expect(perms).toContain('backups.restore');
    expect(new Set(perms).size).toBe(perms.length);
  });

  it('permissionsFor owner returns business perms only', () => {
    const ownerPerms = permissionsFor('owner');
    expect(ownerPerms).not.toContain('platform.full_access');
    expect(ownerPerms).toContain('staff.manage');
    expect(ownerPerms).toContain('fraud.override');
    expect(ownerPerms).not.toContain('api_keys.create');
  });
});

describe('canConfirmOrder — fraud-blocked confirmation guard', () => {
  it('blocks non-override roles', () => {
    for (const role of ['manager', 'staff', 'viewer'] as StaffRole[]) {
      expect(canConfirmOrder(role, 'blocked')).toBe(false);
    }
  });

  it('allows owner-tier to confirm fraud-blocked order', () => {
    expect(canConfirmOrder('owner', 'blocked')).toBe(true);
    expect(canConfirmOrder('super_admin', 'blocked')).toBe(true);
  });

  it('allows non-blocked orders for confirm-capable roles', () => {
    for (const decision of ['approved', 'review', '', null, undefined]) {
      expect(canConfirmOrder('manager', decision)).toBe(true);
      expect(canConfirmOrder('owner', decision)).toBe(true);
    }
  });
});
