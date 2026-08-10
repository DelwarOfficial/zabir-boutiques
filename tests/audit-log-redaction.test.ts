import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  prepareAuditLogInsert,
  verifyAuditChain,
  verifyAuditChainIncremental,
  recordAuditIntegrityCheck,
  redactAuditLogEntry,
  redactAuditLogForOrders,
} from '../src/lib/audit';

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
  async batch(stmts: Stmt[]) {
    for (const s of stmts) await s.run();
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

async function writeOrderEntry(db: D1Database, orderId: string, metadata: unknown) {
  const stmt = await prepareAuditLogInsert(db, {
    actorStaffId: null, actorRole: 'owner', action: 'order.created',
    entityType: 'order', entityId: orderId, metadata,
  });
  await stmt.run();
  const row = await db.prepare(`SELECT id FROM audit_log ORDER BY rowid DESC LIMIT 1`).first<{ id: string }>();
  return row!.id;
}

describe('N-11: audit_log redaction preserves hash-chain integrity', () => {
  it('redaction is refused when the row has never been covered by a verified checkpoint', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const id = await writeOrderEntry(db, 'o1', { name: 'Karim', phone: '01700000000' });

    const outcome = await redactAuditLogEntry(db, id, 'test');
    expect(outcome).toBe('not_yet_verified');
    const row = raw.prepare(`SELECT metadata_json, redacted_at FROM audit_log WHERE id = ?`).get(id) as any;
    expect(row.metadata_json).toContain('Karim');
    expect(row.redacted_at).toBeNull();
  });

  it('redaction succeeds once the row is behind a verified checkpoint, blanking metadata_json without touching chain_hash/previous_hash', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const id = await writeOrderEntry(db, 'o1', { name: 'Karim', phone: '01700000000' });
    await recordAuditIntegrityCheck(db, 1000);

    const before = raw.prepare(`SELECT chain_hash, previous_hash FROM audit_log WHERE id = ?`).get(id) as any;

    const outcome = await redactAuditLogEntry(db, id, 'customer_data_deletion');
    expect(outcome).toBe('redacted');

    const after = raw.prepare(`SELECT chain_hash, previous_hash, metadata_json, redacted_at, redacted_reason FROM audit_log WHERE id = ?`).get(id) as any;
    expect(after.metadata_json).toBeNull();
    expect(after.redacted_at).toBeTruthy();
    expect(after.redacted_reason).toBe('customer_data_deletion');
    expect(after.chain_hash).toBe(before.chain_hash);
    expect(after.previous_hash).toBe(before.previous_hash);
  });

  it('redacting the same row twice is a no-op the second time', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const id = await writeOrderEntry(db, 'o1', { name: 'Karim' });
    await recordAuditIntegrityCheck(db, 1000);

    expect(await redactAuditLogEntry(db, id, 'r1')).toBe('redacted');
    expect(await redactAuditLogEntry(db, id, 'r2')).toBe('already_redacted');
    const row = raw.prepare(`SELECT redacted_reason FROM audit_log WHERE id = ?`).get(id) as any;
    expect(row.redacted_reason).toBe('r1'); // first reason wins, second call didn't overwrite
  });

  it('redacting an unknown id returns not_found', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    expect(await redactAuditLogEntry(db, 'does-not-exist', 'r')).toBe('not_found');
  });

  it('chain re-verifies as valid after redaction — verifyAuditChain skips literal recompute for redacted rows but still checks previous_hash linkage', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const id1 = await writeOrderEntry(db, 'o1', { name: 'Karim' });
    await writeOrderEntry(db, 'o2', { name: 'Rahim' });
    await writeOrderEntry(db, 'o3', { name: 'Jamal' });
    await recordAuditIntegrityCheck(db, 1000);

    await redactAuditLogEntry(db, id1, 'customer_data_deletion');

    const result = await verifyAuditChain(db, 1000);
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(4); // 3 original + the redaction's own audit_log.redacted entry
  });

  it('a genuinely tampered NON-redacted row is still caught after an unrelated redaction elsewhere in the log', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const id1 = await writeOrderEntry(db, 'o1', { name: 'Karim' });
    const id2 = await writeOrderEntry(db, 'o2', { name: 'Rahim' });
    await recordAuditIntegrityCheck(db, 1000);
    await redactAuditLogEntry(db, id1, 'customer_data_deletion');

    // Tamper with a different, non-redacted row's metadata_json directly.
    raw.prepare(`UPDATE audit_log SET metadata_json = '{"name":"tampered"}' WHERE id = ?`).run(id2);

    const result = await verifyAuditChain(db, 1000);
    expect(result.valid).toBe(false);
  });

  it('redactAuditLogForOrders only touches order rows with matching IDs and non-null metadata, and skips already-redacted rows', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const idA = await writeOrderEntry(db, 'orderA', { name: 'Karim' });
    const idB = await writeOrderEntry(db, 'orderB', { name: 'ShouldNotTouch' });
    const idC = await writeOrderEntry(db, 'orderA', { name: 'SecondEntryForOrderA' });
    await recordAuditIntegrityCheck(db, 1000);

    const result = await redactAuditLogForOrders(db, ['orderA'], 'customer_data_deletion');
    expect(result.redacted).toBe(2);
    expect(result.skipped).toBe(0);

    const a = raw.prepare(`SELECT metadata_json FROM audit_log WHERE id = ?`).get(idA) as any;
    const b = raw.prepare(`SELECT metadata_json FROM audit_log WHERE id = ?`).get(idB) as any;
    const c = raw.prepare(`SELECT metadata_json FROM audit_log WHERE id = ?`).get(idC) as any;
    expect(a.metadata_json).toBeNull();
    expect(b.metadata_json).toContain('ShouldNotTouch');
    expect(c.metadata_json).toBeNull();
  });

  it('the redaction itself is logged as a new, normally chain-verified audit_log entry', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const id = await writeOrderEntry(db, 'o1', { name: 'Karim' });
    await recordAuditIntegrityCheck(db, 1000);
    await redactAuditLogEntry(db, id, 'customer_data_deletion');

    const trail = raw.prepare(`SELECT action, entity_type, entity_id, metadata_json FROM audit_log WHERE action = 'audit_log.redacted'`).get() as any;
    expect(trail).toBeTruthy();
    expect(trail.entity_type).toBe('audit_log');
    expect(trail.entity_id).toBe(id);
    expect(JSON.parse(trail.metadata_json).reason).toBe('customer_data_deletion');

    const result = await verifyAuditChainIncremental(db, 1000);
    expect(result.valid).toBe(true);
  });

  it('customer-deletion.ts wires redactAuditLogForOrders into anonymizeCustomer, collecting order IDs before the phone column is overwritten', () => {
    const src = readFileSync(resolve('./src/lib/customer-deletion.ts'), 'utf8');
    const fn = src.slice(src.indexOf('async function anonymizeCustomer'), src.indexOf('export interface ProcessDeletionsResult'));
    expect(fn).toContain('redactAuditLogForOrders');
    expect(fn.indexOf('SELECT id FROM orders')).toBeLessThan(fn.indexOf('db.batch'));
  });
});
