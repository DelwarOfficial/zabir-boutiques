import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getVatRatePercent, calculateVatPaisa, allocateVatByLargestRemainder } from '../src/lib/vat';

const MIGRATIONS = resolve('./db/migrations');

class Stmt {
  private bound: unknown[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...values: unknown[]) { this.bound = values; return this; }
  private rows(): any[] { const raw = (this.db.prepare(this.sql) as any).all(...this.bound); return Array.isArray(raw) ? raw : []; }
  async first<T>(): Promise<T | null> { return (this.rows()[0] ?? null) as T | null; }
}
class D1Like {
  constructor(private db: DatabaseSync) {}
  prepare(sql: string) { return new Stmt(this.db, sql); }
}

function buildDb(): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(resolve(MIGRATIONS, '0053_create_tax_rates.sql'), 'utf8'));
  return raw;
}

describe('§11.7 VAT: rate source is D1 tax_rates, not VAT_RATE_PERCENT', () => {
  it('returns 0 when no tax_rates row is effective (current real state — D-03 unresolved)', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    expect(await getVatRatePercent(db, 'goods', '2026-01-01 00:00:00')).toBe(0);
  });

  it('returns the effective rate for the given date', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO tax_rates (id, applies_to, rate_percent, effective_from, effective_to, created_at, updated_at)
      VALUES ('r1','goods',15,'2026-01-01 00:00:00',NULL,'2026-01-01','2026-01-01');
    `);
    const db = new D1Like(raw) as unknown as D1Database;
    expect(await getVatRatePercent(db, 'goods', '2026-06-01 00:00:00')).toBe(15);
    expect(await getVatRatePercent(db, 'goods', '2025-12-31 00:00:00')).toBe(0); // before effective_from
  });

  it('respects effective_to (rate changes over time)', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO tax_rates (id, applies_to, rate_percent, effective_from, effective_to, created_at, updated_at) VALUES
        ('r1','goods',10,'2026-01-01 00:00:00','2026-06-01 00:00:00','2026-01-01','2026-01-01'),
        ('r2','goods',15,'2026-06-01 00:00:00',NULL,'2026-01-01','2026-01-01');
    `);
    const db = new D1Like(raw) as unknown as D1Database;
    expect(await getVatRatePercent(db, 'goods', '2026-03-01 00:00:00')).toBe(10);
    expect(await getVatRatePercent(db, 'goods', '2026-07-01 00:00:00')).toBe(15);
  });

  it('delivery is untaxed unless a delivery row is seeded (D-03 default: option A)', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO tax_rates (id, applies_to, rate_percent, effective_from, effective_to, created_at, updated_at)
      VALUES ('r1','goods',15,'2026-01-01 00:00:00',NULL,'2026-01-01','2026-01-01');
    `);
    const db = new D1Like(raw) as unknown as D1Database;
    expect(await getVatRatePercent(db, 'delivery', '2026-06-01 00:00:00')).toBe(0);
  });
});

describe('§11.7 step 4: half-up integer rounding', () => {
  it('rounds .5 up', () => {
    expect(calculateVatPaisa(1050, 15)).toBe(158); // 157.5 -> 158
  });
  it('rounds down below .5', () => {
    expect(calculateVatPaisa(1000, 15)).toBe(150); // exact
  });
  it('zero rate or zero base gives zero VAT', () => {
    expect(calculateVatPaisa(1000, 0)).toBe(0);
    expect(calculateVatPaisa(0, 15)).toBe(0);
  });
});

describe('§11.7 step 5: largest-remainder per-line allocation (sum invariant)', () => {
  it('lines sum exactly to the order total, even with rounding remainders', () => {
    // 3 lines, prices that force fractional shares.
    const lines = [
      { id: 'a', linePaisa: 333 },
      { id: 'b', linePaisa: 333 },
      { id: 'c', linePaisa: 334 },
    ];
    const total = 100; // 100/1000 * each line's share
    const allocation = allocateVatByLargestRemainder(lines, total);
    const sum = [...allocation.values()].reduce((s, v) => s + v, 0);
    expect(sum).toBe(total);
  });

  it('breaks ties by ascending id', () => {
    const lines = [
      { id: 'z', linePaisa: 500 },
      { id: 'a', linePaisa: 500 },
    ];
    // Equal shares with a 1-paisa remainder to distribute: goes to 'a' (ascending id).
    const allocation = allocateVatByLargestRemainder(lines, 1);
    expect(allocation.get('a')).toBe(1);
    expect(allocation.get('z')).toBe(0);
  });

  it('zero total VAT gives every line zero, not undefined', () => {
    const lines = [{ id: 'a', linePaisa: 500 }, { id: 'b', linePaisa: 500 }];
    const allocation = allocateVatByLargestRemainder(lines, 0);
    expect(allocation.get('a')).toBe(0);
    expect(allocation.get('b')).toBe(0);
  });

  it('handles a large, realistic multi-line cart with exact sum invariant', () => {
    const lines = [
      { id: '1', linePaisa: 129900 },
      { id: '2', linePaisa: 45000 },
      { id: '3', linePaisa: 199900 },
      { id: '4', linePaisa: 15000 },
    ];
    const totalVat = calculateVatPaisa(lines.reduce((s, l) => s + l.linePaisa, 0), 15);
    const allocation = allocateVatByLargestRemainder(lines, totalVat);
    const sum = [...allocation.values()].reduce((s, v) => s + v, 0);
    expect(sum).toBe(totalVat);
  });
});
