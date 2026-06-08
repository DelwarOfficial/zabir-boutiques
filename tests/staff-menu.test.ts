import { describe, it, expect } from 'vitest';
import { menuForRole } from '../src/lib/staff-menu';
import type { StaffRole } from '../src/lib/rbac';

const OWNER_ONLY_HREFS = [
  '/staff/users', '/staff/roles', '/staff/api-code',
  '/staff/settings', '/staff/media-admin', '/staff/backups', '/staff/audit'
];

describe('Role-aware staff menu', () => {
  it('owner-tier sees owner-only items', () => {
    for (const role of ['owner', 'super_admin'] as StaffRole[]) {
      const hrefs = menuForRole(role).map(m => m.href);
      for (const owned of OWNER_ONLY_HREFS) expect(hrefs).toContain(owned);
    }
  });

  it('manager NEVER sees owner-only items (API Code / Roles / Backups / Audit / Settings)', () => {
    const hrefs = menuForRole('manager').map(m => m.href);
    for (const owned of OWNER_ONLY_HREFS) expect(hrefs).not.toContain(owned);
  });

  it('salesman/packing/support never see owner-only items', () => {
    for (const role of ['salesman', 'packing', 'support'] as StaffRole[]) {
      const hrefs = menuForRole(role).map(m => m.href);
      for (const owned of OWNER_ONLY_HREFS) expect(hrefs).not.toContain(owned);
    }
  });

  it('every role sees the base Dashboard link', () => {
    for (const role of ['owner', 'manager', 'salesman', 'packing', 'support'] as StaffRole[]) {
      expect(menuForRole(role).map(m => m.href)).toContain('/staff');
    }
  });

  it('packing sees packing queue, not product management', () => {
    const hrefs = menuForRole('packing').map(m => m.href);
    expect(hrefs).toContain('/staff/packing');
    expect(hrefs).not.toContain('/staff/products');
  });

  it('auditor sees only Dashboard, Reports and Audit Logs', () => {
    const hrefs = menuForRole('auditor').map(m => m.href).sort();
    expect(hrefs).toEqual(['/staff', '/staff/audit', '/staff/reports']);
  });

  it('developer sees only the Dashboard (no API-keys / owner-only links)', () => {
    const hrefs = menuForRole('developer').map(m => m.href);
    expect(hrefs).toEqual(['/staff']);
    for (const owned of OWNER_ONLY_HREFS) expect(hrefs).not.toContain(owned);
  });
});
