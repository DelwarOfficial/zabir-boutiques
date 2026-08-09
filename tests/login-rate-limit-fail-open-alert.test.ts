import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkLoginRateLimit } from '../src/lib/login-rate-limit';

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
  raw.exec(readFileSync(resolve(MIGRATIONS, '0007_audit_chain.sql'), 'utf8'));
  return raw;
}

describe('K-26: fail-open rate limiter now alerts on KV misconfiguration', () => {
  it('still fails open (never blocks login) when KV is unbound', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const result = await checkLoginRateLimit(undefined, 'ip', '1.2.3.4', db);
    expect(result.ok).toBe(true);
  });

  it('writes an operational alert (via audit_log) when KV is unbound', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    await checkLoginRateLimit(undefined, 'ip', '1.2.3.4', db);

    const alert = raw.prepare(`SELECT action FROM audit_log WHERE action = 'login_rate_limit.kv_unbound'`).get() as any;
    expect(alert).toBeTruthy();
  });

  it('throttles to one alert per hour, not one per login attempt', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;

    for (let i = 0; i < 5; i++) {
      await checkLoginRateLimit(undefined, 'ip', '1.2.3.4', db);
    }

    const count = raw.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'login_rate_limit.kv_unbound'`).get() as any;
    expect(count.c).toBe(1);
  });

  it('does not throw or block when db is also unavailable (best-effort)', async () => {
    const result = await checkLoginRateLimit(undefined, 'ip', '1.2.3.4', undefined);
    expect(result.ok).toBe(true);
  });
});
