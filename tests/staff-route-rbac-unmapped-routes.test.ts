import { describe, it, expect } from 'vitest';
import { getRequiredStaffPermission } from '../src/lib/staff-route-rbac';

describe('N-9: previously-unmapped sensitive routes no longer fall through to the generic orders.update/orders.view default', () => {
  it('purchase-orders/[id]/receive maps to inventory.adjust (matches the route handler)', () => {
    expect(getRequiredStaffPermission('/api/staff/purchase-orders/po1/receive', 'POST')).toBe('inventory.adjust');
  });

  it('purchase-orders (list/create) maps to inventory.manage', () => {
    expect(getRequiredStaffPermission('/api/staff/purchase-orders', 'GET')).toBe('inventory.manage');
    expect(getRequiredStaffPermission('/api/staff/purchase-orders', 'POST')).toBe('inventory.manage');
  });

  it('suppliers maps to inventory.manage', () => {
    expect(getRequiredStaffPermission('/api/staff/suppliers', 'GET')).toBe('inventory.manage');
  });

  it('pos/drawer/open and close map to orders.create', () => {
    expect(getRequiredStaffPermission('/api/staff/pos/drawer/open', 'POST')).toBe('orders.create');
    expect(getRequiredStaffPermission('/api/staff/pos/drawer/close', 'POST')).toBe('orders.create');
  });

  it('courier/remittance maps to payments.verify', () => {
    expect(getRequiredStaffPermission('/api/staff/courier/remittance', 'POST')).toBe('payments.verify');
  });
});
