import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { confirmReservationsForOrder } from '../src/lib/inventory';

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

function buildDb(): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0017_variants_stock_generated.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0024_stock_reservations_unique_constraint.sql'), 'utf8'));
  raw.exec(`
    INSERT INTO products (id, name, slug, price_paisa, status, created_at, updated_at)
    VALUES ('prod1','P','p','1000','published','2026-01-01','2026-01-01');
    INSERT INTO product_variants (id, product_id, sku, is_deleted, created_at, updated_at)
    VALUES ('v1','prod1','sku1',0,'2026-01-01','2026-01-01');
    INSERT INTO inventory_items (id, variant_id, quantity, reserved_quantity, sold_quantity, is_available, updated_at)
    VALUES ('ii1','v1',100,10,0,1,'2026-01-01');
    INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
    VALUES ('o1','ORD-1','+8801700000000','N','A',1000,0,0,1000,'cod','created','review','pending_review',0,1000,'2026-01-01','2026-01-01');
    INSERT INTO stock_reservations (id, order_id, variant_id, quantity, status, expires_at, created_at, updated_at)
    VALUES ('r1','o1','v1',10,'active','2026-12-31','2026-01-01','2026-01-01');
  `);
  return raw;
}

describe('INV-1: stock is invariant under confirm() — only reserved -> sold shifts', () => {
  it('confirming a reservation does not change inventory_items.quantity (stock)', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;

    const before = raw.prepare('SELECT quantity, reserved_quantity, sold_quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    expect(before.quantity).toBe(100);

    await confirmReservationsForOrder({ DB: db }, 'o1', '2026-01-02');

    const after = raw.prepare('SELECT quantity, reserved_quantity, sold_quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    expect(after.quantity).toBe(100); // stock UNCHANGED — this is the invariant
    expect(after.reserved_quantity).toBe(0); // reserved -> 0
    expect(after.sold_quantity).toBe(10); // sold += qty
  });

  it('the reservation row itself flips to confirmed', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    await confirmReservationsForOrder({ DB: db }, 'o1', '2026-01-02');
    const row = raw.prepare(`SELECT status FROM stock_reservations WHERE id = 'r1'`).get() as any;
    expect(row.status).toBe('confirmed');
  });

  it('available() arithmetic (stock - reserved - sold) is unchanged in total across confirm, only redistributed', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const before = raw.prepare('SELECT quantity, reserved_quantity, sold_quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    const availableBefore = before.quantity - before.reserved_quantity - before.sold_quantity;

    await confirmReservationsForOrder({ DB: db }, 'o1', '2026-01-02');

    const after = raw.prepare('SELECT quantity, reserved_quantity, sold_quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    const availableAfter = after.quantity - after.reserved_quantity - after.sold_quantity;
    expect(availableAfter).toBe(availableBefore); // confirming does not change what's available to sell
  });

  it('the DO source contains the fix (no stock decrement in the confirm action)', () => {
    const src = readFileSync(resolve('./src/do/variant-inventory-do.ts'), 'utf8');
    const confirmBlock = src.slice(src.indexOf('if (action === "confirm")'), src.indexOf('if (action === "confirm")') + 500);
    expect(confirmBlock).not.toContain('this.stock -=');
  });
});
