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
  raw.exec(readFileSync(resolve(MIGRATIONS, '0017_variants_stock_generated.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0026_add_checkout_vat_paisa.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0062_payments_transaction_fields.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0063_payments_payment_method.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0064_payments_refunded_amount.sql'), 'utf8'));
  raw.exec(`
    INSERT INTO products (id, name, slug, price_paisa, status, created_at, updated_at)
    VALUES ('prod1','P','p','1000','published','2026-01-01','2026-01-01');
    INSERT INTO product_variants (id, product_id, sku, is_deleted, created_at, updated_at)
    VALUES ('v1','prod1','sku1',0,'2026-01-01','2026-01-01');
    INSERT INTO staff_users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
    VALUES ('staff1','staff1@zabir.local','x','Staff One','manager',1,'2026-01-01','2026-01-01');
  `);
  return raw;
}

function ctx(id: string, body: unknown = {}) {
  return {
    params: { id },
    request: new Request(`https://x/api/staff/orders/${id}/cancel`, { method: 'POST', body: JSON.stringify(body) }),
    locals: { runtime: { env: {} as any } },
  } as unknown as import('astro').APIContext;
}

vi.mock('../src/lib/env', () => ({ getEnv: (c: any) => c.locals.runtime.env }));
vi.mock('../src/lib/rbac', () => ({
  requireAuth: async () => ({ id: 'staff1', role: 'manager' }),
  requirePermission: () => {},
  RbacError: class extends Error { toResponse() { return new Response('', { status: 403 }); } },
}));
vi.mock('../src/lib/critical-auth', () => ({
  requireRecentStaffSession: async () => {},
  CriticalAuthError: class extends Error { toResponse() { return new Response('', { status: 403 }); } },
}));
vi.mock('../src/lib/audit', () => ({
  prepareAuditLogInsert: async () => ({ run: async () => {} }),
  clientIp: () => null,
  userAgent: () => null,
}));
vi.mock('../src/lib/payments', () => ({ verifyUddoktaPayment: vi.fn() }));
vi.mock('../src/lib/integrations/uddoktapay', () => ({
  UddoktaPayClient: class { async refundPayment() { return { ok: true }; } },
}));

import { POST } from '../src/pages/api/staff/orders/[id]/cancel';

