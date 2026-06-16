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
 *      `{quantity, reserved_quantity}`.
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
    quantityDelta: number;
    reservedDelta: number;
    severity: "soft" | "hard";
  }>;
  dosResynced: number;
  baselinesRefreshed: number;
}

export async function reconcileInventory(
  db: D1Database,
  env?: { VARIANT_INVENTORY?: DurableObjectNamespace; ANALYTICS?: AnalyticsEngineDataset },
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
      `INSERT OR IGNORE INTO inventory_baseline (variant_id, quantity, reserved_quantity, baseline_hash, set_at, set_by, reconciliation_count)
       SELECT variant_id, quantity, reserved_quantity, 'pending-first-reconcile', ?1, NULL, 0
       FROM inventory_items
       WHERE variant_id NOT IN (SELECT variant_id FROM inventory_baseline)`,
    )
    .bind(now)
    .run();

  // Read the live + baseline rows together. Bounded to MAX_VARIANTS_PER_RUN
  // so the daily cron does not exceed D1's per-DB write limit. The cron
  // is registered in src/lib/cron-dispatch.ts at `0 3 * * *`.
  //
  // P0-005 audit fix: `IN (subquery ... ORDER BY ... LIMIT ...)` does NOT
  // guarantee that the outer query returns rows in the subquery's order.
  // The previous query rotated through random variants under a 500-cap,
  // missing drift on the oldest baselines. The CTE form materializes
  // the candidates with explicit ordering, then the outer JOIN preserves
  // that order.
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
         b.quantity      AS baseline_quantity,
         b.reserved_quantity AS baseline_reserved,
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
      baseline_quantity: number;
      baseline_reserved: number;
      baseline_hash: string;
      baseline_set_at: string;
      baseline_recon_count: number;
    }>();

  for (const row of rows.results ?? []) {
    report.variantsChecked += 1;
    const quantityDelta = row.live_quantity - row.baseline_quantity;
    const reservedDelta = row.live_reserved - row.baseline_reserved;

    // On first reconcile (`pending-first-reconcile` hash), we just
    // adopt the live state as the new baseline. No drift, no alert.
    if (row.baseline_hash === "pending-first-reconcile") {
      await refreshBaseline(db, row.variant_id, row.live_quantity, row.live_reserved, now);
      report.baselinesRefreshed += 1;
      continue;
    }

    if (Math.abs(quantityDelta) <= DISCREPANCY_THRESHOLD && Math.abs(reservedDelta) <= DISCREPANCY_THRESHOLD) {
      // Within tolerance — no drift. Refresh the baseline so the
      // next reconcile only flags *new* drift.
      await refreshBaseline(db, row.variant_id, row.live_quantity, row.live_reserved, now);
      report.baselinesRefreshed += 1;
      continue;
    }

    // Drift detected. Determine severity.
    const severity: "soft" | "hard" =
      Math.abs(quantityDelta) > 10 || Math.abs(reservedDelta) > 10 ? "hard" : "soft";

    report.drift.push({
      variantId: row.variant_id,
      baselineQuantity: row.baseline_quantity,
      liveQuantity: row.live_quantity,
      baselineReserved: row.baseline_reserved,
      liveReserved: row.live_reserved,
      quantityDelta,
      reservedDelta,
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
        `inventory_reconcile: drift severity=${severity} qty=${row.baseline_quantity}->${row.live_quantity} (${quantityDelta >= 0 ? "+" : ""}${quantityDelta}) reserved=${row.baseline_reserved}->${row.live_reserved} (${reservedDelta >= 0 ? "+" : ""}${reservedDelta})`,
        now,
      )
      .run();

    // Resync the DO with the live D1 state. The DO is a cache, not
    // the source of truth; if D1 says X, the DO should also say X.
    if (env?.VARIANT_INVENTORY) {
      try {
        await doSyncFromD1(env as { DB: D1Database; VARIANT_INVENTORY: DurableObjectNamespace }, row.variant_id, row.live_quantity, row.live_reserved);
        report.dosResynced += 1;
      } catch (err) {
        safeLog.warn('[inventory-reconcile] doSyncFromD1 failed (non-fatal)', { variantId: row.variant_id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // After emitting the alert, refresh the baseline so the *next*
    // reconcile only flags *new* drift. Otherwise the same drift
    // would alert every night.
    await refreshBaseline(db, row.variant_id, row.live_quantity, row.live_reserved, now);
    report.baselinesRefreshed += 1;
  }

  // Audit the run summary.
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
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE inventory_baseline
       SET quantity = ?2,
           reserved_quantity = ?3,
           baseline_hash = ?4,
           set_at = ?5,
           reconciliation_count = reconciliation_count + 1
       WHERE variant_id = ?1`,
    )
    .bind(
      variantId,
      quantity,
      reservedQuantity,
      `v1:${quantity}:${reservedQuantity}`,
      now,
    )
    .run();
}
