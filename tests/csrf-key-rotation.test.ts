import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getCsrfSigningKeys, rotateCsrfSigningKey } from '../src/lib/csrf-keys';
import { createCsrfToken, verifyCsrfToken } from '../src/lib/security';
import { rotateCsrfKey } from '../src/lib/maintenance/csrf-rotation';

const MIGRATIONS = resolve('./db/migrations');
const SESSION_SECRET = 'test-session-secret-at-least-32-chars-long';

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
  raw.exec(readFileSync(resolve(MIGRATIONS, '0054_create_csrf_signing_keys.sql'), 'utf8'));
  return raw;
}

describe('K-36: CSRF signing key rotation is real, not a timestamp-only placeholder', () => {
  it('before any rotation, falls back to SESSION_SECRET (pre-rotation behavior preserved)', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const keys = await getCsrfSigningKeys(db, SESSION_SECRET);
    expect(keys.current).toBe(SESSION_SECRET);
    expect(keys.previous).toBeNull();
  });

  it('rotateCsrfSigningKey generates a genuinely new key, decoupled from SESSION_SECRET', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;

    await rotateCsrfSigningKey(db, SESSION_SECRET, '2026-01-01 00:00:00');
    const keys = await getCsrfSigningKeys(db, SESSION_SECRET);
    expect(keys.current).not.toBe(SESSION_SECRET);
    expect(keys.current).toHaveLength(64); // 32 random bytes, hex-encoded
    expect(keys.previous).toBeNull(); // nothing to demote on the first rotation
  });

  it('a second rotation demotes the first key to "previous" (dual-key verification window)', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;

    await rotateCsrfSigningKey(db, SESSION_SECRET, '2026-01-01 00:00:00');
    const afterFirst = await getCsrfSigningKeys(db, SESSION_SECRET);

    await rotateCsrfSigningKey(db, SESSION_SECRET, '2026-02-01 00:00:00');
    const afterSecond = await getCsrfSigningKeys(db, SESSION_SECRET);

    expect(afterSecond.current).not.toBe(afterFirst.current);
    expect(afterSecond.previous).toBe(afterFirst.current); // the old current is now previous
  });

  it('a token signed with the previous key still verifies during the rotation window', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;

    await rotateCsrfSigningKey(db, SESSION_SECRET, '2026-01-01 00:00:00');
    const { current: keyBeforeRotation } = await getCsrfSigningKeys(db, SESSION_SECRET);
    const tokenSignedBeforeRotation = await createCsrfToken(keyBeforeRotation);

    // Rotation happens (e.g. the monthly cron fires) while that token is
    // still sitting in someone's browser cookie.
    await rotateCsrfSigningKey(db, SESSION_SECRET, '2026-02-01 00:00:00');
    const { current: newKey, previous } = await getCsrfSigningKeys(db, SESSION_SECRET);

    expect(await verifyCsrfToken(tokenSignedBeforeRotation, newKey)).toBe(false); // fails the new key alone
    expect(await verifyCsrfToken(tokenSignedBeforeRotation, previous!)).toBe(true); // but passes as "previous"
  });

  it('rotateCsrfKey (the cron entrypoint) gates on a 30-day interval and actually rotates the key, not just a timestamp', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
      VALUES ('csrf_key_rotated_at', '${new Date().toISOString()}', 'text', 'x', '', 'System', 1, datetime('now'), datetime('now'));
    `);
    const env = { DB: new D1Like(raw) as unknown as D1Database, SESSION_SECRET };

    const result = await rotateCsrfKey(env);
    expect(result.rotated).toBe(false); // rotated today, well within 30 days

    const keys = await getCsrfSigningKeys(env.DB, SESSION_SECRET);
    expect(keys.current).toBe(SESSION_SECRET); // no rotation happened, still on the fallback
  });

  it('rotateCsrfKey actually calls rotateCsrfSigningKey when 30+ days have passed', async () => {
    const raw = buildDb();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    raw.exec(`
      INSERT INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
      VALUES ('csrf_key_rotated_at', '${old}', 'text', 'x', '', 'System', 1, datetime('now'), datetime('now'));
    `);
    const env = { DB: new D1Like(raw) as unknown as D1Database, SESSION_SECRET };

    const result = await rotateCsrfKey(env);
    expect(result.rotated).toBe(true);

    const keys = await getCsrfSigningKeys(env.DB, SESSION_SECRET);
    expect(keys.current).not.toBe(SESSION_SECRET); // a real key now exists in csrf_signing_keys
  });
});

describe('K-36: cron-dispatch.ts actually schedules the rotation (was previously unwired to anything)', () => {
  it('wires rotateCsrfKey into the daily maintenance block', () => {
    const src = readFileSync(resolve('./src/lib/cron-dispatch.ts'), 'utf8');
    expect(src).toContain("import('./maintenance/csrf-rotation')");
    expect(src).toContain('rotateCsrfKey(env');
  });
});

describe('K-36: middleware.ts CSRF validation uses the D1-managed dual-key path', () => {
  it('validateCsrfDoubleSubmit is called with the DB binding, not just SESSION_SECRET', () => {
    const src = readFileSync(resolve('./src/middleware.ts'), 'utf8');
    expect(src).toContain('validateCsrfDoubleSubmit(request, runtimeEnv?.SESSION_SECRET, runtimeEnv?.DB)');
  });

  it('login.ts signs new CSRF tokens with the D1-managed current key', () => {
    const src = readFileSync(resolve('./src/pages/api/staff/login.ts'), 'utf8');
    expect(src).toContain('getCsrfSigningKeys(env.DB, env.SESSION_SECRET)');
    expect(src).toContain('createCsrfToken(csrfSigningKey)');
  });
});
