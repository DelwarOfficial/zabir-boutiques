import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanExpiredReservations } from '../src/lib/inventory';
import { RESERVATION_TTL_MINUTES } from '../src/lib/reservation-ttl';

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
  raw.exec(readFileSync(resolve(MIGRATIONS, '0024_stock_reservations_unique_constraint.sql'), 'utf8'));
  return raw;
}

function seed(raw: DatabaseSync): void {
  raw.exec(`
    INSERT INTO products (id, name, slug, price_paisa, status, created_at, updated_at)
    VALUES ('prod1','P','p','1000','published','2026-01-01 00:00:00','2026-01-01 00:00:00');
    INSERT INTO product_variants (id, product_id, sku, created_at, updated_at)
    VALUES ('v1','prod1','sku1','2026-01-01 00:00:00','2026-01-01 00:00:00'),
           ('v2','prod1','sku2','2026-01-01 00:00:00','2026-01-01 00:00:00'),
           ('v3','prod1','sku3','2026-01-01 00:00:00','2026-01-01 00:00:00'),
           ('v4','prod1','sku4','2026-01-01 00:00:00','2026-01-01 00:00:00');
    INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
    VALUES ('o1','ORD-1','01700000000','B','A',1000,0,0,1000,'uddoktapay','pending','review','pending_review',1000,0,'2026-01-01 00:00:00','2026-01-01 00:00:00');
    INSERT INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
    VALUES ('ii1','v1', 100, 10, 1, '2026-01-01 00:00:00'),
           ('ii2','v2', 100, 10, 1, '2026-01-01 00:00:00'),
           ('ii3','v3', 100, 10, 1, '2026-01-01 00:00:00'),
           ('ii4','v4', 100, 10, 1, '2026-01-01 00:00:00');
  `);
  // Four reservations exercising the boundary between the OLD
  // (created_at < now-15min) and the NEW (expires_at < now) release rule.
  // Each uses a distinct variant to satisfy the (order_id, variant_id)
  // unique index on active reservations.
  raw.exec(`
    INSERT INTO stock_reservations (id, order_id, variant_id, quantity, status, expires_at, created_at, updated_at)
    VALUES
      -- expired by expires_at (past), also created recently -> RELEASE
      ('r_expired','o1','v1',1,'active', datetime('now','-1 minutes'), datetime('now','-1 minutes'), datetime('now','-1 minutes')),
      -- expires in the future -> ACTIVE
      ('r_active','o1','v2',1,'active', datetime('now','+10 minutes'), datetime('now','-1 minutes'), datetime('now','-1 minutes')),
      -- OLD code would release this (created 20m ago) but expires_at is FUTURE -> ACTIVE (proves not created_at-based)
      ('r_old15','o1','v3',1,'active', datetime('now','+5 minutes'), datetime('now','-20 minutes'), datetime('now','-20 minutes')),
      -- OLD code would KEEP this (created 12m ago < 15m threshold) but expires_at is PAST -> RELEASE (proves expires_at-based)
      ('r_edge','o1','v4',1,'active', datetime('now','-12 minutes'), datetime('now','-12 minutes'), datetime('now','-12 minutes'));
  `);
}

function status(raw: DatabaseSync, id: string): string {
  return (raw.prepare('SELECT status FROM stock_reservations WHERE id = ?').get(id) as any).status;
}

describe('INV-3: reservation expiry is consistent between D1 cron and DO', () => {
  it('releases only reservations whose expires_at is past (ignores created_at age)', async () => {
    const raw = buildDb();
    seed(raw);
    const d1 = new D1Like(raw) as unknown as D1Database;

    await cleanExpiredReservations({ DB: d1 });

    expect(status(raw, 'r_expired')).toBe('released');
    expect(status(raw, 'r_edge')).toBe('released');
    expect(status(raw, 'r_active')).toBe('active');
    // The decisive case: old code keyed on created_at-15min would have
    // released r_old15 (created 20m ago). The fixed code keys on expires_at
    // (still in the future) and keeps it — matching the DO sweep.
    expect(status(raw, 'r_old15')).toBe('active');
  });

  it('all three layers agree on the same canonical TTL (no future drift)', () => {
    expect(RESERVATION_TTL_MINUTES).toBe(10);

    const inventory = readFileSync(resolve('./src/lib/inventory.ts'), 'utf8');
    // Cron must now gate on the per-reservation expires_at, not a
    // hardcoded 15-minute offset from created_at.
    expect(inventory).toContain('expires_at < ?2');
    expect(inventory).not.toContain("datetime('now', '-15 minutes')");

    const orders = readFileSync(resolve('./src/lib/orders.ts'), 'utf8');
    expect(orders).toContain('RESERVATION_TTL_MINUTES');

    const doSrc = readFileSync(resolve('./src/do/variant-inventory-do.ts'), 'utf8');
    expect(doSrc).toContain('RESERVATION_TTL_MS');
  });
});
