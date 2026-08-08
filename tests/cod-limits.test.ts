import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkCodLimits } from '../src/lib/cod-limits';

const MIGRATIONS = resolve('./db/migrations');

class Stmt {
  private bound: unknown[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...values: unknown[]) { this.bound = values; return this; }
  private rows(): any[] {
    const raw = (this.db.prepare(this.sql) as any).all(...this.bound);
    return Array.isArray(raw) ? raw : [];
  }
  async first<T>(): Promise<T | null> { return (this.rows()[0] ?? null) as T | null; }
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

describe('checkCodLimits (S-04)', () => {
  it('falls back to defaults when site_settings has no rows', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const result = await checkCodLimits(db, { totalPaisa: 100_000, normalizedPhone: '+8801700000000', normalizedAddress: 'a' });
    expect(result.ok).toBe(true);
  });

  it('rejects when totalPaisa exceeds the configured ceiling', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    // Default ceiling is 500,000 paisa (BDT 5,000).
    const result = await checkCodLimits(db, { totalPaisa: 600_000, normalizedPhone: '+8801700000000', normalizedAddress: 'a' });
    expect(result).toEqual({ ok: false, reason: 'COD_VALUE_EXCEEDED' });
  });

  it('rejects the 3rd COD order from the same phone within 24h (default limit 2)', async () => {
    const raw = buildDb();
    seedOrder(raw, 'o1', '+8801700000001', 'addr a', 60);
    seedOrder(raw, 'o2', '+8801700000001', 'addr b', 30);
    const db = new D1Like(raw) as unknown as D1Database;
    const result = await checkCodLimits(db, { totalPaisa: 1000, normalizedPhone: '+8801700000001', normalizedAddress: 'addr c' });
    expect(result).toEqual({ ok: false, reason: 'COD_PHONE_VELOCITY' });
  });

  it('does not count orders older than 24h toward phone velocity', async () => {
    const raw = buildDb();
    seedOrder(raw, 'o1', '+8801700000002', 'addr a', 60);
    seedOrder(raw, 'o2', '+8801700000002', 'addr b', 60 * 30); // 30h ago
    const db = new D1Like(raw) as unknown as D1Database;
    const result = await checkCodLimits(db, { totalPaisa: 1000, normalizedPhone: '+8801700000002', normalizedAddress: 'addr c' });
    expect(result.ok).toBe(true);
  });

  it('rejects the 4th COD order to the same address within 24h (default limit 3)', async () => {
    const raw = buildDb();
    seedOrder(raw, 'o1', '+8801700000003', 'shared address', 10);
    seedOrder(raw, 'o2', '+8801700000004', 'SHARED ADDRESS', 20);
    seedOrder(raw, 'o3', '+8801700000005', '  shared address  ', 30);
    const db = new D1Like(raw) as unknown as D1Database;
    // Address match is case/whitespace-insensitive (lower(trim(address))).
    const result = await checkCodLimits(db, { totalPaisa: 1000, normalizedPhone: '+8801700000006', normalizedAddress: 'shared address' });
    expect(result).toEqual({ ok: false, reason: 'COD_ADDRESS_VELOCITY' });
  });

  it('reads thresholds from site_settings when present', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
      VALUES ('commerce.max_cod_value_paisa', '100', 'number', 'x', '', 'Commerce', 1, datetime('now'), datetime('now'));
    `);
    const db = new D1Like(raw) as unknown as D1Database;
    const result = await checkCodLimits(db, { totalPaisa: 200, normalizedPhone: '+8801700000007', normalizedAddress: 'a' });
    expect(result).toEqual({ ok: false, reason: 'COD_VALUE_EXCEEDED' });
  });
});
