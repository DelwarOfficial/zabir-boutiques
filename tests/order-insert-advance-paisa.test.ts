import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { insertReservedOrderWithRetry } from '../src/lib/orders';

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
  raw.exec(readFileSync(resolve(MIGRATIONS, '0026_add_checkout_vat_paisa.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0052_orders_add_email.sql'), 'utf8'));
  raw.exec(`
    INSERT INTO products (id, name, slug, price_paisa, status, created_at, updated_at)
    VALUES ('prod1','P','p','1000','published','2026-01-01','2026-01-01');
    INSERT INTO product_variants (id, product_id, sku, is_deleted, created_at, updated_at)
    VALUES ('v1','prod1','sku1',0,'2026-01-01','2026-01-01');
    INSERT INTO inventory_items (id, variant_id, quantity, reserved_quantity, sold_quantity, is_available, updated_at)
    VALUES ('ii1','v1',100,0,0,1,'2026-01-01');
  `);
  return raw;
}

describe('K-09: advance_paisa/balance_paisa are set atomically in the order INSERT, no post-insert UPDATE race window', () => {
  it('order row has correct advance/balance immediately after insertReservedOrderWithRetry resolves', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;

    const { orderId } = await insertReservedOrderWithRetry(db, {
      phone: '+8801700000000', name: 'N', address: 'A',
      subtotal_paisa: 1000, delivery_paisa: 0, discount_paisa: 0, total_paisa: 1000,
      advance_paisa: 300, balance_paisa: 700,
      payment_method: 'partial_prepay', fraud_decision: 'review',
    }, [{ variantId: 'v1', quantity: 1, unitPricePaisa: 1000 }], '2026-01-01 00:00:00');

    const row = raw.prepare('SELECT advance_paisa, balance_paisa FROM orders WHERE id = ?').get(orderId) as any;
    expect(row.advance_paisa).toBe(300);
    expect(row.balance_paisa).toBe(700);
  });

  it('defaults balance_paisa to total_paisa and advance_paisa to 0 when omitted (e.g. plain COD)', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;

    const { orderId } = await insertReservedOrderWithRetry(db, {
      phone: '+8801700000000', name: 'N', address: 'A',
      subtotal_paisa: 1000, delivery_paisa: 0, discount_paisa: 0, total_paisa: 1000,
      payment_method: 'cod', fraud_decision: 'review',
    }, [{ variantId: 'v1', quantity: 1, unitPricePaisa: 1000 }], '2026-01-01 00:00:00');

    const row = raw.prepare('SELECT advance_paisa, balance_paisa FROM orders WHERE id = ?').get(orderId) as any;
    expect(row.advance_paisa).toBe(0);
    expect(row.balance_paisa).toBe(1000);
  });

  it('checkout.ts no longer has a post-insert UPDATE orders SET advance_paisa race window', () => {
    const src = readFileSync(resolve('./src/pages/api/checkout.ts'), 'utf8');
    const beforeCatch = src.slice(0, src.indexOf('} catch (err) {'));
    expect(beforeCatch).not.toContain('UPDATE orders SET advance_paisa = ?2, balance_paisa = ?3, updated_at = ?4 WHERE id = ?1');
  });

  it('buy-now/submit.ts no longer has a post-insert UPDATE orders SET advance_paisa race window on the happy path', () => {
    const src = readFileSync(resolve('./src/pages/api/buy-now/submit.ts'), 'utf8');
    const beforeCatch = src.slice(0, src.indexOf('} catch (err) {'));
    expect(beforeCatch).not.toContain('UPDATE orders SET advance_paisa = ?2, balance_paisa = ?3, updated_at = ?4 WHERE id = ?1');
  });
});
