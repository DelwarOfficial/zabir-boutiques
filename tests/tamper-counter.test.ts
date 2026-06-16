import { describe, it, expect } from 'vitest';

/**
 * Tests for the P1-002 audit fix.
 *
 * The tamper counter in `assertNoClientMoneyTrust` is now backed by
 * a D1 INSERT ... ON CONFLICT DO UPDATE SET count = count + 1
 * RETURNING count. The key property is that concurrent attempts
 * from the same IP increment the counter atomically, and exactly
 * one alert is written when the count crosses the threshold.
 */

type SqlRow = Record<string, unknown>;

function makeD1(): D1Database & {
  invocations: Array<{ sql: string; args: any[] }>;
  tamperRows: Map<string, { count: number; alerted_at: string | null }>;
} {
  const invocations: Array<{ sql: string; args: any[] }> = [];
  // D1's INSERT ... ON CONFLICT is serialized on the unique index.
  // Simulate that here with a serialized counter.
  const tamperRows = new Map<string, { count: number; alerted_at: string | null }>();
  let queue: Promise<unknown> = Promise.resolve();
  return {
    invocations,
    tamperRows,
    prepare(sql: string) {
      let bound: any[] = [];
      const stmt: any = {
        bind(...params: any[]) {
          bound = params;
          return stmt;
        },
        async all<T>() {
          invocations.push({ sql, args: [...bound] });
          return { results: [] as T[] };
        },
        async first<T>() {
          invocations.push({ sql, args: [...bound] });
          if (/INSERT INTO tamper_lockout[\s\S]*RETURNING count/.test(sql)) {
            const key = `${bound[0]}:${bound[1]}`;
            const result = queue.then(() => {
              const existing = tamperRows.get(key);
              if (existing) {
                existing.count += 1;
                return { count: existing.count };
              }
              tamperRows.set(key, { count: 1, alerted_at: null });
              return { count: 1 };
            });
            queue = result.then(() => undefined);
            return (await result) as T;
          }
          return null as T;
        },
        async run() {
          invocations.push({ sql, args: [...bound] });
          if (/UPDATE tamper_lockout\s+SET alerted_at/.test(sql)) {
            const key = `${bound[0]}:${bound[1]}`;
            const result = queue.then(() => {
              const existing = tamperRows.get(key);
              if (existing && !existing.alerted_at) {
                existing.alerted_at = String(bound[2] ?? new Date().toISOString());
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            });
            queue = result.then(() => undefined);
            return (await result) as { meta: { changes: number } };
          }
          if (/INSERT INTO low_stock_alerts/.test(sql)) {
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database & {
    invocations: Array<{ sql: string; args: any[] }>;
    tamperRows: Map<string, { count: number; alerted_at: string | null }>;
  };
}

async function fireOnce(db: ReturnType<typeof makeD1>, ip: string) {
  const { assertNoClientMoneyTrust } = await import(
    '../src/lib/checkout-pricing'
  );
  assertNoClientMoneyTrust(
    {
      subtotal_paisa: 1,
      total_paisa: 1,
      items: [{ variant_id: 'v1', quantity: 1, unit_price_paisa: 1 }],
    },
    { DB: db as unknown as D1Database },
    { ip, now: '2026-06-16 00:00:00' },
  );
  // Wait for the IIFE to drain.
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe('P1-002: tamper counter via D1 ON CONFLICT', () => {
  it('increments the counter atomically across 10 calls from the same IP', async () => {
    const db = makeD1();
    for (let i = 0; i < 9; i++) {
      await fireOnce(db, '1.2.3.4');
    }
    // The function computes windowId from Date.now() at call time, so
    // we don't know the exact key. Find the only row.
    const rows = Array.from(db.tamperRows.values());
    expect(rows).toHaveLength(1);
    const beforeAlert = rows[0];
    expect(beforeAlert.count).toBe(9);
    expect(beforeAlert.alerted_at).toBeNull();

    // The 10th call crosses the threshold.
    await fireOnce(db, '1.2.3.4');
    const rowsAfter = Array.from(db.tamperRows.values());
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0].count).toBe(10);
    expect(rowsAfter[0].alerted_at).not.toBeNull();
  });

  it('writes exactly one low_stock_alert row even if 20 calls race past the threshold', async () => {
    const db = makeD1();
    // Find the window_id the test will use by computing it.
    const windowId = Math.floor(Date.now() / (5 * 60 * 1000));
    const existingKey = `1.2.3.4:${windowId}`;
    db.tamperRows.set(existingKey, { count: 9, alerted_at: null });
    await Promise.all(
      Array.from({ length: 20 }).map(() => fireOnce(db, '1.2.3.4')),
    );
    const alerts = db.invocations.filter((i) =>
      /INSERT INTO low_stock_alerts/.test(i.sql),
    );
    expect(alerts.length).toBe(1);
  });

  it('does not write an alert below the threshold (count < 10)', async () => {
    const db = makeD1();
    for (let i = 0; i < 9; i++) {
      await fireOnce(db, '9.9.9.9');
    }
    const alerts = db.invocations.filter((i) =>
      /INSERT INTO low_stock_alerts/.test(i.sql),
    );
    expect(alerts.length).toBe(0);
  });

  it('separate IPs do not share a counter', async () => {
    const db = makeD1();
    for (let i = 0; i < 10; i++) {
      await fireOnce(db, '1.1.1.1');
    }
    for (let i = 0; i < 5; i++) {
      await fireOnce(db, '2.2.2.2');
    }
    const rows = Array.from(db.tamperRows.values());
    // One row per (ip, window_id). With a single window, two rows.
    expect(rows).toHaveLength(2);
    const byCount = rows.sort((a, b) => b.count - a.count);
    expect(byCount[0].count).toBe(10);
    expect(byCount[0].alerted_at).not.toBeNull();
    expect(byCount[1].count).toBe(5);
    expect(byCount[1].alerted_at).toBeNull();
  });
});
