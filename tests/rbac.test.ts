import { describe, it, expect } from 'vitest';
import { can, isOwnerTier, permissionsFor, canConfirmOrder, type StaffRole, type Permission } from '../src/lib/rbac';

describe('RBAC permission matrix', () => {
  it('owner and super_admin have full access to every permission', () => {
    const perms: Permission[] = [
      'system.api_code.manage', 'staff.manage', 'roles.manage', 'payments.refund',
      'fraud.override', 'system.backup.manage', 'settings.manage', 'inventory.adjust'
    ];
    for (const role of ['owner', 'super_admin'] as StaffRole[]) {
      expect(isOwnerTier(role)).toBe(true);
      for (const p of perms) expect(can(role, p)).toBe(true);
    }
  });

  it('manager CANNOT access owner-only system tools', () => {
    expect(can('manager', 'system.api_code.manage')).toBe(false);
    expect(can('manager', 'staff.manage')).toBe(false);
    expect(can('manager', 'roles.manage')).toBe(false);
    expect(can('manager', 'system.backup.manage')).toBe(false);
    expect(can('manager', 'payments.refund')).toBe(false);
    expect(can('manager', 'fraud.override')).toBe(false);
    expect(can('manager', 'settings.manage')).toBe(false);
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
    expect(can('salesman', 'orders.update')).toBe(true);
    expect(can('salesman', 'support.note')).toBe(true);
    // blocked
    expect(can('salesman', 'payments.refund')).toBe(false);
    expect(can('salesman', 'fraud.override')).toBe(false);
    expect(can('salesman', 'staff.manage')).toBe(false);
    expect(can('salesman', 'system.api_code.manage')).toBe(false);
    expect(can('salesman', 'settings.manage')).toBe(false);
    expect(can('salesman', 'inventory.adjust')).toBe(false);
    expect(can('salesman', 'payments.verify')).toBe(false);
  });

  it('packing is restricted to packing/shipping only', () => {
    expect(can('packing', 'orders.pack')).toBe(true);
    expect(can('packing', 'orders.ship')).toBe(true);
    expect(can('packing', 'orders.view')).toBe(true);
    // blocked
    expect(can('packing', 'products.manage')).toBe(false);
    expect(can('packing', 'payments.verify')).toBe(false);
    expect(can('packing', 'fraud.override')).toBe(false);
    expect(can('packing', 'staff.manage')).toBe(false);
    expect(can('packing', 'system.api_code.manage')).toBe(false);
    expect(can('packing', 'inventory.adjust')).toBe(false);
  });

  it('support is restricted to support + limited order view', () => {
    expect(can('support', 'support.view')).toBe(true);
    expect(can('support', 'support.note')).toBe(true);
    expect(can('support', 'orders.view')).toBe(true);
    // blocked
    expect(can('support', 'payments.verify')).toBe(false);
    expect(can('support', 'payments.refund')).toBe(false);
    expect(can('support', 'fraud.override')).toBe(false);
    expect(can('support', 'inventory.manage')).toBe(false);
    expect(can('support', 'products.manage')).toBe(false);
    expect(can('support', 'system.api_code.manage')).toBe(false);
    expect(can('support', 'orders.confirm')).toBe(false);
  });

  it('system.api_code.manage is owner-tier only across all non-owner roles', () => {
    for (const role of ['manager', 'salesman', 'packing', 'support'] as StaffRole[]) {
      expect(can(role, 'system.api_code.manage')).toBe(false);
    }
  });

  it('permissionsFor owner returns full-access sentinel', () => {
    expect(permissionsFor('owner')).toEqual(['owner.full_access']);
    expect(permissionsFor('super_admin')).toEqual(['owner.full_access']);
  });

  it('non-owner roles never receive owner.full_access', () => {
    for (const role of ['manager', 'salesman', 'packing', 'support'] as StaffRole[]) {
      expect(permissionsFor(role)).not.toContain('owner.full_access');
    }
  });
});

describe('canConfirmOrder — fraud-blocked confirmation guard (Rule #9)', () => {
  const nonOverrideRoles: StaffRole[] = ['manager', 'salesman', 'packing', 'support'];

  it('blocks non-override roles from confirming a fraud-blocked order', () => {
    for (const role of nonOverrideRoles) {
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

  it('manager (a confirm-capable role) is still blocked on a fraud-blocked order', () => {
    // manager has orders.confirm but NOT fraud.override
    expect(can('manager', 'orders.confirm')).toBe(true);
    expect(can('manager', 'fraud.override')).toBe(false);
    expect(canConfirmOrder('manager', 'blocked')).toBe(false);
  });
});

describe('developer role — scoped to read-only API Code / Developer area', () => {
  it('has system.api_code.manage and nothing else', () => {
    expect(can('developer', 'system.api_code.manage')).toBe(true);
    expect(permissionsFor('developer')).toEqual(['system.api_code.manage']);
  });

  it('cannot touch coupons, fraud, payments, staff/roles, or orders', () => {
    const blocked: Permission[] = [
      'fraud.override', 'fraud.view', 'payments.verify', 'payments.refund',
      'staff.manage', 'roles.manage', 'orders.create', 'orders.confirm',
      'orders.view', 'settings.manage', 'system.backup.manage', 'products.manage'
    ];
    for (const p of blocked) expect(can('developer', p)).toBe(false);
  });

  it('is not owner-tier and never receives owner.full_access', () => {
    expect(isOwnerTier('developer')).toBe(false);
    expect(permissionsFor('developer')).not.toContain('owner.full_access');
  });
});

describe('auditor role — strictly read-only audit + reports', () => {
  it('has exactly audit view and reports view', () => {
    expect(can('auditor', 'system.audit.view')).toBe(true);
    expect(can('auditor', 'reports.view')).toBe(true);
    expect(permissionsFor('auditor').sort()).toEqual(['reports.view', 'system.audit.view']);
  });

  it('cannot perform any mutation or sensitive read', () => {
    const blocked: Permission[] = [
      'orders.create', 'orders.confirm', 'orders.cancel', 'fraud.override',
      'fraud.view', 'payments.verify', 'payments.refund', 'staff.manage',
      'roles.manage', 'settings.manage', 'system.api_code.manage',
      'system.backup.manage', 'products.manage', 'inventory.adjust', 'media.upload'
    ];
    for (const p of blocked) expect(can('auditor', p)).toBe(false);
  });

  it('is not owner-tier and cannot confirm fraud-blocked orders', () => {
    expect(isOwnerTier('auditor')).toBe(false);
    expect(canConfirmOrder('auditor', 'blocked')).toBe(false);
  });
});
