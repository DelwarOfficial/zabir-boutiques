import { describe, it, expect } from 'vitest';
import { menuForRole } from '../src/lib/staff-menu';
import type { StaffRole } from '../src/lib/rbac';

const SUPER_ADMIN_ONLY_HREFS = ['/staff/api-code', '/staff/backups', '/staff/roles'];
const OWNER_TIER_HREFS = [
  '/staff/users', '/staff/settings', '/staff/audit', '/staff/guardrails', '/staff/coupons', '/staff/media-admin'
];

describe('5-role staff menu — Master Plan §17.2', () => {
  it('super_admin sees ALL items including platform-control', () => {
    const hrefs = menuForRole('super_admin').map(m => m.href);
    for (const h of SUPER_ADMIN_ONLY_HREFS) expect(hrefs).toContain(h);
    for (const h of OWNER_TIER_HREFS) expect(hrefs).toContain(h);
  });

  it('owner sees business items but NOT platform-control items', () => {
    const hrefs = menuForRole('owner').map(m => m.href);
    for (const h of OWNER_TIER_HREFS) expect(hrefs).toContain(h);
    for (const h of SUPER_ADMIN_ONLY_HREFS) expect(hrefs).not.toContain(h);
  });

  it('manager NEVER sees owner-tier or platform items', () => {
    const hrefs = menuForRole('manager').map(m => m.href);
    for (const h of OWNER_TIER_HREFS) expect(hrefs).not.toContain(h);
    for (const h of SUPER_ADMIN_ONLY_HREFS) expect(hrefs).not.toContain(h);
  });

  it('every role sees the base Dashboard link', () => {
    for (const role of ['super_admin', 'owner', 'manager', 'staff', 'viewer'] as StaffRole[]) {
      expect(menuForRole(role).map(m => m.href)).toContain('/staff');
    }
  });

  it('staff sees sales, packing, support menu items', () => {
    const hrefs = menuForRole('staff').map(m => m.href);
    expect(hrefs).toContain('/staff/sales');
    expect(hrefs).toContain('/staff/packing');
    expect(hrefs).toContain('/staff/support');
    expect(hrefs).not.toContain('/staff/products');
  });

  it('viewer sees Dashboard + reports + audit + API code, not mutations', () => {
    const hrefs = menuForRole('viewer').map(m => m.href);
    expect(hrefs).toContain('/staff');
    expect(hrefs).toContain('/staff/reports');
    expect(hrefs).toContain('/staff/audit');
    expect(hrefs).toContain('/staff/api-code');
    expect(hrefs).not.toContain('/staff/products');
    expect(hrefs).not.toContain('/staff/sales');
  });
});
