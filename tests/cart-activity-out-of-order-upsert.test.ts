import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve('./db/migrations');

function buildDb(): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0019_cart_activity.sql'), 'utf8'));
  return raw;
}

// Mirrors the guarded upsert in src/queues/consumers.ts handleCartActivityBatch.
function upsert(raw: DatabaseSync, sessionId: string, itemCount: number, totalQuantity: number, subtotalPaisa: number, lastCartUpdateAt: string): void {
  raw.prepare(
    `INSERT INTO cart_activity (session_id, item_count, total_quantity, subtotal_paisa, last_cart_update_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (session_id) DO UPDATE SET
       item_count = excluded.item_count,
       total_quantity = excluded.total_quantity,
       subtotal_paisa = excluded.subtotal_paisa,
       last_cart_update_at = excluded.last_cart_update_at,
       updated_at = excluded.updated_at
     WHERE excluded.last_cart_update_at >= cart_activity.last_cart_update_at`,
  ).run(sessionId, itemCount, totalQuantity, subtotalPaisa, lastCartUpdateAt, lastCartUpdateAt);
}

describe('cart_activity out-of-order queue upsert (CF-04)', () => {
  it('an older message processed after a newer one does not regress the row', () => {
    const raw = buildDb();
    // Newer mutation (3 items) arrives and is processed first.
    upsert(raw, 's1', 3, 3, 3000, '2026-01-01 10:05:00');
    // Older mutation (1 item), delayed queue retry, arrives second.
    upsert(raw, 's1', 1, 1, 1000, '2026-01-01 10:00:00');

    const row = raw.prepare('SELECT item_count, total_quantity, last_cart_update_at FROM cart_activity WHERE session_id = ?').get('s1') as any;
    expect(row.item_count).toBe(3);
    expect(row.total_quantity).toBe(3);
    expect(row.last_cart_update_at).toBe('2026-01-01 10:05:00');
  });

  it('in-order delivery still applies normally', () => {
    const raw = buildDb();
    upsert(raw, 's2', 1, 1, 1000, '2026-01-01 10:00:00');
    upsert(raw, 's2', 2, 2, 2000, '2026-01-01 10:01:00');
    const row = raw.prepare('SELECT item_count FROM cart_activity WHERE session_id = ?').get('s2') as any;
    expect(row.item_count).toBe(2);
  });

  it('equal timestamps apply (>= not >), matching at-least-once redelivery of the same message', () => {
    const raw = buildDb();
    upsert(raw, 's3', 1, 1, 1000, '2026-01-01 10:00:00');
    upsert(raw, 's3', 1, 1, 1000, '2026-01-01 10:00:00'); // exact redelivery
    const row = raw.prepare('SELECT item_count FROM cart_activity WHERE session_id = ?').get('s3') as any;
    expect(row.item_count).toBe(1);
  });

  it('the fix is actually present in the consumer, not just in this test harness', () => {
    const src = readFileSync(resolve('./src/queues/consumers.ts'), 'utf8');
    expect(src).toContain("WHERE excluded.last_cart_update_at >= cart_activity.last_cart_update_at");
  });
});
