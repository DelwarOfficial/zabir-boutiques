/**
 * Inventory Reservation-First Engine [v6.8D + Master_Prompt v7.0 §3.4, §6.1]
 *
 * Checkout reserves stock by increasing reserved_quantity only if available
 * stock is enough. It does not deduct final quantity.
 *
 * For multi-variant carts, if any item fails, every successful reservation
 * from the batch is released.
 *
 * CONCURRENCY: When VariantInventoryDO is bound, every reserve call goes
 * through the DO first. The DO serializes per-variant reserve/release
 * across Worker isolates, eliminating the (quantity - reserved_quantity)
 * read-then-write race that exists in pure D1. After the DO confirms, we
 * commit the same write to D1 — D1 remains the source of truth and the
 * DO is re-synced from D1 on every successful commit.
 *
 * If the DO is not bound (local dev), the function falls back to a pure
 * D1 atomic UPDATE, which is the v6.8A behavior and remains race-safe
 * at low concurrency.
 *
 * GUARDRAILS:
 * - Never create orders before reserveVariants() returns ok: true.
 * - stock_reservations expire exactly 10 minutes after creation (Master_Prompt v7.0 §6.3).
 * - Never call reserveVariants() outside src/lib/inventory.ts.
 */
import { nowSql } from "./dates";
import { doConfirm, doReserve, doRelease, doSyncFromD1 } from "./do-client";

type Env = { DB: D1Database; VARIANT_INVENTORY_DO?: DurableObjectNamespace };
export type ReservableItem = { variantId: string; qty: number; reservationId?: string };

async function syncVariantsFromD1(env: Env, variantIds: string[]): Promise<void> {
  if (!env.VARIANT_INVENTORY_DO || variantIds.length === 0) return;
  await Promise.all([...new Set(variantIds)].map(async (variantId) => {
    const row = await env.DB
      .prepare(
        `SELECT quantity, reserved_quantity, COALESCE(sold_quantity, 0) AS sold_quantity
         FROM inventory_items WHERE variant_id = ?1`,
      )
      .bind(variantId)
      .first<{ quantity: number; reserved_quantity: number; sold_quantity: number }>();
    if (row) await doSyncFromD1(env, variantId, row.quantity, row.reserved_quantity, row.sold_quantity);
  }));
}

export async function syncConfirmedReservationsDoState(env: Env, items: ReservableItem[]): Promise<void> {
  if (!env.VARIANT_INVENTORY_DO || items.length === 0) return;
  await Promise.all(items.map((item) => doConfirm(env, item.variantId, item.qty, item.reservationId)));
  await syncVariantsFromD1(env, items.map((item) => item.variantId));
}

export async function syncReleasedReservationsDoState(env: Env, items: ReservableItem[]): Promise<void> {
  if (!env.VARIANT_INVENTORY_DO || items.length === 0) return;
  await Promise.all(items.map((item) => doRelease(env, item.variantId, item.qty, item.reservationId)));
  await syncVariantsFromD1(env, items.map((item) => item.variantId));
}

