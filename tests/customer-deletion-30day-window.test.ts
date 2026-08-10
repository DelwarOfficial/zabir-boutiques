import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scheduleCustomerDeletion, processPendingDeletions } from '../src/lib/customer-deletion';

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
  raw.exec(readFileSync(resolve(MIGRATIONS, '0007_audit_chain.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0011_master_prompt_v7_gaps.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0052_orders_add_email.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0019_cart_activity.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0055_create_pending_deletions.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0056_audit_log_add_redaction.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0057_audit_log_add_redaction_reason.sql'), 'utf8'));
  return raw;
}

const PHONE = '+8801700000000';
const LOCAL = '01700000000';
const HASH = 'deadbeef';

describe('N-12: customer deletion is deferred 30 days, not immediate', () => {
  it('schedules a deletion 30 days out instead of anonymizing immediately', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;

    const { scheduledFor, alreadyScheduled } = await scheduleCustomerDeletion(db, PHONE, LOCAL, HASH, '2026-01-01 00:00:00');
    expect(alreadyScheduled).toBe(false);
    expect(scheduledFor).toBe('2026-01-31 00:00:00');

    const row = raw.prepare(`SELECT status FROM pending_deletions WHERE phone = ?`).get(PHONE) as any;
    expect(row.status).toBe('pending');
  });

  it('a second request for the same phone reuses the existing schedule (idempotent)', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;

    const first = await scheduleCustomerDeletion(db, PHONE, LOCAL, HASH, '2026-01-01 00:00:00');
    const second = await scheduleCustomerDeletion(db, PHONE, LOCAL, HASH, '2026-01-15 00:00:00');
    expect(second.alreadyScheduled).toBe(true);
    expect(second.scheduledFor).toBe(first.scheduledFor);

    const count = raw.prepare(`SELECT COUNT(*) AS c FROM pending_deletions WHERE phone = ?`).get(PHONE) as any;
    expect(count.c).toBe(1);
  });

  it('processPendingDeletions does nothing before the 30 days elapse', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    await scheduleCustomerDeletion(db, PHONE, LOCAL, HASH, '2026-01-01 00:00:00');

    const result = await processPendingDeletions(db, '2026-01-15 00:00:00'); // only 14 days in
    expect(result.processed).toBe(0);
    expect(result.completed).toBe(0);

    const order = raw.prepare(`SELECT phone FROM orders WHERE phone = ? OR phone = ?`).all(PHONE, PHONE);
    expect(true).toBe(true); // no orders seeded; this just proves no crash pre-window
  });

  it('anonymizes once the window elapses and no hold exists', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
      VALUES ('o1','ORD-1','${PHONE}','Real Name','Real Address',1000,0,0,1000,'cod','paid','approved','delivered',0,0,'2026-01-01','2026-01-01');
    `);
    const db = new D1Like(raw) as unknown as D1Database;
    await scheduleCustomerDeletion(db, PHONE, LOCAL, HASH, '2026-01-01 00:00:00');

    const result = await processPendingDeletions(db, '2026-01-31 00:00:00'); // exactly 30 days
    expect(result.completed).toBe(1);
    expect(result.held).toBe(0);

    const order = raw.prepare(`SELECT name, address, phone FROM orders WHERE id = 'o1'`).get() as any;
    expect(order.name).not.toBe('Real Name');
    expect(order.address).not.toBe('Real Address');
    expect(order.phone).not.toBe(PHONE);

    const record = raw.prepare(`SELECT status FROM pending_deletions WHERE phone_hash = ?`).get(HASH) as any;
    expect(record.status).toBe('completed');
  });

  it('holds (does not anonymize) when the customer has an open order at the 30-day mark', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
      VALUES ('o1','ORD-1','${PHONE}','Real Name','Real Address',1000,0,0,1000,'cod','created','review','pending_review',0,1000,'2026-01-01','2026-01-01');
    `);
    const db = new D1Like(raw) as unknown as D1Database;
    await scheduleCustomerDeletion(db, PHONE, LOCAL, HASH, '2026-01-01 00:00:00');

    const result = await processPendingDeletions(db, '2026-01-31 00:00:00');
    expect(result.completed).toBe(0);
    expect(result.held).toBe(1);

    const order = raw.prepare(`SELECT name FROM orders WHERE id = 'o1'`).get() as any;
    expect(order.name).toBe('Real Name'); // NOT anonymized while order is open

    const record = raw.prepare(`SELECT status, hold_reason FROM pending_deletions WHERE phone_hash = ?`).get(HASH) as any;
    expect(record.status).toBe('held');
    expect(record.hold_reason).toBe('open_order');
  });

  it('a previously-held deletion completes automatically once the hold clears (order delivered)', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
      VALUES ('o1','ORD-1','${PHONE}','Real Name','Real Address',1000,0,0,1000,'cod','created','review','pending_review',0,1000,'2026-01-01','2026-01-01');
    `);
    const db = new D1Like(raw) as unknown as D1Database;
    await scheduleCustomerDeletion(db, PHONE, LOCAL, HASH, '2026-01-01 00:00:00');
    await processPendingDeletions(db, '2026-01-31 00:00:00'); // held

    // Order is now delivered — hold should clear on the next pass.
    raw.exec(`UPDATE orders SET status = 'delivered' WHERE id = 'o1'`);
    const result = await processPendingDeletions(db, '2026-02-01 00:00:00');
    expect(result.completed).toBe(1);

    const order = raw.prepare(`SELECT name FROM orders WHERE id = 'o1'`).get() as any;
    expect(order.name).not.toBe('Real Name');
  });

  it('a fraud-blocked order also holds the deletion', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
      VALUES ('o1','ORD-1','${PHONE}','Real Name','Real Address',1000,0,0,1000,'cod','created','blocked','cancelled',0,1000,'2026-01-01','2026-01-01');
    `);
    const db = new D1Like(raw) as unknown as D1Database;
    await scheduleCustomerDeletion(db, PHONE, LOCAL, HASH, '2026-01-01 00:00:00');

    const result = await processPendingDeletions(db, '2026-01-31 00:00:00');
    expect(result.held).toBe(1);
    const record = raw.prepare(`SELECT hold_reason FROM pending_deletions WHERE phone_hash = ?`).get(HASH) as any;
    expect(record.hold_reason).toBe('fraud_blocked_order');
  });
});

describe('N-12: /api/me/delete route schedules instead of immediately anonymizing', () => {
  it('no longer contains the immediate UPDATE orders SET ... anonymization inline', () => {
    const src = readFileSync(resolve('./src/pages/api/me/delete.ts'), 'utf8');
    expect(src).not.toContain('UPDATE orders SET name');
    expect(src).toContain('scheduleCustomerDeletion(');
  });

  it('cron-dispatch.ts wires processPendingDeletions into the daily job', () => {
    const src = readFileSync(resolve('./src/lib/cron-dispatch.ts'), 'utf8');
    expect(src).toContain("import('./customer-deletion')");
    expect(src).toContain('processPendingDeletions(env.DB');
  });
});
