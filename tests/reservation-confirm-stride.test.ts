import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { confirmReservedVariants } from '../src/lib/inventory';

const MIGRATIONS = resolve('./db/migrations');

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
  return raw;
}

const NOW = '2026-06-01 00:00:00';

function seed(raw: DatabaseSync): void {
  raw.exec(`
    INSERT INTO products (id, name, slug, price_paisa, status, created_at, updated_at)
    VALUES ('prod1','P','p','1000','published','2026-01-01 00:00:00','2026-01-01 00:00:00');
    INSERT INTO product_variants (id, product_id, sku, created_at, updated_at)
    VALUES ('v1','prod1','sku1','2026-01-01 00:00:00','2026-01-01 00:00:00'),
           ('v2','prod1','sku2','2026-01-01 00:00:00','2026-01-01 00:00:00');
    -- v1: enough stock; v2: reserved 5 but only 3 on hand -> inventory deduct must fail.
    INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
    VALUES ('o1','ORD-1','01700000000','B','A',1000,0,0,1000,'uddoktapay','pending','review','pending_review',1000,0,'2026-01-01 00:00:00','2026-01-01 00:00:00');
    INSERT INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
    VALUES ('ii1','v1', 10, 5, 1, '${NOW}'),
           ('ii2','v2', 3, 5, 1, '${NOW}');
    INSERT INTO stock_reservations (id, order_id, variant_id, quantity, status, expires_at, created_at, updated_at)
    VALUES ('r1','o1','v1',5,'active','2099-01-01 00:00:00','2026-01-01 00:00:00','2026-01-01 00:00:00');
  `);
}

function qty(raw: DatabaseSync, variantId: string) {
  return raw.prepare('SELECT quantity, reserved_quantity FROM inventory_items WHERE variant_id = ?').get(variantId) as {
    quantity: number;
    reserved_quantity: number;
  };
}

describe('INV-2: confirmReservedVariants reads the correct batch result per item', () => {
  it('detects a failed deduction even in a mixed reservationId batch', async () => {
    const raw = buildDb();
    seed(raw);
    const d1 = new D1Like(raw) as unknown as D1Database;

    // Mixed batch: first item HAS a reservationId, second does NOT. With the
    // old `index * (reservationId ? 2 : 1)` stride, the second item's result
    // index landed on the first item's reservation-confirm statement (which
    // succeeds), masking v2's failed inventory deduct.
    const items = [
      { variantId: 'v1', qty: 5, reservationId: 'r1' },
      { variantId: 'v2', qty: 5 }, // no reservationId -> inventory deduct fails (only 3 on hand)
    ];

    const res = await confirmReservedVariants({ DB: d1 }, items, NOW);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failedVariantId).toBe('v2');

    // v1 deducted, v2 untouched.
    expect(qty(raw, 'v1')).toEqual({ quantity: 5, reserved_quantity: 0 });
    expect(qty(raw, 'v2')).toEqual({ quantity: 3, reserved_quantity: 5 });
    expect(raw.prepare("SELECT status FROM stock_reservations WHERE id = 'r1'").get()).toMatchObject({ status: 'confirmed' });
  });

  it('positive control: uniform batch (all with reservationId) reports success', async () => {
    const raw = buildDb();
    seed(raw);
    const d1 = new D1Like(raw) as unknown as D1Database;

    const items = [
      { variantId: 'v1', qty: 5, reservationId: 'r1' },
      { variantId: 'v2', qty: 3, reservationId: 'r2' },
    ];
    raw.exec(
      "INSERT INTO stock_reservations (id, order_id, variant_id, quantity, status, expires_at, created_at, updated_at) VALUES ('r2','o1','v2',3,'active','2099-01-01 00:00:00','2026-01-01 00:00:00','2026-01-01 00:00:00')",
    );

    const res = await confirmReservedVariants({ DB: d1 }, items, NOW);
    expect(res.ok).toBe(true);
    expect(qty(raw, 'v1')).toEqual({ quantity: 5, reserved_quantity: 0 });
    expect(qty(raw, 'v2')).toEqual({ quantity: 0, reserved_quantity: 2 });
  });
});
