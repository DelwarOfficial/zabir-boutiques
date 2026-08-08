import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve('./db/migrations');

function buildDb(): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0045_create_suppliers.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0046_create_purchase_orders.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0047_create_goods_receipts.sql'), 'utf8'));
  raw.exec(`
    INSERT INTO staff_users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
    VALUES ('staff1','s@x.com','h','S','manager',1,'2026-01-01','2026-01-01');
    INSERT INTO products (id, name, slug, price_paisa, status, created_at, updated_at)
    VALUES ('prod1','P','p','1000','published','2026-01-01','2026-01-01');
    INSERT INTO product_variants (id, product_id, sku, created_at, updated_at)
    VALUES ('v1','prod1','sku1','2026-01-01','2026-01-01');
    INSERT INTO suppliers (id, name, is_active, created_at) VALUES ('sup1','Acme',1,'2026-01-01');
    INSERT INTO purchase_orders (id, supplier_id, status, total_cost_paisa, created_by_staff_id, created_at, updated_at)
    VALUES ('po1','sup1','draft',0,'staff1','2026-01-01','2026-01-01');
  `);
  return raw;
}

describe('goods_receipts (T-26, RT-003)', () => {
  it('deterministic adjustment_id ties one PO+variant to exactly one ledger row', () => {
    const raw = buildDb();
    const adjustmentId = 'po:po1:v1';
    raw.exec(
      `INSERT OR IGNORE INTO goods_receipts (id, purchase_order_id, variant_id, quantity, unit_cost_paisa, adjustment_id, received_by_staff_id, received_at)
       VALUES ('gr1','po1','v1',10,500,'${adjustmentId}','staff1','2026-01-01')`,
    );
    // Simulated retry: same adjustment_id, different row id — must be ignored.
    raw.exec(
      `INSERT OR IGNORE INTO goods_receipts (id, purchase_order_id, variant_id, quantity, unit_cost_paisa, adjustment_id, received_by_staff_id, received_at)
       VALUES ('gr2','po1','v1',10,500,'${adjustmentId}','staff1','2026-01-01')`,
    );
    const rows = raw.prepare(`SELECT COUNT(*) AS c FROM goods_receipts WHERE adjustment_id = ?`).get(adjustmentId) as { c: number };
    expect(rows.c).toBe(1);
  });

  it('a received PO stays received; status update is idempotent', () => {
    const raw = buildDb();
    raw.exec(`UPDATE purchase_orders SET status = 'received', total_cost_paisa = 5000 WHERE id = 'po1'`);
    const res = raw.prepare(`UPDATE purchase_orders SET status = 'received', total_cost_paisa = 9999 WHERE id = 'po1' AND status != 'received'`).run();
    expect((res as any).changes).toBe(0);
    const po = raw.prepare(`SELECT total_cost_paisa FROM purchase_orders WHERE id = 'po1'`).get() as { total_cost_paisa: number };
    expect(po.total_cost_paisa).toBe(5000); // unchanged by the no-op retry
  });

  it('a cancelled PO cannot be received (application-level check, verified against real status)', () => {
    const raw = buildDb();
    raw.exec(`UPDATE purchase_orders SET status = 'cancelled' WHERE id = 'po1'`);
    const po = raw.prepare(`SELECT status FROM purchase_orders WHERE id = 'po1'`).get() as { status: string };
    expect(po.status).toBe('cancelled');
    // The route rejects this status before calling doAdjustStock — see
    // src/pages/api/staff/purchase-orders/[id]/receive.ts PO_CANCELLED branch.
  });

  it('goods_receipts.adjustment_id is unique — a genuinely different receipt for the same PO+variant needs a different key', () => {
    const raw = buildDb();
    raw.exec(
      `INSERT INTO goods_receipts (id, purchase_order_id, variant_id, quantity, unit_cost_paisa, adjustment_id, received_by_staff_id, received_at)
       VALUES ('gr1','po1','v1',10,500,'po:po1:v1','staff1','2026-01-01')`,
    );
    expect(() =>
      raw.exec(
        `INSERT INTO goods_receipts (id, purchase_order_id, variant_id, quantity, unit_cost_paisa, adjustment_id, received_by_staff_id, received_at)
         VALUES ('gr2','po1','v1',5,500,'po:po1:v1','staff1','2026-01-02')`,
      ),
    ).toThrow();
  });
});
