import { describe, it, expect } from 'vitest';
import { can, isSuperAdmin, isOwnerTier, permissionsFor, canConfirmOrder, type StaffRole, type Permission } from '../src/lib/rbac';

describe('RBAC permission matrix — platform security hardening', () => {
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
    // Business permissions owner HAS:
    expect(can('owner', 'staff.manage')).toBe(true);
    expect(can('owner', 'roles.manage')).toBe(true);
    expect(can('owner', 'fraud.override')).toBe(true);
    expect(can('owner', 'orders.confirm')).toBe(true);
    expect(can('owner', 'payments.refund')).toBe(true);
    expect(can('owner', 'integrations.read')).toBe(true);
    expect(can('owner', 'api_code.read')).toBe(true);
    expect(can('owner', 'backups.read')).toBe(true);

    // Platform-control permissions owner does NOT have:
    expect(can('owner', 'platform.full_access')).toBe(false);
    expect(can('owner', 'api_keys.create')).toBe(false);
    expect(can('owner', 'api_keys.revoke')).toBe(false);
    expect(can('owner', 'api_keys.delete')).toBe(false);
    expect(can('owner', 'integrations.test')).toBe(false);
    expect(can('owner', 'api_code.update')).toBe(false);
    expect(can('owner', 'backups.restore')).toBe(false);
    expect(can('owner', 'webhooks.update')).toBe(false);
    expect(can('owner', 'settings.platform.update')).toBe(false);
  });

  it('isSuperAdmin is true only for super_admin, not owner', () => {
    expect(isSuperAdmin('super_admin')).toBe(true);
    expect(isSuperAdmin('owner')).toBe(false);
    expect(isSuperAdmin('manager')).toBe(false);
  });

  it('isOwnerTier covers both super_admin and owner', () => {
    expect(isOwnerTier('super_admin')).toBe(true);
    expect(isOwnerTier('owner')).toBe(true);
    expect(isOwnerTier('manager')).toBe(false);
  });

  it('manager CANNOT access platform or owner-only system tools', () => {
    expect(can('manager', 'api_keys.create')).toBe(false);
    expect(can('manager', 'staff.manage')).toBe(false);
    expect(can('manager', 'roles.manage')).toBe(false);
    expect(can('manager', 'backups.restore')).toBe(false);
    expect(can('manager', 'payments.refund')).toBe(false);
    expect(can('manager', 'fraud.override')).toBe(false);
    expect(can('manager', 'settings.platform.update')).toBe(false);
  });

  it('manager CAN do daily operations', () => {
    expect(can('manager', 'products.manage')).toBe(true);
    expect(can('manager', 'orders.confirm')).toBe(true);
    expect(can('manager', 'fraud.view')).toBe(true);
    expect(can('manager', 'inventory.adjust')).toBe(true);
    expect(can('manager', 'reports.view')).toBe(true);
  });

  it('salesman is restricted to sales actions only', () => {
    expect(can('salesman', 'orders.create')).toBe(true);
    expect(can('salesman', 'orders.view')).toBe(true);
    // blocked
    expect(can('salesman', 'payments.refund')).toBe(false);
    expect(can('salesman', 'fraud.override')).toBe(false);
    expect(can('salesman', 'api_keys.create')).toBe(false);
    expect(can('salesman', 'integrations.test')).toBe(false);
  });

  it('packing is restricted to packing/shipping only', () => {
    expect(can('packing', 'orders.pack')).toBe(true);
    expect(can('packing', 'orders.ship')).toBe(true);
    expect(can('packing', 'products.manage')).toBe(false);
    expect(can('packing', 'api_keys.create')).toBe(false);
  });

  it('support is restricted to support + limited order view', () => {
    expect(can('support', 'support.view')).toBe(true);
    expect(can('support', 'support.note')).toBe(true);
    expect(can('support', 'orders.view')).toBe(true);
    expect(can('support', 'api_keys.create')).toBe(false);
    expect(can('support', 'integrations.test')).toBe(false);
  });

  it('permissionsFor super_admin returns platform.full_access sentinel', () => {
    expect(permissionsFor('super_admin')).toEqual(['platform.full_access']);
  });

  it('permissionsFor owner returns business perms (not platform.full_access)', () => {
    const ownerPerms = permissionsFor('owner');
    expect(ownerPerms).not.toContain('platform.full_access');
    expect(ownerPerms).toContain('staff.manage');
    expect(ownerPerms).toContain('fraud.override');
    expect(ownerPerms).not.toContain('api_keys.create');
  });
});

describe('canConfirmOrder — fraud-blocked confirmation guard (Rule #9)', () => {
  it('blocks non-override roles from confirming a fraud-blocked order', () => {
    for (const role of ['manager', 'salesman', 'packing', 'support', 'developer', 'auditor'] as StaffRole[]) {
      expect(canConfirmOrder(role, 'blocked')).toBe(false);
    }
  });

  it('allows owner-tier (fraud.override holders) to confirm a fraud-blocked order', () => {
    expect(canConfirmOrder('owner', 'blocked')).toBe(true);
    expect(canConfirmOrder('super_admin', 'blocked')).toBe(true);
  });

  it('allows confirmation of non-blocked orders for any confirm-capable role', () => {
    for (const decision of ['approved', 'review', '', null, undefined]) {
      expect(canConfirmOrder('manager', decision)).toBe(true);
      expect(canConfirmOrder('owner', decision)).toBe(true);
    }
  });
});

describe('developer role — scoped to read-only API Code', () => {
  it('has api_code.read and nothing else', () => {
    expect(can('developer', 'api_code.read')).toBe(true);
    expect(permissionsFor('developer')).toEqual(['api_code.read']);
  });

  it('cannot touch platform, integrations, keys, coupons, fraud, payments, or staff', () => {
    const blocked: Permission[] = [
      'platform.full_access', 'api_keys.create', 'api_keys.revoke',
      'integrations.test', 'fraud.override', 'payments.verify',
      'staff.manage', 'roles.manage', 'orders.create', 'api_code.update'
    ];
    for (const p of blocked) expect(can('developer', p)).toBe(false);
  });
});

describe('auditor role — strictly read-only audit + reports', () => {
  it('has exactly audit view and reports view', () => {
    expect(can('auditor', 'system.audit.view')).toBe(true);
    expect(can('auditor', 'reports.view')).toBe(true);
  });

  it('cannot perform any mutation or platform access', () => {
    const blocked: Permission[] = [
      'platform.full_access', 'api_keys.create', 'integrations.test',
      'orders.create', 'fraud.override', 'staff.manage', 'backups.restore'
    ];
    for (const p of blocked) expect(can('auditor', p)).toBe(false);
  });
});