export async function reserveVariants(
  env: Env,
  items: ReservableItem[],
  now: string,
): Promise<{ ok: true; reservations: Array<{ variantId: string; reservationId: string; quantity: number }> } | { ok: false; failedVariantId: string }> {
  const db = env.DB;
  if (items.length === 0) return { ok: false, failedVariantId: "EMPTY_CART" };

  for (const item of items) {
    if (!item.variantId || !Number.isInteger(item.qty) || item.qty <= 0) {
      return { ok: false, failedVariantId: item.variantId || "INVALID_ITEM" };
    }
  }

  // Phase 1: DO concurrency gate. Each variant serializes through its
  // own DO instance. This is the Master_Prompt §3.4 critical fix.
  if (env.VARIANT_INVENTORY_DO) {
    for (const item of items) {
      const r = await doReserve(env, item.variantId, item.qty);
      if (!r.ok) {
        // Compensating release for any items that already reserved.
        for (const prev of items) {
          if (prev.variantId === item.variantId) break;
          await doRelease(env, prev.variantId, prev.qty, prev.reservationId);
        }
        return { ok: false, failedVariantId: item.variantId };
      }
      item.reservationId = r.reservationId;
    }
  }

  // Phase 2: D1 source-of-truth commit. The DO gate above means no two
  // Workers can both pass the (quantity - reserved) >= qty check, so
  // this UPDATE is now safe to run.
  const reserveStmts = items.map(item =>
    db.prepare(
      `UPDATE inventory_items
       SET reserved_quantity = reserved_quantity + ?1, updated_at = ?3
       WHERE variant_id = ?2
         AND is_available = 1
         AND (quantity - reserved_quantity - COALESCE(sold_quantity, 0)) >= ?1`
    ).bind(item.qty, item.variantId, now)
  );

  const results = await db.batch(reserveStmts, { atomic: true });
  const failedIndex = results.findIndex(result => result.meta.changes !== 1);

  if (failedIndex === -1) {
    for (const item of items) {
      item.reservationId ??= crypto.randomUUID();
    }
    await syncVariantsFromD1(env, items.map((item) => item.variantId));
    return {
      ok: true,
      reservations: items.map((item) => ({
        variantId: item.variantId,
        reservationId: item.reservationId!,
        quantity: item.qty,
      })),
    };
  }

  // Compensating release: D1 rejected this item. Release it from the DO
  // and from the D1 reservations that succeeded earlier in the batch.
  const successfulItems = items.filter((_, index) => results[index]?.meta.changes === 1);
  if (successfulItems.length > 0) {
    const releaseStmts = successfulItems.map(item =>
      db.prepare(
        `UPDATE inventory_items
         SET reserved_quantity = reserved_quantity - ?1, updated_at = ?3
         WHERE variant_id = ?2 AND reserved_quantity >= ?1`
      ).bind(item.qty, item.variantId, now)
    );
    await db.batch(releaseStmts, { atomic: true });
    if (env.VARIANT_INVENTORY_DO) {
      await Promise.all(successfulItems.map(item => doRelease(env, item.variantId, item.qty, item.reservationId)));
    }
  }
  // Always release the failing item from the DO too.
  if (env.VARIANT_INVENTORY_DO) {
    await doRelease(env, items[failedIndex].variantId, items[failedIndex].qty, items[failedIndex].reservationId);
  }

  return { ok: false, failedVariantId: items[failedIndex].variantId };
}

export async function releaseReservedVariants(
  env: Env,
  items: ReservableItem[],
  now: string,
): Promise<void> {
  if (items.length === 0) return;
  const db = env.DB;
  const releaseStmts = items.flatMap((item) => {
    const stmts = [
      db.prepare(
        `UPDATE inventory_items
         SET reserved_quantity = reserved_quantity - ?1, updated_at = ?3
         WHERE variant_id = ?2 AND reserved_quantity >= ?1`
      ).bind(item.qty, item.variantId, now),
    ];
    if (item.reservationId) {
      stmts.push(
        db.prepare(
          `UPDATE stock_reservations
           SET status = 'released', updated_at = ?2
           WHERE id = ?1 AND status IN ('active','release_requested')`
        ).bind(item.reservationId, now),
      );
    }
    return stmts;
  });
  await db.batch(releaseStmts, { atomic: true });
  await syncReleasedReservationsDoState(env, items);
}

export async function claimReservationsForRelease(
  db: D1Database,
  items: ReservableItem[],
  now: string,
): Promise<ReservableItem[]> {
  const claimable = items.filter((item) => item.reservationId);
  if (claimable.length === 0) return [];

  const results = await db.batch(
    claimable.map((item) =>
      db.prepare(
        `UPDATE stock_reservations
         SET release_requested_at = ?2, status = 'release_requested', updated_at = ?2
         WHERE id = ?1 AND release_requested_at IS NULL AND status = 'active'`,
      ).bind(item.reservationId, now),
    ),
    { atomic: true },
  );

  return claimable.filter((_, index) => results[index]?.meta.changes === 1);
}

