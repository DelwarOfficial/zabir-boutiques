import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkIdempotency, claimIdempotency } from '../src/lib/idempotency';

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
  return raw;
}

describe('idempotency-stuck-claim: a Worker crash between claim and complete/fail (T-27)', () => {
  it('checkIdempotency treats an expired processing row as absent (peek side)', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    // Simulate a claim made 31 minutes ago (past the 30-min expiry) that
    // never got completed or failed — the Worker died mid-request.
    raw.exec(`
      INSERT INTO checkout_idempotency (idempotency_key, status, created_at, expires_at)
      VALUES ('k1', 'processing', datetime('now','-31 minutes'), datetime('now','-1 minutes'));
    `);
    const peek = await checkIdempotency(db, 'k1');
    expect(peek).toEqual({ exists: false });
  });

  it('a fresh, non-expired processing claim is correctly seen as in-flight', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    raw.exec(`
      INSERT INTO checkout_idempotency (idempotency_key, status, created_at, expires_at)
      VALUES ('k2', 'processing', datetime('now'), datetime('now','+29 minutes'));
    `);
    const peek = await checkIdempotency(db, 'k2');
    expect(peek).toMatchObject({ exists: true, status: 'processing' });
  });

  it('KNOWN GAP: claimIdempotency cannot re-claim an expired key because idempotency_key is the PRIMARY KEY and the stale row is never deleted', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    raw.exec(`
      INSERT INTO checkout_idempotency (idempotency_key, status, created_at, expires_at)
      VALUES ('k3', 'processing', datetime('now','-31 minutes'), datetime('now','-1 minutes'));
    `);
    // checkIdempotency (the peek used by the route to decide whether to
    // proceed) says this key is free...
    const peek = await checkIdempotency(db, 'k3');
    expect(peek).toEqual({ exists: false });

    // ...but claimIdempotency's bare INSERT collides with the old row's
    // PRIMARY KEY and fails. checkout.ts does not check this return value
    // (`await claimIdempotency(...)` — result discarded), so the request
    // proceeds anyway rather than hard-failing; but the D1 claim record
    // itself never gets refreshed for this key. Documented here as a real
    // gap: a customer retry more than 30 minutes after a crashed attempt
    // is not blocked, but the stale row is not cleaned up either.
    const claimed = await claimIdempotency(db, 'k3', new Date().toISOString());
    expect(claimed).toBe(false);

    const row = await raw.prepare(`SELECT status FROM checkout_idempotency WHERE idempotency_key = 'k3'`).get() as any;
    expect(row.status).toBe('processing'); // still the stale row, 31+ minutes old
  });

  it('a genuinely fresh key claims successfully', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const claimed = await claimIdempotency(db, 'k4', new Date().toISOString());
    expect(claimed).toBe(true);
  });
});
