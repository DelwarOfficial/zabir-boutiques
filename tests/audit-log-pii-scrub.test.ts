import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareAuditLogInsert } from '../src/lib/audit';

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

describe('INV-5: audit_log never persists raw phone/email in metadata or entity_id', () => {
  it('scrubs a phone number embedded in metadata', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const stmt = await prepareAuditLogInsert(db, {
      actorStaffId: null, actorRole: 'owner', action: 'order.create',
      entityType: 'order', entityId: 'ord-1',
      metadata: { customer_phone: '+8801712345678', note: 'call 01812345678 to confirm' },
    });
    await stmt.run();
    const row = raw.prepare(`SELECT metadata_json FROM audit_log WHERE entity_id = 'ord-1'`).get() as any;
    const metadata = JSON.parse(row.metadata_json);
    expect(metadata.customer_phone).toBe('[PHONE]');
    expect(metadata.note).toContain('[PHONE]');
    expect(JSON.stringify(metadata)).not.toMatch(/01[3-9]\d{8}/);
  });

  it('scrubs an email embedded in metadata', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const stmt = await prepareAuditLogInsert(db, {
      actorStaffId: null, actorRole: 'owner', action: 'staff.password.reset',
      entityType: 'staff_user', entityId: 'u1',
      metadata: { target_email: 'owner@example.com' },
    });
    await stmt.run();
    const row = raw.prepare(`SELECT metadata_json FROM audit_log WHERE entity_id = 'u1'`).get() as any;
    expect(JSON.parse(row.metadata_json).target_email).toBe('[EMAIL]');
  });

  it('scrubs a raw phone/email that lands in entity_id itself (e.g. pre-lookup login identifier)', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const stmt = await prepareAuditLogInsert(db, {
      actorStaffId: null, actorRole: null, action: 'staff.login.turnstile_failed',
      entityType: 'staff_session', entityId: '+8801712345678',
    });
    await stmt.run();
    const row = raw.prepare(`SELECT entity_id FROM audit_log WHERE action = 'staff.login.turnstile_failed'`).get() as any;
    expect(row.entity_id).toBe('[PHONE]');
  });

  it('redacts known PII_KEYS fields entirely, not just phone/email pattern matches', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const stmt = await prepareAuditLogInsert(db, {
      actorStaffId: null, actorRole: 'owner', action: 'order.create',
      entityType: 'order', entityId: 'ord-2',
      metadata: { address: '123 Main St, Dhaka', total_paisa: 5000 },
    });
    await stmt.run();
    const row = raw.prepare(`SELECT metadata_json FROM audit_log WHERE entity_id = 'ord-2'`).get() as any;
    const metadata = JSON.parse(row.metadata_json);
    expect(metadata.address).toBe('[REDACTED]');
    expect(metadata.total_paisa).toBe(5000); // non-PII fields untouched
  });
});
