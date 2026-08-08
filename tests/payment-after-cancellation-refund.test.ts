import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve('./db/migrations');

class Stmt {
  private bound: unknown[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...values: unknown[]) { this.bound = values; return this; }
  private rows(): any[] { const raw = (this.db.prepare(this.sql) as any).all(...this.bound); return Array.isArray(raw) ? raw : []; }
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
  raw.exec(readFileSync(resolve(MIGRATIONS, '0024_stock_reservations_unique_constraint.sql'), 'utf8'));
  raw.exec(`
    INSERT INTO products (id, name, slug, price_paisa, status, created_at, updated_at)
    VALUES ('prod1','P','p','1000','published','2026-01-01','2026-01-01');
    INSERT INTO product_variants (id, product_id, sku, created_at, updated_at)
    VALUES ('v1','prod1','sku1','2026-01-01','2026-01-01');
    INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
    VALUES ('o1','ORD-1','+8801700000000','N','A',1000,0,0,1000,'uddoktapay','pending','review','pending_payment',1000,0,'2026-01-01','2026-01-01');
    INSERT INTO stock_reservations (id, order_id, variant_id, quantity, status, expires_at, created_at, updated_at)
    VALUES ('r1','o1','v1',1,'active','2026-01-01 12:00:00','2026-01-01 10:00:00','2026-01-01 10:00:00');
  `);
  return raw;
}

// Mirrors src/lib/inventory.ts claimReservationsForRelease.
async function claimForRelease(db: D1Like, reservationId: string, now: string): Promise<number> {
  const res = await db.prepare(
    `UPDATE stock_reservations SET release_requested_at = ?2, status = 'release_requested', updated_at = ?2
     WHERE id = ?1 AND release_requested_at IS NULL AND status = 'active'`,
  ).bind(reservationId, now).run();
  return res.meta.changes;
}

describe('payment-after-cancellation-refund: reconciliation cannot release a reservation payment already confirmed', () => {
  it('a reservation already moved to confirmed by payment-verify is not claimable by the abandon-cancel path', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;

    // Simulates applyPaymentVerified winning the race first: it confirms
    // the reservation (active -> confirmed) atomically with the order's
    // payment_verified transition.
    raw.exec(`UPDATE stock_reservations SET status = 'confirmed' WHERE id = 'r1'`);
    raw.exec(`UPDATE orders SET status = 'payment_verified' WHERE id = 'o1'`);

    // reconcilePendingPayments then runs its 2h-stale abandon sweep and
    // tries to claim the same reservation for release.
    const changes = await claimForRelease(db, 'r1', '2026-01-01 13:00:00');
    expect(changes).toBe(0); // claim fails: status is no longer 'active'

    const row = raw.prepare('SELECT status FROM stock_reservations WHERE id = ?').get('r1') as any;
    expect(row.status).toBe('confirmed'); // untouched — stock stays sold, not released out from under a paid order
  });

  it('the orders.cancelled UPDATE is status-guarded and no-ops if payment already advanced the order', () => {
    const raw = buildDb();
    raw.exec(`UPDATE orders SET status = 'payment_verified' WHERE id = 'o1'`);

    // Reconciliation captured fromStatus='pending_payment' before the race;
    // its guarded UPDATE targets that stale status.
    const res = raw.prepare(
      `UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = ?`,
    ).run('2026-01-01 13:00:00', 'o1', 'pending_payment');
    expect((res as any).changes).toBe(0);

    const row = raw.prepare('SELECT status FROM orders WHERE id = ?').get('o1') as any;
    expect(row.status).toBe('payment_verified'); // order stays paid, not incorrectly cancelled
  });

  it('the normal (no race) path: an unpaid, truly-stale order releases its reservation cleanly', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const changes = await claimForRelease(db, 'r1', '2026-01-01 13:00:00');
    expect(changes).toBe(1);
  });
});
