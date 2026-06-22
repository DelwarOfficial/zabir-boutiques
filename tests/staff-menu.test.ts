import { describe, it, expect } from 'vitest';
import { menuForRole } from '../src/lib/staff-menu';
import type { StaffRole } from '../src/lib/rbac';

// Platform-control items visible only to super_admin
const SUPER_ADMIN_ONLY_HREFS = ['/staff/api-code', '/staff/backups', '/staff/roles'];

// Business owner items visible to both super_admin + owner
const OWNER_TIER_HREFS = [
  '/staff/users', '/staff/settings', '/staff/audit', '/staff/guardrails', '/staff/coupons', '/staff/media-admin'
];

describe('Role-aware staff menu — platform security hardening', () => {
  it('super_admin sees ALL items including platform-control', () => {
    const hrefs = menuForRole('super_admin').map(m => m.href);
    for (const h of SUPER_ADMIN_ONLY_HREFS) expect(hrefs).toContain(h);
    for (const h of OWNER_TIER_HREFS) expect(hrefs).toContain(h);
  });

  it('owner sees business items but NOT platform-control items', () => {
    const hrefs = menuForRole('owner').map(m => m.href);
    for (const h of OWNER_TIER_HREFS) expect(hrefs).toContain(h);
    // Owner must NOT see platform-control
    for (const h of SUPER_ADMIN_ONLY_HREFS) expect(hrefs).not.toContain(h);
  });

  it('manager NEVER sees owner-tier or platform items', () => {
    const hrefs = menuForRole('manager').map(m => m.href);
    for (const h of OWNER_TIER_HREFS) expect(hrefs).not.toContain(h);
    for (const h of SUPER_ADMIN_ONLY_HREFS) expect(hrefs).not.toContain(h);
  });

  it('every role sees the base Dashboard link', () => {
    for (const role of ['super_admin', 'owner', 'manager', 'salesman', 'packing', 'support', 'developer', 'auditor'] as StaffRole[]) {
      expect(menuForRole(role).map(m => m.href)).toContain('/staff');
    }
  });

  it('developer sees Dashboard + API Code only', () => {
    const hrefs = menuForRole('developer').map(m => m.href);
    expect(hrefs).toContain('/staff');
    expect(hrefs).toContain('/staff/api-code');
    expect(hrefs).not.toContain('/staff/backups');
    expect(hrefs).not.toContain('/staff/users');
  });

  it('auditor sees Dashboard, Reports, and Audit Logs only', () => {
    const hrefs = menuForRole('auditor').map(m => m.href).sort();
    expect(hrefs).toEqual(['/staff', '/staff/audit', '/staff/guardrails', '/staff/reports']);
  });

  it('packing sees packing queue, not product management', () => {
    const hrefs = menuForRole('packing').map(m => m.href);
    expect(hrefs).toContain('/staff/packing');
    expect(hrefs).not.toContain('/staff/products');
  });
});
