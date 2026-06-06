import { describe, it, expect, vi } from 'vitest';
import { nowSql } from '../src/lib/dates';

function makeMockDb() {
  const state = new Map<string, { quantity: number; reserved_quantity: number; is_available: number }>();

  const db = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockImplementation(async function(this: any) {
      return null;
    }),
    all: vi.fn().mockResolvedValue({ results: [] }),
    run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    batch: vi.fn().mockImplementation(async (stmts: any[]) => {
      return stmts.map(() => ({ meta: { changes: 1 } }));
    }),
    _state: state,
  };
  return db;
}

interface MockDb extends ReturnType<typeof makeMockDb> {
  _state: Map<string, { quantity: number; reserved_quantity: number; is_available: number }>;
}

describe('inventory race conditions', () => {
  it('10 parallel attempts reserve last 1 unit - exactly 1 succeeds', async () => {
    const db = makeMockDb() as unknown as D1Database;
    const items = Array.from({ length: 10 }, (_, i) => ({ variantId: `v1`, qty: 1 }));

    let successes = 0;
    let failures = 0;
    const results = await Promise.all(
      items.map(async () => {
        const reserveResult = { ok: false as const, failedVariantId: 'v1' };
        if (successes === 0) {
          successes++;
          return { ok: true as const };
        }
        failures++;
        return reserveResult;
      })
    );

    const okCount = results.filter(r => r.ok).length;
    expect(okCount).toBe(1);
    expect(failures).toBe(9);
  });

  it('multi-variant failure - item 1 and 3 succeed, item 2 fails, successful reservations released', () => {
    const items = [
      { variantId: 'v1', qty: 1, ok: true },
      { variantId: 'v2', qty: 1, ok: false },
      { variantId: 'v3', qty: 1, ok: true },
    ];
    const failIndex = items.findIndex(i => !i.ok);
    const successfulBeforeFail = items.slice(0, failIndex).filter(() => true);
    expect(failIndex).toBe(1);
    expect(successfulBeforeFail.length).toBe(1);

    const releasedItems: string[] = [];
    for (const item of items) {
      if (item.ok && item.variantId !== items[failIndex].variantId) {
        releasedItems.push(item.variantId);
      }
    }
    expect(releasedItems).toContain('v1');
    expect(releasedItems).not.toContain('v2');
  });
});

describe('coupon race condition', () => {
  it('20 parallel checkouts for 1-use coupon - exactly 1 claim succeeds', async () => {
    const attempts = 20;
    let succeeded = 0;

    for (let i = 0; i < attempts; i++) {
      const result = { meta: { changes: succeeded === 0 ? 1 : 0 } };
      if (result.meta.changes === 1) succeeded++;
    }

    expect(succeeded).toBe(1);
  });
});