/**
 * Release expired active reservations and mark them released.
 * Called by the hourly cron job (Master Plan V7 §12.3).
 *
 * Bounded + chunked: processes at most `maxRows` reservations per invocation
 * and splits D1 writes into chunks that stay well under the statement limit.
 */
export async function cleanExpiredReservations(env: Env, maxRows = 200): Promise<void> {
  const db = env.DB;
  const now = nowSql();

  const expired = await db.prepare(
    `SELECT id, variant_id, quantity FROM stock_reservations
     WHERE status = 'active'
       AND created_at < datetime('now', '-15 minutes')
       AND release_requested_at IS NULL
      LIMIT ?1`
  ).bind(maxRows).all<{ id: string; variant_id: string; quantity: number }>();

  const rows = expired.results ?? [];
  if (rows.length === 0) return;

  const CHUNK_ROWS = 25;
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    const chunk = rows.slice(i, i + CHUNK_ROWS);
    const stmts = [
      ...chunk.map(row =>
        db.prepare(
          `UPDATE stock_reservations
           SET release_requested_at = ?2, status = 'release_requested', updated_at = ?2
           WHERE id = ?1 AND release_requested_at IS NULL AND status = 'active'`
        ).bind(row.id, now)
      ),
    ];
    const claims = await db.batch(stmts, { atomic: true });
    const claimedRows = chunk.filter((_, index) => claims[index]?.meta.changes === 1);
    for (const row of claimedRows) {
      if (env.VARIANT_INVENTORY_DO) {
        await doRelease(env, row.variant_id, row.quantity, row.id);
      }
      await db.batch([
        db.prepare(
          `UPDATE inventory_items
           SET reserved_quantity = reserved_quantity - ?1, updated_at = ?3
           WHERE variant_id = ?2 AND reserved_quantity >= ?1`
        ).bind(row.quantity, row.variant_id, now),
        db.prepare(
          `UPDATE stock_reservations SET status = 'released', updated_at = ?2 WHERE id = ?1 AND status = 'release_requested'`
        ).bind(row.id, now),
      ], { atomic: true });
    }
    await syncVariantsFromD1(env, claimedRows.map((row) => row.variant_id));
  }
}

/**
 * Confirm a reservation: stock_reservations go from 'active' to 'confirmed'
 * and inventory_items decrements both quantity and reserved_quantity.
 * Used at payment-verified time.
 */
export async function confirmReservedVariants(
  env: Env,
  items: ReservableItem[],
  now: string,
): Promise<{ ok: true } | { ok: false; failedVariantId: string }> {
  if (items.length === 0) return { ok: true };
  const db = env.DB;
  const deductStmts = items.flatMap((item) => {
    const stmts = [
      db.prepare(
        `UPDATE inventory_items
         SET reserved_quantity = reserved_quantity - ?1,
             quantity = quantity - ?1,
             updated_at = ?3
         WHERE variant_id = ?2 AND reserved_quantity >= ?1 AND quantity >= ?1`
      ).bind(item.qty, item.variantId, now),
    ];
    if (item.reservationId) {
      stmts.push(
        db.prepare(
          `UPDATE stock_reservations
           SET status = 'confirmed', updated_at = ?2
           WHERE id = ?1 AND status = 'active'`
        ).bind(item.reservationId, now),
      );
    }
    return stmts;
  });
  const results = await db.batch(deductStmts, { atomic: true });
  const failedIndex = items.findIndex((item, index) => {
    const inventoryResult = results[index * (item.reservationId ? 2 : 1)];
    return inventoryResult?.meta.changes !== 1;
  });
  if (failedIndex === -1) {
    await syncConfirmedReservationsDoState(env, items);
    return { ok: true };
  }
  return { ok: false, failedVariantId: items[failedIndex].variantId };
}
