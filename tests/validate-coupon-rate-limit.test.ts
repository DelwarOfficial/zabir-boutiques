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
  raw.exec(readFileSync(resolve(MIGRATIONS, '0010_coupon_claim_tokens.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0011_master_prompt_v7_gaps.sql'), 'utf8'));
  return raw;
}

describe('K-10/N-22: coupon-rate-limit is actually wired into validate-coupon.ts', () => {
  it('validate-coupon.ts imports and calls checkCouponRateLimit/recordCouponFailure/clearCouponFailures', () => {
    const src = readFileSync(resolve('./src/pages/api/checkout/validate-coupon.ts'), 'utf8');
    expect(src).toContain("from '../../../lib/coupon-rate-limit'");
    expect(src).toContain('checkCouponRateLimit(env.DB, rateLimitKey)');
    expect(src).toContain("recordCouponFailure(env.DB, rateLimitKey, 'COUPON_NOT_FOUND')");
    expect(src).toContain('clearCouponFailures(env.DB, rateLimitKey)');
  });

  it('5 failed lookups lock out the 6th attempt for the same key (real D1 semantics)', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const { checkCouponRateLimit, recordCouponFailure } = await import('../src/lib/coupon-rate-limit');

    for (let i = 0; i < 5; i++) {
      const check = await checkCouponRateLimit(db, 'session-x');
      expect(check.allowed).toBe(true);
      await recordCouponFailure(db, 'session-x', 'COUPON_NOT_FOUND');
    }
    const locked = await checkCouponRateLimit(db, 'session-x');
    expect(locked.allowed).toBe(false);
    expect(locked.lockedUntil).toBeTruthy();
  });

  it('a different session/key is unaffected by another key being locked out', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const { checkCouponRateLimit, recordCouponFailure } = await import('../src/lib/coupon-rate-limit');

    for (let i = 0; i < 5; i++) await recordCouponFailure(db, 'session-attacker', 'COUPON_NOT_FOUND');
    const victim = await checkCouponRateLimit(db, 'session-victim');
    expect(victim.allowed).toBe(true);
  });
});
