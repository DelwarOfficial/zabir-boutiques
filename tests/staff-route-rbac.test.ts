import { describe, it, expect } from 'vitest';
import { getRequiredStaffPermission } from '../src/lib/staff-route-rbac';
import { can } from '../src/lib/rbac';

describe('staff route RBAC map', () => {
  it('logout and step-up require auth only', () => {
    expect(getRequiredStaffPermission('/api/staff/logout', 'POST')).toBeNull();
    expect(getRequiredStaffPermission('/api/staff/step-up', 'POST')).toBeNull();
  });

  it('coupons require staff.manage for all methods', () => {
    expect(getRequiredStaffPermission('/api/staff/coupons', 'GET')).toBe('staff.manage');
    expect(getRequiredStaffPermission('/api/staff/coupons/abc', 'DELETE')).toBe('staff.manage');
  });

  it('order confirm requires orders.confirm', () => {
    expect(getRequiredStaffPermission('/api/staff/orders/ord-1/confirm', 'POST')).toBe('orders.confirm');
  });

  it('fraud override requires fraud.override', () => {
    expect(getRequiredStaffPermission('/api/staff/fraud/override', 'POST')).toBe('fraud.override');
  });

  it('uploads require media.upload', () => {
    expect(getRequiredStaffPermission('/api/staff/uploads', 'POST')).toBe('media.upload');
  });

  it('default order mutations require orders.update', () => {
    expect(getRequiredStaffPermission('/api/staff/orders/ord-1/label', 'POST')).toBe('orders.pack');
    expect(getRequiredStaffPermission('/api/staff/returns/r1/approve', 'POST')).toBe('orders.update');
  });

  it('manager blocked from owner-only coupon routes', () => {
    const perm = getRequiredStaffPermission('/api/staff/coupons', 'POST');
    expect(perm).toBe('staff.manage');
    expect(can('manager', perm!)).toBe(false);
    expect(can('owner', perm!)).toBe(true);
  });
});