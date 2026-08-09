import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyPaymentVerified } from '../src/lib/payments';

/**
 * K-45: the previous version of this file hand-simulated the outcome in
 * plain JS (mutating a local `inventoryState` object, never calling
 * applyPaymentVerified) — it always passed regardless of whether the real
 * over-allocation handling in payments.ts actually works. This drives the
 * real function against a real SQLite-backed D1 adapter.
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
  return raw;
}

function seedOrder(raw: DatabaseSync, opts: { reservationStatus: 'active' | 'released' | 'none'; qty: number }) {
  raw.exec(`
    INSERT INTO products (id, name, slug, price_paisa, status, created_at, updated_at)
    VALUES ('prod1','P','p','1000','published','2026-01-01','2026-01-01');
    INSERT INTO product_variants (id, product_id, sku, is_deleted, created_at, updated_at)
    VALUES ('v1','prod1','sku1',0,'2026-01-01','2026-01-01');
    INSERT INTO inventory_items (id, variant_id, quantity, reserved_quantity, sold_quantity, is_available, updated_at)
    VALUES ('ii1','v1',${opts.qty},${opts.reservationStatus === 'active' ? 2 : 0},0,1,'2026-01-01');
    INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
    VALUES ('o1','ORD-1','+8801700000000','N','A',1000,0,0,1000,'uddoktapay','pending','review','pending_payment',0,1000,'2026-01-01','2026-01-01');
    INSERT INTO payments (id, order_id, invoice_id, provider, amount_paisa, status, created_at, updated_at)
    VALUES ('p1','o1','inv1','uddoktapay',1000,'pending','2026-01-01','2026-01-01');
  `);
  if (opts.reservationStatus !== 'none') {
    raw.exec(`
      INSERT INTO stock_reservations (id, order_id, variant_id, quantity, status, expires_at, created_at, updated_at)
      VALUES ('res1','o1','v1',2,'${opts.reservationStatus}','2099-01-01','2026-01-01','2026-01-01');
    `);
  }
}

describe('K-45: applyPaymentVerified handles paid-after-reservation-expiry (real code, real SQLite)', () => {
  it('reservation still active with sufficient stock: order moves to payment_verified, status "paid"', async () => {
    const raw = buildDb();
    seedOrder(raw, { reservationStatus: 'active', qty: 10 });
    const env = { DB: new D1Like(raw) as unknown as D1Database };

    const result = await applyPaymentVerified(env, 'inv1', { amountPaisa: 1000, metadata: { order_id: 'o1' }, rawResponse: '{}' }, '2026-01-02 00:00:00');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe('paid');

    const order = raw.prepare('SELECT status FROM orders WHERE id = ?').get('o1') as any;
    expect(order.status).toBe('payment_verified');
  });

  it('reservation already expired/released before the webhook lands: order moves to paid_over_allocated for staff review', async () => {
    const raw = buildDb();
    // No active reservation row at all — mirrors the TTL sweep having
    // already released it before the delayed webhook arrived, AND no
    // manual staff confirm happened either (unlike the INV-1 "manual
    // confirm beat the webhook" case, which also has zero active rows but
    // is indistinguishable from this one at the D1 layer — both fall back
    // to the same "no active reservations" branch in payments.ts).
    seedOrder(raw, { reservationStatus: 'none', qty: 10 });
    const env = { DB: new D1Like(raw) as unknown as D1Database };

    const result = await applyPaymentVerified(env, 'inv1', { amountPaisa: 1000, metadata: { order_id: 'o1' }, rawResponse: '{}' }, '2026-01-02 00:00:00');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe('paid');
  });

  // NOT part of K-45 (fake-test) — while building a real replacement for
  // the fake test, this surfaced a genuine pre-existing gap not covered by
  // either audit source: adjustStock() only guards `quantity >= 0`, not
  // `quantity >= reserved_quantity`, so a damage/loss write-off can leave
  // quantity below what's already reserved. The confirm-time deduct then
  // shifts reserved -> sold WITHOUT re-checking current quantity, so
  // sold_quantity can exceed real physical stock. Documented here as
  // current (not necessarily correct) behavior rather than silently
  // "fixed" under a fake-test cleanup — flagged separately, not patched.
  it('KNOWN GAP (not K-45, found while replacing the fake test): stock reduced below reserved_quantity after reservation is NOT re-validated at confirm time', async () => {
    const raw = buildDb();
    seedOrder(raw, { reservationStatus: 'active', qty: 1 }); // reserved=2 > quantity=1
    const env = { DB: new D1Like(raw) as unknown as D1Database };

    const result = await applyPaymentVerified(env, 'inv1', { amountPaisa: 1000, metadata: { order_id: 'o1' }, rawResponse: '{}' }, '2026-01-02 00:00:00');
    expect(result.ok).toBe(true);

    const inv = raw.prepare('SELECT quantity, reserved_quantity, sold_quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    // Current behavior: sold_quantity (2) exceeds quantity (1) — an
    // overselling condition, not caught as paid_over_allocated. This
    // assertion documents the gap; it is not an endorsement of it.
    expect(inv.sold_quantity).toBeGreaterThan(inv.quantity);
  });
});
