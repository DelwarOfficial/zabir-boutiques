import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkDoD1Parity, restoreParity } from '../src/lib/maintenance/dr-parity';

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

// N-2 Case A: real object IDs are `variant:{id}`, not the raw variant ID.
// idFromName is still effectively identity here (this fake namespace
// doesn't model real DO addressing), but strip the prefix before indexing
// `state` so the fake continues to track by the logical variant ID the
// same way VariantInventoryDO's own ensureInitialized() does (keyed on
// the variantId in the request body, independent of the object-ID string).
function logicalVariantId(objectKey: string): string {
  return objectKey.startsWith('variant:') ? objectKey.slice('variant:'.length) : objectKey;
}

/** In-memory fake VariantInventoryDO namespace: variantId -> {stock,reserved,sold}. */
function fakeDoNamespace(initial: Record<string, { stock: number; reserved: number; sold: number }>) {
  const state = { ...initial };
  const ns = {
    idFromName: (objectKey: string) => objectKey,
    get: (objectKey: string) => ({
      fetch: async (url: string, init?: { body?: string }) => {
        const variantId = logicalVariantId(objectKey);
        if (url.includes('/availability')) {
          const s = state[variantId] ?? { stock: 0, reserved: 0, sold: 0 };
          return new Response(JSON.stringify({ ok: true, stock: s.stock, reserved: s.reserved, sold: s.sold, available: s.stock - s.reserved - s.sold }));
        }
        if (url.includes('/sync')) {
          const body = JSON.parse(init?.body ?? '{}');
          state[variantId] = { stock: body.stock, reserved: body.reserved, sold: body.sold };
          return new Response(JSON.stringify({ ok: true }));
        }
        return new Response(JSON.stringify({ ok: false }), { status: 400 });
      },
    }),
  };
  return { ns, state };
}

function buildDb(): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0017_variants_stock_generated.sql'), 'utf8'));
  raw.exec(`
    INSERT INTO products (id, name, slug, price_paisa, status, created_at, updated_at)
    VALUES ('prod1','P','p','1000','published','2026-01-01','2026-01-01');
    INSERT INTO product_variants (id, product_id, sku, is_deleted, created_at, updated_at)
    VALUES ('v1','prod1','sku1',0,'2026-01-01','2026-01-01'),
           ('v2','prod1','sku2',0,'2026-01-01','2026-01-01');
    INSERT INTO inventory_items (id, variant_id, quantity, reserved_quantity, sold_quantity, is_available, updated_at)
    VALUES ('ii1','v1',100,10,5,1,'2026-01-01'),
           ('ii2','v2',50,2,0,1,'2026-01-01');
  `);
  return raw;
}

describe('DO/D1 inventory parity (T-28, dr-do-d1-parity)', () => {
  it('refuses to run and reports zero mismatches when the DO is not bound (avoids a false clean bill of health)', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const result = await checkDoD1Parity({ DB: db });
    expect(result).toEqual({ checked: 0, mismatches: [] });
  });

  it('detects a variant where DO state has drifted from D1', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const { ns } = fakeDoNamespace({
      v1: { stock: 100, reserved: 10, sold: 5 }, // matches D1
      v2: { stock: 999, reserved: 2, sold: 0 },  // drifted — stale DO after a D1 restore
    });

    const result = await checkDoD1Parity({ DB: db, VARIANT_INVENTORY_DO: ns as unknown as DurableObjectNamespace });

    expect(result.checked).toBe(2);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].variantId).toBe('v2');
    expect(result.mismatches[0].do.stock).toBe(999);
    expect(result.mismatches[0].d1.stock).toBe(50);
  });

  it('writes a low_stock_alerts row for each mismatch, does not auto-correct', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const { ns } = fakeDoNamespace({
      v1: { stock: 100, reserved: 10, sold: 5 },
      v2: { stock: 999, reserved: 2, sold: 0 },
    });

    await checkDoD1Parity({ DB: db, VARIANT_INVENTORY_DO: ns as unknown as DurableObjectNamespace });

    const alert = raw.prepare(`SELECT variant_id, message FROM low_stock_alerts WHERE variant_id = 'v2'`).get() as any;
    expect(alert).toBeTruthy();
    expect(alert.message).toContain('parity mismatch');

    // D1 was not touched by the read-only check.
    const d1Row = raw.prepare(`SELECT quantity FROM inventory_items WHERE variant_id = 'v2'`).get() as any;
    expect(d1Row.quantity).toBe(50);
  });

  it('restoreParity forces DO state to match D1 (the actual recovery action)', async () => {
    const raw = buildDb();
    const db = new D1Like(raw) as unknown as D1Database;
    const { ns, state } = fakeDoNamespace({
      v1: { stock: 100, reserved: 10, sold: 5 },
      v2: { stock: 999, reserved: 2, sold: 0 }, // stale, pre-restore DO state
    });

    const result = await restoreParity({ DB: db, VARIANT_INVENTORY_DO: ns as unknown as DurableObjectNamespace });

    expect(result.restored).toBe(2);
    expect(state.v2).toEqual({ stock: 50, reserved: 2, sold: 0 }); // now matches D1

    // Parity check now passes clean.
    const after = await checkDoD1Parity({ DB: db, VARIANT_INVENTORY_DO: ns as unknown as DurableObjectNamespace });
    expect(after.mismatches).toHaveLength(0);
  });

  it('does not report a mismatch for a variant with no inventory_items row at all', async () => {
    const raw = buildDb();
    raw.exec(`INSERT INTO product_variants (id, product_id, sku, is_deleted, created_at, updated_at) VALUES ('v3','prod1','sku3',0,'2026-01-01','2026-01-01');`);
    const db = new D1Like(raw) as unknown as D1Database;
    const { ns } = fakeDoNamespace({ v1: { stock: 100, reserved: 10, sold: 5 }, v2: { stock: 50, reserved: 2, sold: 0 } });

    const result = await checkDoD1Parity({ DB: db, VARIANT_INVENTORY_DO: ns as unknown as DurableObjectNamespace });
    expect(result.checked).toBe(2); // v3 skipped, not counted, not flagged
    expect(result.mismatches).toHaveLength(0);
  });
});
