import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve('./db/migrations');
const ROLLBACK = resolve('./db/migrations/rollback');

/**
 * N-16: 0039_staff_roles_consolidate_5.sql originally used
 * `ALTER TABLE ... DROP CHECK IF EXISTS` / `ALTER TABLE ... ADD CONSTRAINT
 * ... CHECK (...)` to swap the staff_users.role CHECK constraint — syntax
 * SQLite/D1 has never supported, confirmed by a real failed application
 * against production (`near "CHECK": syntax error`). Rewritten to the
 * table-rebuild pattern (CREATE _new, copy, DROP, RENAME) with PRAGMA
 * foreign_keys OFF/ON around it.
 *
 * This test applies the REAL migration files in dependency order against
 * a real SQLite engine (not a mock), exactly the sequence production went
 * through, and verifies the rebuild actually lands correctly.
 */
function buildDb(): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0005_password_salt.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0020_staff_totp.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0036_rbac_management.sql'), 'utf8'));
  return raw;
}

function seedStaff(raw: DatabaseSync, id: string, role: string) {
  raw.prepare(
    `INSERT INTO staff_users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
     VALUES (?, ?, 'h', 'Test User', ?, 1, datetime('now'), datetime('now'))`,
  ).run(id, `${id}@example.com`, role);
}

