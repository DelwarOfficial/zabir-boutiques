import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyPaymentVerified } from '../src/lib/payments';

const MIGRATIONS = resolve('./db/migrations');

/**
 * Minimal real-SQLite D1 adapter so `applyPaymentVerified` runs against an
 * engine that actually enforces SQL semantics (deducts, guards, UNIQUE
 * claims). The repo's D1Mock stub does not execute SQL, so it cannot prove
 * "stock was (not) double-deducted".
 */
class Stmt {
  private bound: unknown[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...values: unknown[]) {
    this.bound = values;
    return this;
  }
  private rows(): any[] {
    const raw = (this.db.prepare(this.sql) as any).all(...this.bound);
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray((raw as any).rows)) return (raw as any).rows;
    return [];
  }
  async first<T>(): Promise<T | null> {
    return (this.rows()[0] ?? null) as T | null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.rows() as T[] };
  }
  async run(): Promise<{ meta: { changes: number } }> {
    const res = (this.db.prepare(this.sql) as any).run(...this.bound);
    return { meta: { changes: Number((res as any)?.changes ?? 0) } };
  }
}

class D1Like {
  constructor(private db: DatabaseSync) {}
  prepare(sql: string) {
    return new Stmt(this.db, sql);
  }
  async batch(stmts: Stmt[], opts?: { atomic?: boolean }) {
    if (opts?.atomic) {
      this.db.exec('BEGIN');
      try {
        const out = await Promise.all(stmts.map((s) => s.run()));
        this.db.exec('COMMIT');
        return out;
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
    return Promise.all(stmts.map((s) => s.run()));
  }
  exec(sql: string) {
    this.db.exec(sql);
  }
}

function buildDb(): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0002_indexes.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0013_order_state_machine_constraints.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0017_variants_stock_generated.sql'), 'utf8'));
  return raw;
}

const NOW = '2026-06-01 00:00:00';

function seed(raw: DatabaseSync): void {
  raw.exec(`
    INSERT INTO products (id, name, slug, price_paisa, status, created_at, updated_at)
    VALUES ('prod1','P','p','1000','published','2026-01-01 00:00:00','2026-01-01 00:00:00');
    INSERT INTO product_variants (id, product_id, sku, created_at, updated_at)
    VALUES ('v1','prod1','sku1','2026-01-01 00:00:00','2026-01-01 00:00:00');
    INSERT INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
    VALUES ('ii1','v1', 10, 2, 1, '2026-01-01 00:00:00');
    INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
    VALUES ('o1','ORD-1','01700000000','B','A',1000,0,0,1000,'uddoktapay','pending','review','pending_payment',1000,0,'2026-01-01 00:00:00','2026-01-01 00:00:00');
    INSERT INTO payments (id, order_id, invoice_id, amount_paisa, status, created_at, updated_at)
    VALUES ('pay1','o1','inv1',1000,'created','2026-01-01 00:00:00','2026-01-01 00:00:00');
    INSERT INTO stock_reservations (id, order_id, variant_id, quantity, status, expires_at, created_at, updated_at)
    VALUES ('res1','o1','v1',2,'active','2099-01-01 00:00:00','2026-01-01 00:00:00','2026-01-01 00:00:00');
  `);
}

function qty(raw: DatabaseSync) {
  return raw.prepare('SELECT quantity, reserved_quantity, COALESCE(sold_quantity, 0) AS sold_quantity FROM inventory_items WHERE variant_id = ?').get('v1') as {
    quantity: number;
    reserved_quantity: number;
    sold_quantity: number;
  };
}

function webhookPayload() {
  // K-07: metadata.order_id must be present and match payment.order_id
  // (checked in payments.ts) — the seeded payment row belongs to order o1.
  return { amountPaisa: 1000, metadata: { order_id: 'o1' }, rawResponse: '{}' } as const;
}

describe('INV-1: payment-verified stock deduct is not double-applied', () => {
  it('baseline: webhook deducts once; replay is a no-op (alreadyProcessed)', async () => {
    const raw = buildDb();
    seed(raw);
    const d1 = new D1Like(raw) as unknown as D1Database;

    const res = await applyPaymentVerified({ DB: d1 }, 'inv1', webhookPayload(), NOW);
    expect(res.ok).toBe(true);
    expect(res.status).toBe('paid');
    expect(res.alreadyProcessed).toBe(false);
    expect(qty(raw)).toEqual({ quantity: 10, reserved_quantity: 0, sold_quantity: 2 }); // stock invariant: reserved -> sold, quantity untouched

    // Replay (true webhook retry):
    const replay = await applyPaymentVerified({ DB: d1 }, 'inv1', webhookPayload(), NOW);
    expect(replay.ok).toBe(true);
    expect(replay.alreadyProcessed).toBe(true);
    expect(qty(raw)).toEqual({ quantity: 10, reserved_quantity: 0, sold_quantity: 2 }); // unchanged
  });

  it('INV-1 race: manual confirm BEFORE delayed webhook must not double-deduct', async () => {
    const raw = buildDb();
    seed(raw);
    const d1 = new D1Like(raw) as unknown as D1Database;

    // Staff manually confirms while the webhook is delayed: deduct, confirm
    // reservations, advance order to staff_confirmed (mirrors
    // api/staff/orders/[id]/confirm.ts branch 1).
    raw.exec(`
      UPDATE inventory_items
      SET reserved_quantity = reserved_quantity - 2, sold_quantity = COALESCE(sold_quantity, 0) + 2, updated_at = '${NOW}'
      WHERE variant_id = 'v1' AND reserved_quantity >= 2;
      UPDATE stock_reservations SET status = 'confirmed', updated_at = '${NOW}' WHERE id = 'res1' AND status = 'active';
      UPDATE orders SET status = 'staff_confirmed', updated_at = '${NOW}' WHERE id = 'o1' AND status = 'pending_payment';
    `);
    expect(qty(raw)).toEqual({ quantity: 10, reserved_quantity: 0, sold_quantity: 2 }); // manual confirm: reserved -> sold once

    // Delayed webhook now lands:
    const res = await applyPaymentVerified({ DB: d1 }, 'inv1', webhookPayload(), NOW);
    expect(res.ok).toBe(true);
    expect(res.status).toBe('paid');
    expect(res.alreadyProcessed).toBe(false);

    // CRITICAL: stock must NOT be deducted a second time.
    expect(qty(raw)).toEqual({ quantity: 10, reserved_quantity: 0, sold_quantity: 2 }); // still sold=2, not 4

    // Payment record marked paid (authoritative). Order stays staff_confirmed:
    // the webhook's guarded order transition refuses to touch an already
    // confirmed order, so it does not double-advance fulfillment status.
    const payRow = raw.prepare('SELECT status FROM payments WHERE invoice_id = ?').get('inv1') as any;
    expect(payRow.status).toBe('paid');
    const ord = raw.prepare('SELECT status FROM orders WHERE id = ?').get('o1') as any;
    expect(ord.status).toBe('staff_confirmed');

    // The webhook still registered its idempotency claim, so a real replay
    // is blocked and cannot deduct either.
    expect(raw.prepare('SELECT COUNT(*) AS c FROM payment_events WHERE invoice_id = ?').get('inv1')).toMatchObject({ c: 1 });
    const replay = await applyPaymentVerified({ DB: d1 }, 'inv1', webhookPayload(), NOW);
    expect(replay.alreadyProcessed).toBe(true);
    expect(qty(raw)).toEqual({ quantity: 10, reserved_quantity: 0, sold_quantity: 2 });
  });
});
