import { describe, it, expect, vi } from 'vitest';
import { VariantInventoryDO } from '../src/do/variant-inventory-do';

function makeMockState() {
  const storage = new Map<string, unknown>();
  return {
    storage: {
      get: vi.fn(async (k: string) => storage.get(k)),
      put: vi.fn(async (a: Record<string, unknown> | string, b?: unknown) => {
        if (typeof a === 'string') storage.set(a, b);
        else for (const [k, v] of Object.entries(a)) storage.set(k, v);
      }),
      setAlarm: vi.fn(async () => {}),
      delete: vi.fn(async (k: string) => storage.delete(k)),
    },
  } as unknown as DurableObjectState;
}

function makeMockDb() {
  const calls: Array<{ kind: string; count?: number }> = [];
  const db = {
    _calls: calls,
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({ quantity: 100, reserved_quantity: 0, sold_quantity: 0 })),
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
      })),
    })),
    batch: vi.fn(async (stmts: unknown[]) => {
      calls.push({ kind: 'batch', count: stmts.length });
      return stmts.map(() => ({ meta: { changes: 1 } }));
    }),
  };
  return db as unknown as (D1Database & { _calls: typeof calls });
}

function newDo(db: D1Database) {
  return new VariantInventoryDO(makeMockState(), { DB: db });
}

function makeFailingMockDb() {
  const calls: Array<{ kind: string; count?: number }> = [];
  const db = {
    _calls: calls,
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({ quantity: 100, reserved_quantity: 0, sold_quantity: 0 })),
        run: vi.fn(async () => ({ meta: { changes: 0 } })),
      })),
    })),
    batch: vi.fn(async (stmts: unknown[]) => {
      calls.push({ kind: 'batch', count: stmts.length });
      return stmts.map(() => ({ meta: { changes: 0 } }));
    }),
  };
  return db as unknown as (D1Database & { _calls: typeof calls });
}

function post(action: string, body: Record<string, unknown>) {
  return new Request(`https://do/${action}`, { method: 'POST', body: JSON.stringify(body) });
}

describe('DO-1: VariantInventoryDO uses real binding (this.env), not body.env', () => {
  it('directSale writes to D1 via this.env.DB', async () => {
    const db = makeMockDb();
    const do1 = newDo(db);
    const res = await do1.fetch(post('directSale', { qty: 2, variantId: 'v1', invoiceId: 'inv1', staffId: 's1', channel: 'pos' }));
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(db.batch).toHaveBeenCalledTimes(1);
  });

  it('adjustStock writes to D1 via this.env.DB', async () => {
    const db = makeMockDb();
    const do1 = newDo(db);
    const res = await do1.fetch(post('adjustStock', { stock: 5, variantId: 'v1', reason: 'restock', staffId: 's1' }));
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(db.batch).toHaveBeenCalledTimes(1);
  });

  it('reverseDirectSale writes to D1 via this.env.DB on first call only', async () => {
    const db = makeMockDb();
    const do1 = newDo(db);
    const first = await do1.fetch(post('reverseDirectSale', { qty: 1, variantId: 'v1', invoiceId: 'inv1', reason: 'correction' }));
    const firstData = await first.json() as any;
    expect(firstData.reversed).toBe(true);
    expect(db.batch).toHaveBeenCalledTimes(1);

    // Replay: must be idempotent and must NOT touch D1 again.
    const second = await do1.fetch(post('reverseDirectSale', { qty: 1, variantId: 'v1', invoiceId: 'inv1', reason: 'correction' }));
    const secondData = await second.json() as any;
    expect(secondData.reversed).toBe(false);
    expect(secondData.message).toBe('already_reversed');
    expect(db.batch).toHaveBeenCalledTimes(1);
  });

  it('forged body.env is ignored (attacker cannot inject a DB binding)', async () => {
    const db = makeMockDb();
    const do1 = newDo(db);
    const res = await do1.fetch(post('directSale', {
      qty: 1, variantId: 'v1', invoiceId: 'inv1', staffId: 's1', channel: 'pos',
      env: { DB: 'ATTACKER_CONTROLLED' },
    }));
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    // The real mock db.batch was used, proving body.env was discarded.
    expect(db.batch).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid qty with 400', async () => {
    const db = makeMockDb();
    const do1 = newDo(db);
    const res = await do1.fetch(post('reserve', { qty: -5, variantId: 'v1' }));
    const data = await res.json() as any;
    expect(res.status).toBe(400);
    expect(data.error).toBe('INVALID_QTY');
  });

  it('rejects unknown action with 400', async () => {
    const db = makeMockDb();
    const do1 = newDo(db);
    const res = await do1.fetch(post('launchMissiles', { qty: 1 }));
    expect(res.status).toBe(400);
  });

  it('directSale returns CONFLICT when D1 guard rejects the write (no oversell)', async () => {
    const db = makeFailingMockDb();
    const do1 = newDo(db);
    const res = await do1.fetch(post('directSale', { qty: 2, variantId: 'v1', invoiceId: 'inv1', staffId: 's1', channel: 'pos' }));
    const data = await res.json() as any;
    expect(data.ok).toBe(false);
    expect(data.error).toBe('CONFLICT');
    const avail = await do1.fetch(post('availability', { variantId: 'v1' }));
    const availData = await avail.json() as any;
    expect(availData.sold).toBe(0);
  });

  it('adjustStock returns error when D1 guard rejects the write (state not mutated)', async () => {
    const db = makeFailingMockDb();
    const do1 = newDo(db);
    const res = await do1.fetch(post('adjustStock', { stock: 5, variantId: 'v1', reason: 'restock', staffId: 's1' }));
    const data = await res.json() as any;
    expect(data.ok).toBe(false);
    expect(data.error).toBe('STOCK_UPDATE_FAILED');
    const avail = await do1.fetch(post('availability', { variantId: 'v1' }));
    const availData = await avail.json() as any;
    expect(availData.stock).toBe(100);
  });
});
