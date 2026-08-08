import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve('./db/migrations');

function buildDb(): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0031_order_courier_handoff.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0042_orders_add_cod_collected_paisa.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0043_create_courier_cod_remittance.sql'), 'utf8'));
  raw.exec(`
    INSERT INTO staff_users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
    VALUES ('staff1','s@x.com','h','S','manager',1,'2026-01-01','2026-01-01');
  `);
  return raw;
}

function seedDeliveredCodOrder(raw: DatabaseSync, id: string, courier: string, collected: number, handoffAt: string): void {
  raw.exec(`
    INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, courier_provider, courier_handoff_at, cod_collected_paisa, created_at, updated_at)
    VALUES ('${id}','${id}','+8801700000000','N','A',1000,0,0,1000,'cod','created','review','delivered',0,1000,'${courier}','${handoffAt}',${collected},'2026-01-01 00:00:00','2026-01-01 00:00:00');
  `);
}

// Mirrors the expected_paisa aggregation in src/pages/api/staff/courier/remittance.ts
function expectedPaisa(raw: DatabaseSync, courier: string, periodStart: string, periodEnd: string): number {
  const row = raw.prepare(
    `SELECT COALESCE(SUM(cod_collected_paisa), 0) AS total
     FROM orders
     WHERE courier_provider = ? AND status = 'delivered' AND cod_collected_paisa IS NOT NULL
       AND courier_handoff_at >= ? AND courier_handoff_at < ?`,
  ).get(courier, periodStart, periodEnd) as { total: number };
  return row.total;
}

describe('courier COD remittance (T-24, F-03)', () => {
  it('sums cod_collected_paisa for delivered orders of one courier in the window', () => {
    const raw = buildDb();
    seedDeliveredCodOrder(raw, 'o1', 'pathao', 50000, '2026-02-01 10:00:00');
    seedDeliveredCodOrder(raw, 'o2', 'pathao', 30000, '2026-02-02 10:00:00');
    // Different courier, must not count.
    seedDeliveredCodOrder(raw, 'o3', 'steadfast', 99999, '2026-02-01 10:00:00');
    // Outside window, must not count.
    seedDeliveredCodOrder(raw, 'o4', 'pathao', 40000, '2026-03-01 10:00:00');

    expect(expectedPaisa(raw, 'pathao', '2026-02-01 00:00:00', '2026-03-01 00:00:00')).toBe(80000);
  });

  it('does not count orders not yet delivered (courier still holding cash)', () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, courier_provider, courier_handoff_at, cod_collected_paisa, created_at, updated_at)
      VALUES ('o1','o1','+8801700000000','N','A',1000,0,0,1000,'cod','created','review','shipped',0,1000,'pathao','2026-02-01 10:00:00',NULL,'2026-01-01','2026-01-01');
    `);
    expect(expectedPaisa(raw, 'pathao', '2026-02-01 00:00:00', '2026-03-01 00:00:00')).toBe(0);
  });

  it('records a remittance row and detects a shortfall', () => {
    const raw = buildDb();
    seedDeliveredCodOrder(raw, 'o1', 'pathao', 50000, '2026-02-01 10:00:00');
    const expected = expectedPaisa(raw, 'pathao', '2026-02-01 00:00:00', '2026-03-01 00:00:00');
    const received = 40000; // courier under-paid

    raw.prepare(
      `INSERT INTO courier_cod_remittance
         (id, courier, period_start, period_end, expected_paisa, received_paisa, reconciled_by_staff_id, reconciled_at, created_at)
       VALUES (?, 'pathao', '2026-02-01 00:00:00', '2026-03-01 00:00:00', ?, ?, 'staff1', '2026-03-01 00:00:00', '2026-03-01 00:00:00')`,
    ).run('r1', expected, received);

    const row = raw.prepare('SELECT expected_paisa, received_paisa FROM courier_cod_remittance WHERE id = ?').get('r1') as { expected_paisa: number; received_paisa: number };
    expect(row.expected_paisa).toBe(50000);
    expect(row.received_paisa).toBe(40000);
    const shortfall = row.expected_paisa - row.received_paisa;
    expect(shortfall).toBe(10000);
  });

  it('no shortfall when received matches expected exactly', () => {
    const raw = buildDb();
    seedDeliveredCodOrder(raw, 'o1', 'redx', 25000, '2026-02-01 10:00:00');
    const expected = expectedPaisa(raw, 'redx', '2026-02-01 00:00:00', '2026-03-01 00:00:00');
    expect(expected - 25000).toBe(0);
  });
});
