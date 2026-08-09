import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { recordWebhookReceipt } from '../src/lib/payment-webhook-ingress';

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
  raw.exec(readFileSync(resolve(MIGRATIONS, '0050_payment_events_provider_event_id.sql'), 'utf8'));
  raw.exec(`
    INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
    VALUES ('o1','ORD-1','+8801700000000','N','A',1000,0,0,1000,'uddoktapay','created','review','pending_review',0,1000,'2026-01-01','2026-01-01');
    INSERT INTO payments (id, order_id, invoice_id, provider, amount_paisa, status, created_at, updated_at)
    VALUES ('p1','o1','inv1','uddoktapay',1000,'pending','2026-01-01','2026-01-01');
  `);
  return raw;
}

describe('N-16/INV-2: payment_events dedup is (provider, provider_event_id), not (invoice_id, event_type, status)', () => {
  it('a genuine replay (same event id) is rejected as duplicate', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const r1 = await recordWebhookReceipt(db, { eventId: 'evt-1', invoiceId: 'inv1', rawBody: '{}', now: '2026-01-01 00:00:00' });
    const r2 = await recordWebhookReceipt(db, { eventId: 'evt-1', invoiceId: 'inv1', rawBody: '{}', now: '2026-01-01 00:01:00' });
    expect(r1).toBe('recorded');
    expect(r2).toBe('duplicate');
  });

  it('a second GENUINE event for the same invoice (different provider event id) is no longer silently dropped', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const r1 = await recordWebhookReceipt(db, { eventId: 'evt-1', invoiceId: 'inv1', rawBody: '{}', now: '2026-01-01 00:00:00' });
    const r2 = await recordWebhookReceipt(db, { eventId: 'evt-2', invoiceId: 'inv1', rawBody: '{}', now: '2026-01-01 00:01:00' });
    expect(r1).toBe('recorded');
    expect(r2).toBe('recorded'); // old (invoice_id, event_type, status) UNIQUE would have blocked this
  });

  it('payment_events rows carry provider and provider_event_id', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    await recordWebhookReceipt(db, { eventId: 'evt-1', invoiceId: 'inv1', rawBody: '{}', now: '2026-01-01 00:00:00' });
    const row = raw.prepare(`SELECT provider, provider_event_id FROM payment_events WHERE id = 'evt-1'`).get() as any;
    expect(row.provider).toBe('uddoktapay');
    expect(row.provider_event_id).toBe('evt-1');
  });
});