describe('K-38: POST /api/staff/orders/[id]/cancel', () => {
  it('releases an active reservation for an order still in pending_review (no sale yet)', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO inventory_items (id, variant_id, quantity, reserved_quantity, sold_quantity, is_available, updated_at)
      VALUES ('ii1','v1',10,2,0,1,'2026-01-01');
      INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
      VALUES ('o1','ORD-1','+8801700000000','N','A',1000,0,0,1000,'cod','created','review','pending_review',0,1000,'2026-01-01','2026-01-01');
      INSERT INTO stock_reservations (id, order_id, variant_id, quantity, status, expires_at, created_at, updated_at)
      VALUES ('res1','o1','v1',2,'active','2099-01-01','2026-01-01','2026-01-01');
    `);
    const env = { DB: new D1Like(raw) as unknown as D1Database };
    const req = ctx('o1');
    (req as any).locals.runtime.env = env;

    const res = await POST(req);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.status).toBe('cancelled');

    const inv = raw.prepare('SELECT reserved_quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    expect(inv.reserved_quantity).toBe(0);
    const order = raw.prepare('SELECT status FROM orders WHERE id = ?').get('o1') as any;
    expect(order.status).toBe('cancelled');
    const resv = raw.prepare(`SELECT status FROM stock_reservations WHERE id = 'res1'`).get() as any;
    expect(resv.status).toBe('released');
  });

  it('reverses the sale (reverseConfirm) for an order already staff_confirmed', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO inventory_items (id, variant_id, quantity, reserved_quantity, sold_quantity, is_available, updated_at)
      VALUES ('ii1','v1',10,0,2,1,'2026-01-01');
      INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
      VALUES ('o1','ORD-1','+8801700000000','N','A',1000,0,0,1000,'cod','created','review','staff_confirmed',0,1000,'2026-01-01','2026-01-01');
      INSERT INTO order_items (id, order_id, variant_id, product_name, variant_label, quantity, unit_price_paisa, total_price_paisa, vat_paisa, created_at)
      VALUES ('oi1','o1','v1','P','sku1',2,500,1000,0,'2026-01-01');
    `);
    const env = { DB: new D1Like(raw) as unknown as D1Database };
    const req = ctx('o1');
    (req as any).locals.runtime.env = env;

    const res = await POST(req);
    const data = await res.json();
    expect(data.ok).toBe(true);

    const inv = raw.prepare('SELECT quantity, sold_quantity FROM inventory_items WHERE variant_id = ?').get('v1') as any;
    expect(inv.quantity).toBe(10); // stock invariant untouched
    expect(inv.sold_quantity).toBe(0);
  });

  it('rejects cancelling a terminal (already refunded) order', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
      VALUES ('o1','ORD-1','+8801700000000','N','A',1000,0,0,1000,'cod','refunded','review','refunded',0,1000,'2026-01-01','2026-01-01');
    `);
    const env = { DB: new D1Like(raw) as unknown as D1Database };
    const req = ctx('o1');
    (req as any).locals.runtime.env = env;

    const res = await POST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe('INVALID_TRANSITION');
  });

  it('is idempotent: cancelling an already-cancelled order is a no-op success', async () => {
    const raw = buildDb();
    raw.exec(`
      INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
      VALUES ('o1','ORD-1','+8801700000000','N','A',1000,0,0,1000,'cod','cancelled','review','cancelled',0,1000,'2026-01-01','2026-01-01');
    `);
    const env = { DB: new D1Like(raw) as unknown as D1Database };
    const req = ctx('o1');
    (req as any).locals.runtime.env = env;

    const res = await POST(req);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.alreadyCancelled).toBe(true);
  });

  it('refunds a paid order and marks payment refunded', async () => {
    const { verifyUddoktaPayment } = await import('../src/lib/payments');
    (verifyUddoktaPayment as any).mockResolvedValue({ status: 'paid', transactionId: 'TRX1', paymentMethod: 'bkash' });

    const raw = buildDb();
    raw.exec(`
      INSERT INTO inventory_items (id, variant_id, quantity, reserved_quantity, sold_quantity, is_available, updated_at)
      VALUES ('ii1','v1',10,2,0,1,'2026-01-01');
      INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, advance_paisa, balance_paisa, created_at, updated_at)
      VALUES ('o1','ORD-1','+8801700000000','N','A',1000,0,0,1000,'uddoktapay','paid','review','payment_verified',1000,0,'2026-01-01','2026-01-01');
      INSERT INTO payments (id, order_id, invoice_id, provider, amount_paisa, status, transaction_id, provider_payment_method, created_at, updated_at)
      VALUES ('p1','o1','inv1','uddoktapay',1000,'paid','TRX1','bkash','2026-01-01','2026-01-01');
      INSERT INTO stock_reservations (id, order_id, variant_id, quantity, status, expires_at, created_at, updated_at)
      VALUES ('res1','o1','v1',2,'active','2099-01-01','2026-01-01','2026-01-01');
    `);
    const env = { DB: new D1Like(raw) as unknown as D1Database, UDDOKTAPAY_API_KEY: 'k', UDDOKTAPAY_BASE_URL: 'https://x' };
    const req = ctx('o1');
    (req as any).locals.runtime.env = env;

    const res = await POST(req);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.refund_paisa).toBe(1000);

    const payment = raw.prepare(`SELECT status FROM payments WHERE id = 'p1'`).get() as any;
    expect(payment.status).toBe('refunded');
    const order = raw.prepare(`SELECT payment_status FROM orders WHERE id = 'o1'`).get() as any;
    expect(order.payment_status).toBe('refunded');
  });
});
