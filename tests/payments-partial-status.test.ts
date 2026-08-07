import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve('./db/migrations');

// Applies the base schema plus the order-state-machine migration that is the
// canonical source of the `partially_paid` payment status on a migrated DB.
// Uses a REAL SQLite engine so CHECK constraints are actually enforced
// (the D1Mock stub does not enforce them).
function buildDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
  db.exec(readFileSync(resolve(MIGRATIONS, '0002_indexes.sql'), 'utf8'));
  db.exec(readFileSync(resolve(MIGRATIONS, '0013_order_state_machine_constraints.sql'), 'utf8'));
  return db;
}

function seedOrder(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO orders (
      id, order_number, phone, name, address,
      subtotal_paisa, delivery_paisa, discount_paisa, total_paisa,
      payment_method, payment_status, fraud_decision, status,
      advance_paisa, balance_paisa, created_at, updated_at
    ) VALUES (
      'o1', 'ORD-0001', '01700000000', 'Test Buyer', '123 St',
      1000, 0, 0, 1000,
      'partial_prepay', 'pending', 'review', 'pending_review',
      500, 500, '2026-01-01 00:00:00', '2026-01-01 00:00:00'
    )
  `);
}

function insertPayment(db: DatabaseSync, status: string): void {
  db.exec(`
    INSERT INTO payments (id, order_id, amount_paisa, status, created_at, updated_at)
    VALUES ('p_${status}', 'o1', 500, '${status}', '2026-01-01 00:00:00', '2026-01-01 00:00:00')
  `);
}

describe('DB-1: payments.status accepts partially_paid (real CHECK enforcement)', () => {
  it('accepts partially_paid after running base + 0013 migration chain', () => {
    const db = buildDb();
    seedOrder(db);
    expect(() => insertPayment(db, 'partially_paid')).not.toThrow();
  });

  it('accepts partially_refunded (added alongside partially_paid)', () => {
    const db = buildDb();
    seedOrder(db);
    expect(() => insertPayment(db, 'partially_refunded')).not.toThrow();
  });

  it('still rejects an unknown payment status', () => {
    const db = buildDb();
    seedOrder(db);
    expect(() => insertPayment(db, 'bogus_status')).toThrow(/CHECK constraint failed/);
  });

  it('base-only 0001 build also accepts partially_paid (canonical base is self-consistent)', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
    seedOrder(db);
    expect(() => insertPayment(db, 'partially_paid')).not.toThrow();
  });
});
