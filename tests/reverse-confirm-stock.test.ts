import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reverseConfirm } from '../src/lib/inventory';

const MIGRATIONS = resolve('./db/migrations');

class Stmt {
  private bound: unknown[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...values: unknown[]) { this.bound = values; return this; }
  private rows(): any[] { const raw = (this.db.prepare(this.sql) as any).all(...this.bound); return Array.isArray(raw) ? raw : []; }
  async first<T>(): Promise<T | null> { return (this.rows()[0] ?? null) as T | null; }
  async all<T>(): Promise<{ results: T[] }> { return { results: this.rows() as T[] }; }
  async run(): Promise<{ meta: { changes: number } }> {
    const res = (this.db.prepare(this.sql) as any).run(...this.bound);
    return { meta: { changes: Number((res as any)?.changes ?? 0) } };
  }
}
class D1Like {
  constructor(private db: DatabaseSync) {}
  prepare(sql: string) { return new Stmt(this.db, sql); }
  async batch(stmts: Stmt[], opts?: { atomic?: boolean }) {
    if (opts?.atomic) {
      this.db.exec('BEGIN');
      try { const out = await Promise.all(stmts.map((s) => s.run())); this.db.exec('COMMIT'); return out; }
      catch (e) { this.db.exec('ROLLBACK'); throw e; }
    }
    return Promise.all(stmts.map((s) => s.run()));
  }
}

function buildDb(soldQty: number): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0017_variants_stock_generated.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0026_add_checkout_vat_paisa.sql'), 'utf8'));
  raw.exec(`
    INSERT INTO products (id, name, slug, price_paisa, status, created_at, updated_at)
    VALUES ('prod1','P','p','1000','published','2026-01-01','2026-01-01');
    INSERT INTO product_variants (id, product_id, sku, is_deleted, created_at, updated_at)
    VALUES ('v1','prod1','sku1',0,'2026-01-01','2026-01-01');
    INSERT INTO inventory_items (id, variant_id, quantity, reserved_quantity, sold_quantity, is_available, updated_at)
    VALUES ('ii1','v1',10,0,${soldQty},1,'2026-01-01');
    INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
    VALUES ('o1','ORD-1','+8801700000000','N','A',1000,0,0,1000,'cod','created','review','staff_confirmed',0,1000,'2026-01-01','2026-01-01');
    INSERT INTO order_items (id, order_id, variant_id, product_name, variant_label, quantity, unit_price_paisa, total_price_paisa, vat_paisa, created_at)
    VALUES ('oi1','o1','v1','P','sku1',2,500,1000,0,'2026-01-01');
  `);
  return raw;
}

describe('K-38: reverseConfirm — compensating transaction for cancel-after-confirm (§13.1)', () => {
  it('shifts sold_quantity back down, does not touch stock (quantity invariant)', async () => {
    const raw = buildDb(2);
    const env = { DB: new D1Like(raw) as unknown as D1Database };

    const result = await reverseConfirm(env, 'o1', '2026-01-02 00:00:00');
    expect(result.ok).toBe(true);

    const row = raw.prepare('SELECT quantity, sold_quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    expect(row.quantity).toBe(10); // stock invariant — never touched by reverseConfirm
    expect(row.sold_quantity).toBe(0);
  });

  it('is idempotent: a second call is rejected as already_reversed, no double-credit', async () => {
    const raw = buildDb(2);
    const env = { DB: new D1Like(raw) as unknown as D1Database };

    const first = await reverseConfirm(env, 'o1', '2026-01-02 00:00:00');
    expect(first.ok).toBe(true);

    const second = await reverseConfirm(env, 'o1', '2026-01-02 00:05:00');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('already_reversed');

    const row = raw.prepare('SELECT sold_quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    expect(row.sold_quantity).toBe(0); // not double-credited to -2
  });

  it('refuses to take sold_quantity negative if it is already lower than the order quantity (guard)', async () => {
    const raw = buildDb(1); // order wants to reverse qty=2, but only 1 is currently sold
    const env = { DB: new D1Like(raw) as unknown as D1Database };

    const result = await reverseConfirm(env, 'o1', '2026-01-02 00:00:00');
    // The guarded UPDATE (sold_quantity >= qty) rejects the row; batch still
    // commits (atomic transaction succeeds even with a 0-row UPDATE), so this
    // returns ok:true but the count genuinely did not go negative.
    expect(result.ok).toBe(true);
    const row = raw.prepare('SELECT sold_quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    expect(row.sold_quantity).toBeGreaterThanOrEqual(0);
  });
});
