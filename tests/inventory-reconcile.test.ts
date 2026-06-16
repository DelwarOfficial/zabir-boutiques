import { describe, it, expect } from 'vitest';

/**
 * Tests for the Phase-7 inventory reconciliation rewrite.
 *
 * The reconcile function reads `inventory_items` joined with
 * `inventory_baseline`. We exercise it against a minimal stub D1
 * modeled on the existing tests/checkout.test.ts pattern.
 */

type SqlRow = Record<string, unknown>;

function makeStubD1(handler: (sql: string, params: any[]) => SqlRow[] = () => []): D1Database {
  return {
    prepare(sql: string) {
      let bound: any[] = [];
      const stmt: any = {
        bind(...params: any[]) {
          bound = params;
          return stmt;
        },
        async all<T>() {
          return { results: handler(sql, bound) as T[] };
        },
        async first<T>() {
          return (handler(sql, bound)[0] ?? null) as T;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

describe('reconcileInventory (Phase-7 baseline tracking)', () => {
  it('returns a no-drift report when live matches baseline', async () => {
    // P0-005 audit fix: the SELECT now uses a WITH clause and joins
    // candidates → inventory_items → inventory_baseline. Match the
    // outer SELECT to return the test fixtures.
    const db = makeStubD1((sql) => {
      if (/WITH candidates AS/.test(sql)) {
        return [
          {
            variant_id: 'v1',
            live_quantity: 50,
            live_reserved: 5,
            baseline_quantity: 50,
            baseline_reserved: 5,
            baseline_hash: 'v1:50:5',
            baseline_set_at: '2026-06-15 00:00:00',
            baseline_recon_count: 3,
          },
        ];
      }
      return [];
    });
    const { reconcileInventory } = await import('../src/lib/maintenance/inventory-reconcile');
    const report = await reconcileInventory(db);
    expect(report.variantsChecked).toBeGreaterThanOrEqual(1);
    expect(report.drift).toEqual([]);
  });

  it('reports drift when live quantity diverges from baseline', async () => {
    const db = makeStubD1((sql) => {
      if (/WITH candidates AS/.test(sql)) {
        return [
          {
            variant_id: 'v1',
            live_quantity: 30,
            live_reserved: 0,
            baseline_quantity: 50,
            baseline_reserved: 0,
            baseline_hash: 'v1:50:0',
            baseline_set_at: '2026-06-15 00:00:00',
            baseline_recon_count: 5,
          },
        ];
      }
      return [];
    });
    const { reconcileInventory } = await import('../src/lib/maintenance/inventory-reconcile');
    const report = await reconcileInventory(db);
    expect(report.drift.length).toBeGreaterThanOrEqual(1);
    expect(report.drift[0]).toMatchObject({
      variantId: 'v1',
      quantityDelta: -20,
      severity: 'hard',
    });
  });

  it('does NOT report drift when within DISCREPANCY_THRESHOLD (2)', async () => {
    const db = makeStubD1((sql) => {
      if (/WITH candidates AS/.test(sql)) {
        return [
          {
            variant_id: 'v1',
            live_quantity: 48,
            live_reserved: 1,
            baseline_quantity: 50,
            baseline_reserved: 1,
            baseline_hash: 'v1:50:1',
            baseline_set_at: '2026-06-15 00:00:00',
            baseline_recon_count: 3,
          },
        ];
      }
      return [];
    });
    const { reconcileInventory } = await import('../src/lib/maintenance/inventory-reconcile');
    const report = await reconcileInventory(db);
    expect(report.drift).toEqual([]);
  });

  it('classifies soft drift at 3-10 units and hard drift at >10', async () => {
    const db = makeStubD1((sql) => {
      if (/WITH candidates AS/.test(sql)) {
        return [
          {
            variant_id: 'soft',
            live_quantity: 45,
            live_reserved: 0,
            baseline_quantity: 50,
            baseline_reserved: 0,
            baseline_hash: 'soft:50:0',
            baseline_set_at: '2026-06-15 00:00:00',
            baseline_recon_count: 1,
          },
          {
            variant_id: 'hard',
            live_quantity: 30,
            live_reserved: 0,
            baseline_quantity: 50,
            baseline_reserved: 0,
            baseline_hash: 'hard:50:0',
            baseline_set_at: '2026-06-15 00:00:00',
            baseline_recon_count: 1,
          },
        ];
      }
      return [];
    });
    const { reconcileInventory } = await import('../src/lib/maintenance/inventory-reconcile');
    const report = await reconcileInventory(db);
    const byId = Object.fromEntries(report.drift.map((d: any) => [d.variantId, d]));
    expect(byId['soft']?.severity).toBe('soft');
    expect(byId['hard']?.severity).toBe('hard');
  });
});
