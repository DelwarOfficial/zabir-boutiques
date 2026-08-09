import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reserveVariants } from '../src/lib/inventory';
import { applyCouponAtomic } from '../src/lib/money';

/**
 * K-41: the previous version of this file hand-simulated outcomes in plain
 * JS (`if (successes === 0) { successes++; return { ok: true } }`) without
 * ever calling reserveVariants/applyCouponAtomic. It passed unconditionally
 * regardless of whether the real guarded-UPDATE logic actually prevents
 * over-allocation — false confidence. These now run the real functions
 * against a real SQLite-backed D1 adapter with genuinely concurrent
 * Promise.all callers.
 */

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
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        this.db.exec('COMMIT');
        return out;
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
    const out = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }
}

function buildDb(): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0017_variants_stock_generated.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0010_coupon_claim_tokens.sql'), 'utf8'));
  return raw;
}

describe('inventory race conditions (real reserveVariants, real SQLite, no VARIANT_INVENTORY_DO)', () => {
  it('10 concurrent attempts to reserve the last 1 unit: exactly 1 succeeds', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO products (id, name, slug, price_paisa, status, created_at, updated_at)
      VALUES ('prod1','P','p','1000','published','2026-01-01','2026-01-01');
      INSERT INTO product_variants (id, product_id, sku, is_deleted, created_at, updated_at)
      VALUES ('v1','prod1','sku1',0,'2026-01-01','2026-01-01');
      INSERT INTO inventory_items (id, variant_id, quantity, reserved_quantity, sold_quantity, is_available, updated_at)
      VALUES ('ii1','v1',1,0,0,1,'2026-01-01');
    `);
    const env = { DB: new D1Like(raw) as unknown as D1Database };

    // node:sqlite's DatabaseSync is a single connection, so genuinely
    // overlapping BEGIN IMMEDIATE transactions from concurrent callers
    // throw ("cannot start a transaction within a transaction") rather
    // than blocking/queuing the way separate D1 connections would.
    // allSettled captures that as a rejection alongside the ok:false
    // outcomes from the WHERE-guarded UPDATE — either way is a correctly
    // rejected over-allocation attempt, and the real assertion (no more
    // than 1 unit ever gets reserved) is checked directly against the row.
    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, () => reserveVariants(env, [{ variantId: 'v1', qty: 1 }], '2026-01-01 00:00:00')),
    );

    const successes = settled.filter((r) => r.status === 'fulfilled' && r.value.ok);
    expect(successes.length).toBe(1);

    const row = raw.prepare('SELECT quantity, reserved_quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    expect(row.reserved_quantity).toBe(1); // not over-reserved past the 1 unit that exists
    expect(row.quantity).toBe(1); // stock itself untouched by reservation
  });

  it('multi-item reservation: one item out of stock fails the whole batch (no partial reservation left behind)', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO products (id, name, slug, price_paisa, status, created_at, updated_at)
      VALUES ('prod1','P','p','1000','published','2026-01-01','2026-01-01');
      INSERT INTO product_variants (id, product_id, sku, is_deleted, created_at, updated_at) VALUES
        ('v1','prod1','sku1',0,'2026-01-01','2026-01-01'),
        ('v2','prod1','sku2',0,'2026-01-01','2026-01-01');
      INSERT INTO inventory_items (id, variant_id, quantity, reserved_quantity, sold_quantity, is_available, updated_at) VALUES
        ('ii1','v1',5,0,0,1,'2026-01-01'),
        ('ii2','v2',0,0,0,1,'2026-01-01');
    `);
    const env = { DB: new D1Like(raw) as unknown as D1Database };

    const result = await reserveVariants(env, [{ variantId: 'v1', qty: 1 }, { variantId: 'v2', qty: 1 }], '2026-01-01 00:00:00');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedVariantId).toBe('v2');

    // v1 must not be left reserved even though it "succeeded" before v2 failed.
    const v1 = raw.prepare('SELECT reserved_quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    expect(v1.reserved_quantity).toBe(0);
  });
});

describe('coupon race condition (real applyCouponAtomic, real SQLite)', () => {
  it('20 concurrent checkouts for a 1-use coupon: exactly 1 claim succeeds', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO coupons (id, code, discount_type, discount_amount_paisa, min_order_paisa, usage_limit, used_count, is_active, created_at, updated_at)
      VALUES ('c1','SAVE10','fixed',1000,0,1,0,1,'2026-01-01','2026-01-01');
    `);
    const db = new D1Like(raw) as unknown as D1Database;

    const settled = await Promise.allSettled(
      Array.from({ length: 20 }, () => applyCouponAtomic(db, 'SAVE10', 5000, '2026-01-01 00:00:00')),
    );

    const succeeded = settled.filter((r) => r.status === 'fulfilled' && r.value.ok);
    expect(succeeded.length).toBe(1);

    const row = raw.prepare('SELECT used_count FROM coupons WHERE code = ?').get('SAVE10') as any;
    expect(row.used_count).toBe(1); // not incremented 20 times
  });
});