describe('N-16: migration 0039 role consolidation (8 roles -> 5) rebuilds staff_users correctly', () => {
  it('applies without a syntax error (the original ALTER TABLE ADD CONSTRAINT form does not)', () => {
    const raw = buildDb();
    seedStaff(raw, 's1', 'salesman');
    expect(() => {
      raw.exec(readFileSync(resolve(MIGRATIONS, '0039_staff_roles_consolidate_5.sql'), 'utf8'));
    }).not.toThrow();
  });

  it('remaps salesman/packing/support -> staff, developer/auditor -> viewer', () => {
    const raw = buildDb();
    seedStaff(raw, 's1', 'salesman');
    seedStaff(raw, 's2', 'packing');
    seedStaff(raw, 's3', 'support');
    seedStaff(raw, 's4', 'developer');
    seedStaff(raw, 's5', 'auditor');
    seedStaff(raw, 's6', 'super_admin');
    raw.exec(readFileSync(resolve(MIGRATIONS, '0039_staff_roles_consolidate_5.sql'), 'utf8'));

    const rows = raw.prepare(`SELECT id, role FROM staff_users ORDER BY id`).all() as { id: string; role: string }[];
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.role]));
    expect(byId.s1).toBe('staff');
    expect(byId.s2).toBe('staff');
    expect(byId.s3).toBe('staff');
    expect(byId.s4).toBe('viewer');
    expect(byId.s5).toBe('viewer');
    expect(byId.s6).toBe('super_admin');
  });

  it('the new CHECK constraint rejects an old-model role after the rebuild', () => {
    const raw = buildDb();
    raw.exec(readFileSync(resolve(MIGRATIONS, '0039_staff_roles_consolidate_5.sql'), 'utf8'));
    expect(() => {
      raw.prepare(
        `INSERT INTO staff_users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
         VALUES ('x1', 'x1@example.com', 'h', 'X', 'salesman', 1, datetime('now'), datetime('now'))`,
      ).run();
    }).toThrow();
  });

  it('the new CHECK constraint accepts every one of the 5 consolidated roles', () => {
    const raw = buildDb();
    raw.exec(readFileSync(resolve(MIGRATIONS, '0039_staff_roles_consolidate_5.sql'), 'utf8'));
    for (const role of ['super_admin', 'owner', 'manager', 'staff', 'viewer']) {
      expect(() => {
        raw.prepare(
          `INSERT INTO staff_users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
           VALUES (?, ?, 'h', 'X', ?, 1, datetime('now'), datetime('now'))`,
        ).run(`role-${role}`, `role-${role}@example.com`, role);
      }, `role ${role} should be accepted`).not.toThrow();
    }
  });

  it('preserves every non-role column across the rebuild (password hash, TOTP fields, timestamps)', () => {
    const raw = buildDb();
    seedStaff(raw, 's1', 'salesman');
    raw.prepare(`UPDATE staff_users SET password_salt='salt1', totp_secret='sec1', totp_required=1, last_login_at='2026-01-01 00:00:00' WHERE id='s1'`).run();
    raw.exec(readFileSync(resolve(MIGRATIONS, '0039_staff_roles_consolidate_5.sql'), 'utf8'));

    const row = raw.prepare(`SELECT * FROM staff_users WHERE id='s1'`).get() as any;
    expect(row.password_hash).toBe('h');
    expect(row.password_salt).toBe('salt1');
    expect(row.totp_secret).toBe('sec1');
    expect(row.totp_required).toBe(1);
    expect(row.last_login_at).toBe('2026-01-01 00:00:00');
    expect(row.role).toBe('staff');
  });

  it('roles table is consolidated to 5 system roles, role_permissions repointed, no orphaned rows', () => {
    const raw = buildDb();
    raw.exec(readFileSync(resolve(MIGRATIONS, '0039_staff_roles_consolidate_5.sql'), 'utf8'));

    const roleNames = (raw.prepare(`SELECT name FROM roles ORDER BY name`).all() as { name: string }[]).map((r) => r.name);
    expect(roleNames).toEqual(['manager', 'owner', 'staff', 'super_admin', 'viewer'].sort());

    const staffPerms = (raw.prepare(
      `SELECT permission FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.name = 'staff' ORDER BY permission`,
    ).all() as { permission: string }[]).map((r) => r.permission);
    expect(staffPerms).toEqual(['orders.create', 'orders.pack', 'orders.ship', 'orders.update', 'orders.view', 'support.note', 'support.view'].sort());

    const orphaned = raw.prepare(
      `SELECT COUNT(*) AS n FROM role_permissions rp LEFT JOIN roles r ON r.id = rp.role_id WHERE r.id IS NULL`,
    ).get() as { n: number };
    expect(orphaned.n).toBe(0);
  });

  it('foreign keys from staff_sessions to staff_users survive the table rebuild', () => {
    const raw = buildDb();
    seedStaff(raw, 's1', 'salesman');
    raw.exec(readFileSync(resolve(MIGRATIONS, '0039_staff_roles_consolidate_5.sql'), 'utf8'));

    expect(() => {
      raw.prepare(
        `INSERT INTO staff_sessions (id, staff_user_id, token_hash, created_at, expires_at, absolute_expires_at, last_active_at)
         VALUES ('sess1', 's1', 'th1', datetime('now'), datetime('now', '+1 day'), datetime('now', '+7 day'), datetime('now'))`,
      ).run();
    }).not.toThrow();

    const session = raw.prepare(`SELECT staff_user_id FROM staff_sessions WHERE id='sess1'`).get() as { staff_user_id: string };
    expect(session.staff_user_id).toBe('s1');
  });

  it('rollback restores the 8-role CHECK and reverse-maps staff/viewer back', () => {
    const raw = buildDb();
    seedStaff(raw, 's1', 'salesman');
    raw.exec(readFileSync(resolve(MIGRATIONS, '0039_staff_roles_consolidate_5.sql'), 'utf8'));
    expect(() => {
      raw.exec(readFileSync(resolve(ROLLBACK, '0039_rollback_staff_roles_consolidate_5.sql'), 'utf8'));
    }).not.toThrow();

    const row = raw.prepare(`SELECT role FROM staff_users WHERE id='s1'`).get() as { role: string };
    expect(row.role).toBe('salesman');

    // Old 8-role CHECK is back in effect.
    expect(() => {
      raw.prepare(
        `INSERT INTO staff_users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
         VALUES ('x2', 'x2@example.com', 'h', 'X', 'auditor', 1, datetime('now'), datetime('now'))`,
      ).run();
    }).not.toThrow();
  });

  it('no ALTER TABLE ADD CONSTRAINT / DROP CHECK syntax remains as executable SQL in either file', () => {
    const fwd = readFileSync(resolve(MIGRATIONS, '0039_staff_roles_consolidate_5.sql'), 'utf8');
    const back = readFileSync(resolve(ROLLBACK, '0039_rollback_staff_roles_consolidate_5.sql'), 'utf8');
    for (const sql of [fwd, back]) {
      const codeOnly = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
      expect(codeOnly).not.toMatch(/ADD CONSTRAINT/i);
      expect(codeOnly).not.toMatch(/DROP CHECK/i);
    }
  });
});
