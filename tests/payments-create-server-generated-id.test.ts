import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve('./db/migrations');

describe('K-03: payments.id is always server-generated, never client-chosen', () => {
  const src = readFileSync(resolve('./src/pages/api/payments/create.ts'), 'utf8');

  it('paymentId is always a fresh UUID, no longer the Idempotency-Key header verbatim', () => {
    expect(src).not.toContain('const paymentId = idempotencyKey || crypto.randomUUID()');
    expect(src).toContain('const paymentId = crypto.randomUUID()');
  });

  it('idempotency lookup is scoped to (order_id, idempotency_key), not payments.id', () => {
    expect(src).toContain('WHERE order_id = ?1 AND idempotency_key = ?2');
  });

  it('idempotency_key is stored in its own column on insert', () => {
    expect(src).toContain('idempotency_key, created_at, updated_at)');
  });
});

describe('K-03: schema has idempotency_key column with a UNIQUE(order_id, idempotency_key) partial index', () => {
  it('migrations apply cleanly and enforce the unique index', () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
    raw.exec(readFileSync(resolve(MIGRATIONS, '0048_add_payments_idempotency_key.sql'), 'utf8'));
    raw.exec(readFileSync(resolve(MIGRATIONS, '0049_add_payments_idempotency_key_unique_index.sql'), 'utf8'));

    raw.exec(`
      INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
      VALUES ('o1','ORD-1','+8801700000000','N','A',1000,0,0,1000,'uddoktapay','created','review','pending_review',0,1000,'2026-01-01','2026-01-01');
      INSERT INTO payments (id, order_id, invoice_id, provider, amount_paisa, status, idempotency_key, created_at, updated_at)
      VALUES ('p1','o1','inv1','uddoktapay',1000,'pending','client-chosen-key','2026-01-01','2026-01-01');
    `);

    expect(() => {
      raw.prepare(
        `INSERT INTO payments (id, order_id, invoice_id, provider, amount_paisa, status, idempotency_key, created_at, updated_at)
         VALUES ('p2','o1','inv2','uddoktapay',1000,'pending','client-chosen-key','2026-01-01','2026-01-01')`
      ).run();
    }).toThrow(/UNIQUE constraint failed/);

    // Different order, same key: allowed (scoped uniqueness).
    raw.exec(`
      INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
      VALUES ('o2','ORD-2','+8801700000001','N','A',1000,0,0,1000,'uddoktapay','created','review','pending_review',0,1000,'2026-01-01','2026-01-01');
    `);
    expect(() => {
      raw.prepare(
        `INSERT INTO payments (id, order_id, invoice_id, provider, amount_paisa, status, idempotency_key, created_at, updated_at)
         VALUES ('p3','o2','inv3','uddoktapay',1000,'pending','client-chosen-key','2026-01-01','2026-01-01')`
      ).run();
    }).not.toThrow();
  });
});
