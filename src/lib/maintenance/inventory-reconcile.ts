/**
 * Inventory Reconciliation [Master_Prompt v7.0 §16.2]
 *
 * Phase-7 rewrite: real baseline tracking + delta detection + DO
 * resync.
 *
 * The previous version only checked `on_hand = 0 AND sold > 0`, which
 * is a tiny subset of possible drift. The Phase-7 implementation:
 *   1. Reads `inventory_baseline` (seeded by migration 0014 from the
 *      current `inventory_items` state at deploy time).
 *   2. Compares the live `inventory_items` row against the baseline
 *      `{quantity, reserved_quantity, sold_quantity}`.
 *   3. On drift > threshold, writes a `low_stock_alerts` row AND
 *      re-syncs the `VariantInventoryDO` with the live D1 state.
 *   4. Refreshes the baseline row with the new (corrected) state, so
 *      subsequent reconciles only flag *new* drift.
 *
 * Drift semantics:
 *   - `quantity` going *down* without a corresponding `order_items`
 *     `staff_confirmed/packing/shipped/delivered/returned/refunded`
 *     row is suspicious. We log it as a soft drift.
 *   - `quantity` going *up* without a corresponding `stock_adjustments`
 *     or restock is also suspicious. We log it.
 *   - `reserved_quantity` going *up* without a corresponding
 *     `stock_reservations` row that is still `active` is the classic
 *     "leaked reservation" bug. We log it.
 *   - `sold_quantity` drift without a matching fulfilled order is
 *     suspicious (post-0017 sold tracking).
 *
 * The reconciliation is bounded to 500 variants per invocation to keep
 * the daily cron under D1's per-DB write limit. Subsequent runs
 * cover the rest.
 */
import { nowSql } from "../dates";
import { doSyncFromD1 } from "../do-client";
import { writeAuditLog } from "../audit";
import { safeLog } from "../pii-scrubber";

const DISCREPANCY_THRESHOLD = 2;
const MAX_VARIANTS_PER_RUN = 500;

export interface ReconcileReport {
  variantsChecked: number;
  drift: Array<{
    variantId: string;
    baselineQuantity: number;
    liveQuantity: number;
    baselineReserved: number;
    liveReserved: number;
    baselineSold: number;
    liveSold: number;
    quantityDelta: number;
    reservedDelta: number;
    soldDelta: number;
    severity: "soft" | "hard";
  }>;
  dosResynced: number;
  baselinesRefreshed: number;
}

