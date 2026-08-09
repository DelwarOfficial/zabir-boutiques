import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkCodLimits, normalizeAddressForVelocityCheck } from '../src/lib/cod-limits';

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
}

function buildDb(): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
  return raw;
}

function seedOrder(raw: DatabaseSync, id: string, phone: string, address: string, minutesAgo: number): void {
  raw.exec(`
    INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
    VALUES ('${id}','${id}','${phone}','N','${address}',1000,0,0,1000,'cod','created','review','pending_review',0,1000,
      datetime('now','-${minutesAgo} minutes'), datetime('now','-${minutesAgo} minutes'));
  `);
}

describe('K-17: COD address velocity survives whitespace/punctuation variation (old bug: lower().trim() only)', () => {
  it('normalizeAddressForVelocityCheck collapses whitespace and strips punctuation', () => {
    expect(normalizeAddressForVelocityCheck('House 5,  Road  2')).toBe('house 5 road 2');
    expect(normalizeAddressForVelocityCheck('House 5, Road 2')).toBe('house 5 road 2');
    expect(normalizeAddressForVelocityCheck('House-5/Road-2')).toBe('house 5 road 2');
  });

  it('3 orders to cosmetically-different renderings of the same address are still caught as the same address (limit 3)', async () => {
    const raw = buildDb();
    seedOrder(raw, 'o1', '+8801700000001', 'House 5, Road 2', 10);
    seedOrder(raw, 'o2', '+8801700000002', 'House 5,  Road  2', 20); // extra spaces
    seedOrder(raw, 'o3', '+8801700000003', 'House 5. Road 2', 30); // different punctuation
    const db = new D1Like(raw) as unknown as D1Database;

    const result = await checkCodLimits(db, {
      totalPaisa: 1000,
      normalizedPhone: '+8801700000004',
      normalizedAddress: 'House-5/Road-2', // yet another cosmetic variant
    });
    expect(result).toEqual({ ok: false, reason: 'COD_ADDRESS_VELOCITY' });
  });

  it('genuinely different addresses are not conflated', async () => {
    const raw = buildDb();
    seedOrder(raw, 'o1', '+8801700000001', 'House 5, Road 2', 10);
    const db = new D1Like(raw) as unknown as D1Database;

    const result = await checkCodLimits(db, {
      totalPaisa: 1000,
      normalizedPhone: '+8801700000002',
      normalizedAddress: 'House 9, Road 4',
    });
    expect(result.ok).toBe(true);
  });
});
