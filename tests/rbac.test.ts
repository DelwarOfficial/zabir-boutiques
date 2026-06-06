import { describe, it, expect } from 'vitest';
import { can, isOwnerTier, permissionsFor, type StaffRole, type Permission } from '../src/lib/rbac';

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
