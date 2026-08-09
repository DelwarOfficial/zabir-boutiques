import { describe, it, expect, vi } from 'vitest';
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
  raw.exec(readFileSync(resolve(MIGRATIONS, '0011_master_prompt_v7_gaps.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0052_orders_add_email.sql'), 'utf8'));
  raw.exec(`
    INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, email, created_at, updated_at)
    VALUES ('o1','ORD-1','+8801700000000','N','A',1000,0,0,1000,'cod','created','review','staff_confirmed',0,1000,'customer@example.com','2026-01-01','2026-01-01');
  `);
  return raw;
}

function msg(body: unknown) {
  return { body, ack: vi.fn(), retry: vi.fn() };
}

describe('K-43: order-email consumer is idempotent on redelivery (claim-before-send, record-on-success)', () => {
  it('a redelivered message after a successful send does NOT call sendTransactionalEmail again', async () => {
    vi.resetModules();
    const sendTransactionalEmail = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock('../src/lib/email', () => ({ sendTransactionalEmail, sendAbandonedCartEmail: vi.fn() }));
    const { handleOrderEmailBatch } = await import('../src/queues/consumers');

    const raw = buildDb();
    const env = { DB: new D1Like(raw) as unknown as D1Database };

    const m1 = msg({ orderId: 'o1', emailType: 'order_confirmed' });
    await handleOrderEmailBatch({ messages: [m1] } as any, env as any);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(m1.ack).toHaveBeenCalledTimes(1);

    const row = raw.prepare(`SELECT status FROM email_log WHERE id = 'email:o1:order_confirmed'`).get() as any;
    expect(row.status).toBe('sent');

    // Simulate Cloudflare Queues redelivering the same message (e.g. the
    // Worker died after send but before ack).
    const m2 = msg({ orderId: 'o1', emailType: 'order_confirmed' });
    await handleOrderEmailBatch({ messages: [m2] } as any, env as any);

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1); // still 1 — not resent
    expect(m2.ack).toHaveBeenCalledTimes(1);
  });

  it('a failed send is retried and the claim row stays retryable (not stuck as sent)', async () => {
    vi.resetModules();
    const sendTransactionalEmail = vi.fn().mockResolvedValue({ ok: false, error: 'provider_down' });
    vi.doMock('../src/lib/email', () => ({ sendTransactionalEmail, sendAbandonedCartEmail: vi.fn() }));
    const { handleOrderEmailBatch } = await import('../src/queues/consumers');

    const raw = buildDb();
    const env = { DB: new D1Like(raw) as unknown as D1Database };

    const m = msg({ orderId: 'o1', emailType: 'order_shipped' });
    await handleOrderEmailBatch({ messages: [m] } as any, env as any);

    expect(m.retry).toHaveBeenCalledTimes(1);
    expect(m.ack).not.toHaveBeenCalled();
    const row = raw.prepare(`SELECT status FROM email_log WHERE id = 'email:o1:order_shipped'`).get() as any;
    expect(row.status).toBe('failed');
  });

  it('different email types for the same order get independent claim rows (no cross-type collision)', async () => {
    vi.resetModules();
    const sendTransactionalEmail = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock('../src/lib/email', () => ({ sendTransactionalEmail, sendAbandonedCartEmail: vi.fn() }));
    const { handleOrderEmailBatch } = await import('../src/queues/consumers');

    const raw = buildDb();
    const env = { DB: new D1Like(raw) as unknown as D1Database };

    await handleOrderEmailBatch({ messages: [msg({ orderId: 'o1', emailType: 'order_confirmed' })] } as any, env as any);
    await handleOrderEmailBatch({ messages: [msg({ orderId: 'o1', emailType: 'order_shipped' })] } as any, env as any);

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2);
    const rows = raw.prepare(`SELECT COUNT(*) AS c FROM email_log WHERE order_id = 'o1' AND status = 'sent'`).get() as any;
    expect(rows.c).toBe(2);
  });
});
