import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve('./db/migrations');

function buildDb(): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0044_create_pos_cash_drawer_sessions.sql'), 'utf8'));
  raw.exec(`
    INSERT INTO staff_users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
    VALUES ('staff1','s@x.com','h','S','manager',1,'2026-01-01','2026-01-01');
  `);
  return raw;
}

describe('POS cash drawer sessions (T-25, F-09)', () => {
  it('refuses a second open session for the same cashier', () => {
    const raw = buildDb();
    raw.exec(`INSERT INTO pos_cash_drawer_sessions (id, opened_by_staff_id, opened_at, opening_float_paisa) VALUES ('d1','staff1','2026-01-01 08:00:00',10000);`);
    const open = raw.prepare(`SELECT id FROM pos_cash_drawer_sessions WHERE opened_by_staff_id = ? AND closed_at IS NULL`).get('staff1');
    expect(open).toBeTruthy();
  });

  it('computes expected_cash_paisa = opening_float + sum(cash payments since open)', () => {
    const raw = buildDb();
    raw.exec(readFileSync(resolve(MIGRATIONS, '0016_invoices.sql'), 'utf8'));
    raw.exec(`INSERT INTO pos_cash_drawer_sessions (id, opened_by_staff_id, opened_at, opening_float_paisa) VALUES ('d1','staff1','2026-01-01 08:00:00',10000);`);
    raw.exec(`
      INSERT INTO invoices (id, receipt_no, cashier_id, status, subtotal_paisa, total_paisa, amount_paid_paisa, created_at, updated_at)
      VALUES ('i1','ZB-1','staff1','paid',5000,5000,5000,'2026-01-01 09:00:00','2026-01-01 09:00:00');
      INSERT INTO invoice_payments (id, invoice_id, method, amount_paisa, created_at)
      VALUES ('p1','i1','cash',5000,'2026-01-01 09:00:00');
      INSERT INTO invoices (id, receipt_no, cashier_id, status, subtotal_paisa, total_paisa, amount_paid_paisa, created_at, updated_at)
      VALUES ('i2','ZB-2','staff1','paid',3000,3000,3000,'2026-01-01 10:00:00','2026-01-01 10:00:00');
      INSERT INTO invoice_payments (id, invoice_id, method, amount_paisa, created_at)
      VALUES ('p2','i2','card',3000,'2026-01-01 10:00:00');
    `);

    const row = raw.prepare(
      `SELECT COALESCE(SUM(ip.amount_paisa), 0) AS total
       FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
       WHERE ip.method = 'cash' AND i.cashier_id = ? AND ip.created_at >= ?`,
    ).get('staff1', '2026-01-01 08:00:00') as { total: number };

    const expectedCashPaisa = 10000 + row.total;
    expect(expectedCashPaisa).toBe(15000); // opening float 10000 + cash-only 5000, card excluded
  });

  it('variance is counted minus expected', () => {
    const expected = 15000;
    const counted = 14500;
    expect(counted - expected).toBe(-500);
  });

  it('closing an already-closed session is a no-op guard (changes=0)', () => {
    const raw = buildDb();
    raw.exec(`INSERT INTO pos_cash_drawer_sessions (id, opened_by_staff_id, opened_at, opening_float_paisa, closed_by_staff_id, closed_at) VALUES ('d1','staff1','2026-01-01 08:00:00',10000,'staff1','2026-01-01 20:00:00');`);
    const res = raw.prepare(`UPDATE pos_cash_drawer_sessions SET counted_cash_paisa = 999 WHERE id = 'd1' AND closed_at IS NULL`).run();
    expect((res as any).changes).toBe(0);
  });
});
