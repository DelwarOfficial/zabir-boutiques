import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanExpiredReservations, confirmReservedVariants, releaseReservedVariants, reserveVariants, type ReservableItem } from '../src/lib/inventory';

type Prepared = {
  sql: string;
  values: unknown[];
  bind: (...values: unknown[]) => Prepared;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<{ meta: { changes: number } }>;
};

function createDb(options: {
  allResults?: unknown[];
  batchResults?: Array<Array<{ meta: { changes: number } }>>;
}) {
  const prepared: Prepared[] = [];
  const batchCalls: Prepared[][] = [];
  const queue = [...(options.batchResults ?? [])];
  const db = {
    prepared,
    batchCalls,
    prepare(sql: string): Prepared {
      const stmt: Prepared = {
        sql,
        values: [],
        bind(...values: unknown[]) {
          stmt.values = values;
          return stmt;
        },
        async first<T>() {
          return null as T | null;
        },
        async all<T>() {
          return { results: (options.allResults ?? []) as T[] };
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
      prepared.push(stmt);
      return stmt;
    },
    async batch(stmts: Prepared[]) {
      batchCalls.push(stmts);
      return queue.shift() ?? stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return db as unknown as D1Database & { prepared: Prepared[]; batchCalls: Prepared[][] };
}

describe('reservation lifecycle', () => {
  it('assigns reservation IDs during reserve so order insertion can reuse them', async () => {
    const db = createDb({});
    const items: ReservableItem[] = [{ variantId: 'v1', qty: 2 }];

    const result = await reserveVariants({ DB: db }, items, '2026-06-19 05:00:00');

    expect(result.ok).toBe(true);
    expect(items[0].reservationId).toBeTypeOf('string');
    if (result.ok) {
      expect(result.reservations[0].reservationId).toBe(items[0].reservationId);
    }
  });

  it('marks stock_reservations released and confirmed by reservation ID', async () => {
    const releaseDb = createDb({});
    const confirmDb = createDb({});
    const items: ReservableItem[] = [{ variantId: 'v1', qty: 1, reservationId: 'res-1' }];

    await releaseReservedVariants({ DB: releaseDb }, items, '2026-06-19 05:00:00');
    await confirmReservedVariants({ DB: confirmDb }, items, '2026-06-19 05:00:00');

    const releaseSql = releaseDb.batchCalls[0].map((stmt) => stmt.sql).join('\n');
    const confirmSql = confirmDb.batchCalls[0].map((stmt) => stmt.sql).join('\n');
    expect(releaseSql).toContain("UPDATE stock_reservations");
    expect(releaseSql).toContain("status = 'released'");
    expect(confirmSql).toContain("UPDATE stock_reservations");
    expect(confirmSql).toContain("status = 'confirmed'");
  });

  it('cleanup claims with release_requested_at stamp before releasing claimed rows', async () => {
    const db = createDb({
      allResults: [
        { id: 'res-1', variant_id: 'v1', quantity: 1 },
        { id: 'res-2', variant_id: 'v2', quantity: 1 },
      ],
      batchResults: [
        [{ meta: { changes: 1 } }, { meta: { changes: 0 } }],
        [{ meta: { changes: 1 } }, { meta: { changes: 1 } }],
      ],
    });

    await cleanExpiredReservations({ DB: db }, 10);

    const claimSql = db.batchCalls[0].map((stmt) => stmt.sql).join('\n');
    const releaseSql = db.batchCalls[1].map((stmt) => stmt.sql).join('\n');
    expect(claimSql).toContain("release_requested_at IS NULL");
    expect(claimSql).toContain("status = 'release_requested'");
    expect(db.batchCalls[1][0].values[1]).toBe('v1');
    expect(releaseSql).toContain("status = 'released'");
  });

  it('uses per-variant active uniqueness in reservation migrations', () => {
    const migration0024 = readFileSync('db/migrations/0024_stock_reservations_unique_constraint.sql', 'utf8');
    const migration0027 = readFileSync('db/migrations/0027_stock_reservations_status_rebuild.sql', 'utf8');
    const migration0028 = readFileSync('db/migrations/0028_fix_stock_reservations_active_index_shape.sql', 'utf8');
    expect(migration0024).toContain('stock_reservations(order_id, variant_id)');
    expect(migration0027).toContain('stock_reservations(order_id, variant_id)');
    expect(migration0028).toContain('stock_reservations(order_id, variant_id)');
  });
});
