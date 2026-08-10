import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareAuditLogInsert, verifyAuditChainIncremental, recordAuditIntegrityCheck } from '../src/lib/audit';

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
  raw.exec(readFileSync(resolve(MIGRATIONS, '0007_audit_chain.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0056_audit_log_add_redaction.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0057_audit_log_add_redaction_reason.sql'), 'utf8'));
  raw.exec(`
    CREATE TABLE IF NOT EXISTS audit_integrity_alerts (
      id TEXT PRIMARY KEY,
      checked_at TEXT NOT NULL,
      valid INTEGER NOT NULL,
      checked_rows INTEGER NOT NULL,
      first_bad_index INTEGER,
      details_json TEXT
    );
  `);
  return raw;
}

async function writeEntries(db: D1Database, count: number, prefix = 'e') {
  for (let i = 0; i < count; i++) {
    const stmt = await prepareAuditLogInsert(db, {
      actorStaffId: null, actorRole: 'owner', action: `test.action.${prefix}${i}`,
      entityType: 'order', entityId: `${prefix}${i}`,
    });
    await stmt.run();
  }
}

describe('K-31: audit chain verification resumes from the last checkpoint instead of always restarting from genesis', () => {
  it('first run with no checkpoint verifies from genesis, like before', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    await writeEntries(db, 5);

    const result = await verifyAuditChainIncremental(db, 1000);
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(5);
    expect(result.reachedHead).toBe(true);
  });

  it('recordAuditIntegrityCheck writes a checkpoint at what it actually verified', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    await writeEntries(db, 5);

    await recordAuditIntegrityCheck(db, 1000);
    const checkpoint = raw.prepare(`SELECT last_audit_id FROM audit_checkpoints ORDER BY created_at DESC LIMIT 1`).get() as any;
    expect(checkpoint).toBeTruthy();

    const lastRow = raw.prepare(`SELECT id FROM audit_log ORDER BY rowid DESC LIMIT 1`).get() as any;
    expect(checkpoint.last_audit_id).toBe(lastRow.id);
  });

  it('a second run only re-verifies NEW rows since the checkpoint, not the whole history again', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    await writeEntries(db, 5, 'first');
    await recordAuditIntegrityCheck(db, 1000);

    await writeEntries(db, 3, 'second');
    const result = await verifyAuditChainIncremental(db, 1000);

    expect(result.valid).toBe(true);
    expect(result.checked).toBe(3); // only the 3 new rows, not all 8
    expect(result.reachedHead).toBe(true);
  });

  it('bounded by maxRows, reachedHead is false and coverage advances on the next run instead of restarting', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    await writeEntries(db, 10);

    // Simulate a small per-run cap (like the old `limit` on a huge table).
    const firstPass = await verifyAuditChainIncremental(db, 4);
    expect(firstPass.checked).toBe(4);
    expect(firstPass.reachedHead).toBe(false);

    // Checkpoint at what was actually verified (mirrors recordAuditIntegrityCheck's logic).
    if (firstPass.lastVerified) {
      raw.prepare(`INSERT INTO audit_checkpoints (id, last_audit_id, chain_hash, created_at) VALUES ('cp1', ?, ?, datetime('now'))`)
        .run(firstPass.lastVerified.id, firstPass.lastVerified.chainHash);
    }

    const secondPass = await verifyAuditChainIncremental(db, 4);
    expect(secondPass.checked).toBe(4); // next 4 rows, not re-checking rows 1-4 again
    expect(secondPass.reachedHead).toBe(false);

    if (secondPass.lastVerified) {
      raw.prepare(`INSERT INTO audit_checkpoints (id, last_audit_id, chain_hash, created_at) VALUES ('cp2', ?, ?, datetime('now'))`)
        .run(secondPass.lastVerified.id, secondPass.lastVerified.chainHash);
    }

    const thirdPass = await verifyAuditChainIncremental(db, 4);
    expect(thirdPass.checked).toBe(2); // remaining 2 rows
    expect(thirdPass.reachedHead).toBe(true); // now caught up to the head
  });

  it('cron-dispatch.ts no longer calls the old unconditional writeAuditCheckpoint(head)', () => {
    const src = readFileSync(resolve('./src/lib/cron-dispatch.ts'), 'utf8');
    expect(src).not.toContain('writeAuditCheckpoint(env.DB)');
  });
});
