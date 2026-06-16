globalThis.process ??= {};
globalThis.process.env ??= {};
import { n as nowSql } from "./sequence_XySMyPne.mjs";
const DISCREPANCY_THRESHOLD = 2;
async function reconcileInventory(db) {
  const report = { variantsChecked: 0, discrepancies: [] };
  const now = nowSql();
  const rows = await db.prepare(
    `SELECT
         iv.variant_id,
         iv.quantity AS on_hand,
         COALESCE(SUM(CASE WHEN o.status IN ('staff_confirmed','packing','shipped','delivered','returned','refunded') THEN oi.quantity END), 0) AS sold
       FROM inventory_items iv
       LEFT JOIN order_items oi ON oi.variant_id = iv.variant_id
       LEFT JOIN orders o ON o.id = oi.order_id
       GROUP BY iv.variant_id, iv.quantity`
  ).all();
  for (const row of rows.results ?? []) {
    report.variantsChecked += 1;
    if (row.on_hand === 0 && row.sold > 0) {
      const delta = row.sold;
      report.discrepancies.push({ variantId: row.variant_id, expected: row.sold, actual: 0, delta });
      if (delta > DISCREPANCY_THRESHOLD) {
        await db.prepare(
          `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
             VALUES (?1, ?2, ?3, ?4)`
        ).bind(
          crypto.randomUUID(),
          row.variant_id,
          `inventory_reconcile: on_hand=0 but sold=${row.sold} (delta ${delta})`,
          now
        ).run();
      }
    }
  }
  return report;
}
export {
  reconcileInventory
};
