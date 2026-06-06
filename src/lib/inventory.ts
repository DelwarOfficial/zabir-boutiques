/**
 * Inventory Reservation-First Engine [v6.8A]
 * Checkout reserves stock by increasing reserved_quantity only if available stock is enough.
 * It does not deduct final quantity.
 * For multi-variant carts, if any item fails, every successful reservation from the batch is released.
 *
 * GUARDRAILS:
 * - Never create orders before reserveVariants() returns ok: true.
 * - stock_reservations expire exactly 30 minutes after creation.
 * - Never call reserveVariants() outside src/lib/inventory.ts.
 */
import { nowSql } from './dates';

export async function reserveVariants(
  db: D1Database,
  items: Array<{ variantId: string; qty: number }>,
  now: string
): Promise<{ ok: true } | { ok: false; failedVariantId: string }> {
  if (items.length === 0) return { ok: false, failedVariantId: 'EMPTY_CART' };

  for (const item of items) {
    if (!item.variantId || !Number.isInteger(item.qty) || item.qty <= 0) {
      return { ok: false, failedVariantId: item.variantId || 'INVALID_ITEM' };
    }
  }

  const reserveStmts = items.map(item =>
    db.prepare(
      `UPDATE inventory_items
       SET reserved_quantity = reserved_quantity + ?1, updated_at = ?3
       WHERE variant_id = ?2
         AND is_available = 1
         AND (quantity - reserved_quantity) >= ?1`
    ).bind(item.qty, item.variantId, now)
  );

  const results = await db.batch(reserveStmts);
  const failedIndex = results.findIndex(result => result.meta.changes !== 1);

  if (failedIndex === -1) return { ok: true };

  // Compensating release for successful reservations
  const successfulItems = items.filter((_, index) => results[index]?.meta.changes === 1);
  if (successfulItems.length > 0) {
    const releaseStmts = successfulItems.map(item =>
      db.prepare(
        `UPDATE inventory_items
         SET reserved_quantity = reserved_quantity - ?1, updated_at = ?3
         WHERE variant_id = ?2 AND reserved_quantity >= ?1`
      ).bind(item.qty, item.variantId, now)
    );
    await db.batch(releaseStmts);
  }

  return { ok: false, failedVariantId: items[failedIndex].variantId };
}

export async function releaseReservedVariants(
  db: D1Database,
  items: Array<{ variantId: string; qty: number }>,
  now: string
): Promise<void> {
  if (items.length === 0) return;

  const releaseStmts = items.map(item =>
    db.prepare(
      `UPDATE inventory_items
       SET reserved_quantity = reserved_quantity - ?1, updated_at = ?3
       WHERE variant_id = ?2 AND reserved_quantity >= ?1`
    ).bind(item.qty, item.variantId, now)
  );

  await db.batch(releaseStmts);
}

/**
 * Release expired active reservations and mark them expired.
 * Called by the every-10-minute cron job.
 *
 * Bounded + chunked: processes at most `maxRows` reservations per invocation and
 * splits D1 writes into batches that stay well under the statement limit, so a
 * large backlog can never build an oversized batch or blow the Worker CPU budget.
 */
export async function cleanExpiredReservations(db: D1Database, maxRows = 200): Promise<void> {
  const now = nowSql();

  const expired = await db.prepare(
    `SELECT id, variant_id, quantity FROM stock_reservations
     WHERE status = 'active' AND expires_at < ?1
     LIMIT ?2`
  ).bind(now, maxRows).all<{ id: string; variant_id: string; quantity: number }>();

  const rows = expired.results ?? [];
  if (rows.length === 0) return;

  // Each row emits 2 statements (release + mark expired); keep each batch <= 50
  // statements => 25 rows per chunk.
  const CHUNK_ROWS = 25;
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    const chunk = rows.slice(i, i + CHUNK_ROWS);
    const stmts = [
      ...chunk.map(row =>
        db.prepare(
          `UPDATE inventory_items
           SET reserved_quantity = reserved_quantity - ?1, updated_at = ?3
           WHERE variant_id = ?2 AND reserved_quantity >= ?1`
        ).bind(row.quantity, row.variant_id, now)
      ),
      ...chunk.map(row =>
        db.prepare(
          `UPDATE stock_reservations SET status = 'expired', updated_at = ?2 WHERE id = ?1`
        ).bind(row.id, now)
      )
    ];
    await db.batch(stmts);
  }
}