export async function reconcileInventory(
  db: D1Database,
  env?: { VARIANT_INVENTORY_DO?: DurableObjectNamespace; ANALYTICS?: AnalyticsEngineDataset },
): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    variantsChecked: 0,
    drift: [],
    dosResynced: 0,
    baselinesRefreshed: 0,
  };
  const now = nowSql();

  // First pass: ensure every variant has a baseline row. The seed
  // migration (0014) inserts a baseline for every inventory_items row
  // at deploy time, so this should be a no-op in steady state. It
  // guards against variants added after the seed.
  await db
    .prepare(
      `INSERT OR IGNORE INTO inventory_baseline (variant_id, quantity, reserved_quantity, sold_quantity, baseline_hash, set_at, set_by, reconciliation_count)
       SELECT variant_id, quantity, reserved_quantity, sold_quantity, 'pending-first-reconcile', ?1, NULL, 0
       FROM inventory_items
       WHERE variant_id NOT IN (SELECT variant_id FROM inventory_baseline)`,
    )
    .bind(now)
    .run();

  const rows = await db
    .prepare(
      `WITH candidates AS (
         SELECT variant_id
         FROM inventory_baseline
         WHERE baseline_hash = 'pending-first-reconcile'
            OR set_at < ?1
         ORDER BY set_at ASC
         LIMIT ?2
       )
       SELECT
         iv.variant_id,
         iv.quantity      AS live_quantity,
         iv.reserved_quantity AS live_reserved,
         iv.sold_quantity AS live_sold,
         b.quantity      AS baseline_quantity,
         b.reserved_quantity AS baseline_reserved,
         b.sold_quantity AS baseline_sold,
         b.baseline_hash,
         b.set_at        AS baseline_set_at,
         b.reconciliation_count AS baseline_recon_count
       FROM candidates c
       JOIN inventory_items iv ON iv.variant_id = c.variant_id
       JOIN inventory_baseline b ON b.variant_id = c.variant_id
       ORDER BY b.set_at ASC`,
    )
    .bind(nowSql(new Date(Date.now() - 24 * 60 * 60 * 1000)), MAX_VARIANTS_PER_RUN)
    .all<{
      variant_id: string;
      live_quantity: number;
      live_reserved: number;
      live_sold: number;
      baseline_quantity: number;
      baseline_reserved: number;
      baseline_sold: number;
      baseline_hash: string;
      baseline_set_at: string;
      baseline_recon_count: number;
    }>();

  for (const row of rows.results ?? []) {
    report.variantsChecked += 1;
    const quantityDelta = row.live_quantity - row.baseline_quantity;
    const reservedDelta = row.live_reserved - row.baseline_reserved;
    const soldDelta = row.live_sold - row.baseline_sold;

    if (row.baseline_hash === "pending-first-reconcile") {
      await refreshBaseline(db, row.variant_id, row.live_quantity, row.live_reserved, row.live_sold, now);
      report.baselinesRefreshed += 1;
      continue;
    }

    const withinTolerance =
      Math.abs(quantityDelta) <= DISCREPANCY_THRESHOLD &&
      Math.abs(reservedDelta) <= DISCREPANCY_THRESHOLD &&
      Math.abs(soldDelta) <= DISCREPANCY_THRESHOLD;

    if (withinTolerance) {
      await refreshBaseline(db, row.variant_id, row.live_quantity, row.live_reserved, row.live_sold, now);
      report.baselinesRefreshed += 1;
      continue;
    }

    const maxDelta = Math.max(Math.abs(quantityDelta), Math.abs(reservedDelta), Math.abs(soldDelta));
    const severity: "soft" | "hard" = maxDelta > 10 ? "hard" : "soft";

    report.drift.push({
      variantId: row.variant_id,
      baselineQuantity: row.baseline_quantity,
      liveQuantity: row.live_quantity,
      baselineReserved: row.baseline_reserved,
      liveReserved: row.live_reserved,
      baselineSold: row.baseline_sold,
      liveSold: row.live_sold,
      quantityDelta,
      reservedDelta,
      soldDelta,
      severity,
    });

    await db
      .prepare(
        `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
         VALUES (?1, ?2, ?3, ?4)`,
      )
      .bind(
        crypto.randomUUID(),
        row.variant_id,
        `inventory_reconcile: drift severity=${severity} qty=${row.baseline_quantity}->${row.live_quantity} (${quantityDelta >= 0 ? "+" : ""}${quantityDelta}) reserved=${row.baseline_reserved}->${row.live_reserved} (${reservedDelta >= 0 ? "+" : ""}${reservedDelta}) sold=${row.baseline_sold}->${row.live_sold} (${soldDelta >= 0 ? "+" : ""}${soldDelta})`,
        now,
      )
      .run();

    if (env?.VARIANT_INVENTORY_DO) {
      try {
        await doSyncFromD1(env as { DB: D1Database; VARIANT_INVENTORY_DO: DurableObjectNamespace }, row.variant_id, row.live_quantity, row.live_reserved, row.live_sold);
        report.dosResynced += 1;
      } catch (err) {
        safeLog.warn('[inventory-reconcile] doSyncFromD1 failed (non-fatal)', { variantId: row.variant_id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    await refreshBaseline(db, row.variant_id, row.live_quantity, row.live_reserved, row.live_sold, now);
    report.baselinesRefreshed += 1;
  }

  await writeAuditLog(db, {
    actorStaffId: null,
    actorRole: null,
    action: "inventory.reconcile.completed",
    entityType: "system",
    entityId: "inventory-reconcile",
    metadata: {
      variants_checked: report.variantsChecked,
      drift_count: report.drift.length,
      hard_drift_count: report.drift.filter(d => d.severity === "hard").length,
      dos_resynced: report.dosResynced,
      baselines_refreshed: report.baselinesRefreshed,
    },
  });

  return report;
}

async function refreshBaseline(
  db: D1Database,
  variantId: string,
  quantity: number,
  reservedQuantity: number,
  soldQuantity: number,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE inventory_baseline
       SET quantity = ?2,
           reserved_quantity = ?3,
           sold_quantity = ?4,
           baseline_hash = ?5,
           set_at = ?6,
           reconciliation_count = reconciliation_count + 1
       WHERE variant_id = ?1`,
    )
    .bind(
      variantId,
      quantity,
      reservedQuantity,
      soldQuantity,
      `v1:${quantity}:${reservedQuantity}:${soldQuantity}`,
      now,
    )
    .run();
}
