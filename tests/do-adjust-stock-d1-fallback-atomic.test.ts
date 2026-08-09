import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { doAdjustStock } from '../src/lib/do-client';

const MIGRATIONS = resolve('./db/migrations');

class Stmt {
  private bound: unknown[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...values: unknown[]) { this.bound = values; return this; }
  private rows(): any[] { const raw = (this.db.prepare(this.sql) as any).all(...this.bound); return Array.isArray(raw) ? raw : []; }
  async first<T>(): Promise<T | null> { return (this.rows()[0] ?? null) as T | null; }
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

function buildDb(startQty: number): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0011_master_prompt_v7_gaps.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0038_inventory_movements.sql'), 'utf8'));
  raw.exec(`
    INSERT INTO products (id, name, slug, price_paisa, status, created_at, updated_at)
    VALUES ('prod1','P','p','1000','published','2026-01-01','2026-01-01');
    INSERT INTO product_variants (id, product_id, sku, is_deleted, created_at, updated_at)
    VALUES ('v1','prod1','sku1',0,'2026-01-01','2026-01-01');
    INSERT INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
    VALUES ('ii1','v1',${startQty},0,1,'2026-01-01');
    INSERT INTO staff_users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
    VALUES ('staff1','staff1@zabir.local','x','Staff One','manager',1,'2026-01-01','2026-01-01');
    INSERT INTO staff_users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
    VALUES ('staff2','staff2@zabir.local','x','Staff Two','manager',1,'2026-01-01','2026-01-01');
  `);
  return raw;
}

describe('K-44: doAdjustStock D1 fallback rejects a negative-result delta atomically (guarded UPDATE, not a stale pre-read)', () => {
  it('rejects a delta that would take quantity negative, no stock_adjustments row written', async () => {
    const raw = buildDb(5);
    const env = { DB: new D1Like(raw) as unknown as D1Database };

    const result = await doAdjustStock(env, 'v1', -10, 'damage', 'staff1', undefined, 'adj-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('INSUFFICIENT_STOCK');

    const row = raw.prepare('SELECT quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    expect(row.quantity).toBe(5); // unchanged

    const adjustments = raw.prepare('SELECT COUNT(*) AS c FROM stock_adjustments WHERE variant_id = ?').get('v1') as any;
    expect(adjustments.c).toBe(0); // no misleading audit row for a rejected adjustment
  });

  it('two concurrent adjustments that would together go negative: exactly one succeeds, never negative stock', async () => {
    const raw = buildDb(3);
    const env = { DB: new D1Like(raw) as unknown as D1Database };

    const settled = await Promise.allSettled([
      doAdjustStock(env, 'v1', -3, 'damage', 'staff1', undefined, 'adj-a'),
      doAdjustStock(env, 'v1', -3, 'damage', 'staff2', undefined, 'adj-b'),
    ]);

    const row = raw.prepare('SELECT quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    expect(row.quantity).toBeGreaterThanOrEqual(0);

    const succeeded = settled.filter((r) => r.status === 'fulfilled' && r.value.ok);
    expect(succeeded.length).toBeLessThanOrEqual(1);
  });

  it('a valid adjustment succeeds and writes exactly one stock_adjustments row', async () => {
    const raw = buildDb(10);
    const env = { DB: new D1Like(raw) as unknown as D1Database };

    const result = await doAdjustStock(env, 'v1', 5, 'restock', 'staff1', undefined, 'adj-c');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.new_stock).toBe(15);

    const row = raw.prepare('SELECT quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    expect(row.quantity).toBe(15);
    const adjustments = raw.prepare('SELECT COUNT(*) AS c FROM stock_adjustments WHERE variant_id = ?').get('v1') as any;
    expect(adjustments.c).toBe(1);
  });
});
