globalThis.process ??= {};
globalThis.process.env ??= {};
import { n as nowSql } from "./sequence_XySMyPne.mjs";
const PARTIAL_PREPAY_MAX_AGE_HOURS = 24;
async function sweepStalePartialPrepayOrders(db) {
  const now = nowSql();
  const cutoff = nowSql(new Date(Date.now() - PARTIAL_PREPAY_MAX_AGE_HOURS * 60 * 60 * 1e3));
  const stale = await db.prepare(
    `SELECT id FROM orders
     WHERE payment_status = 'partially_paid'
       AND status IN ('pending_review','pending_payment')
       AND created_at < ?1
     LIMIT 50`
  ).bind(cutoff).all();
  const rows = stale.results ?? [];
  if (rows.length === 0) return { cancelledOrders: 0, releasedReservations: 0 };
  let cancelledOrders = 0;
  let releasedReservations = 0;
  for (const order of rows) {
    const reservations = await db.prepare(
      `SELECT id, variant_id, quantity FROM stock_reservations
       WHERE order_id = ?1 AND status = 'active'`
    ).bind(order.id).all();
    const resRows = reservations.results ?? [];
    if (resRows.length > 0) {
      const releaseStmts = resRows.map(
        (r) => db.prepare(
          `UPDATE inventory_items
           SET reserved_quantity = MAX(reserved_quantity - ?1, 0), updated_at = ?3
           WHERE variant_id = ?2`
        ).bind(r.quantity, r.variant_id, now)
      );
      const markStmts = resRows.map(
        (r) => db.prepare(
          `UPDATE stock_reservations SET status = 'released', updated_at = ?2 WHERE id = ?1`
        ).bind(r.id, now)
      );
      await db.batch([...releaseStmts, ...markStmts], { atomic: true });
      releasedReservations += resRows.length;
    }
    await db.prepare(
      `UPDATE orders SET status = 'cancelled', updated_at = ?2 WHERE id = ?1`
    ).bind(order.id, now).run();
    await db.prepare(
      `INSERT INTO order_status_history (id, order_id, from_status, to_status, note, created_at)
       VALUES (?1, ?2, 'partially_paid', 'cancelled', 'auto-cancelled: partial_prepay not confirmed within 24h', ?3)`
    ).bind(crypto.randomUUID(), order.id, now).run();
    const firstVariant = resRows[0]?.variant_id;
    if (firstVariant) {
      await db.prepare(
        `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
         VALUES (?1, ?2, 'partial_prepay order auto-cancelled after 24h. Customer follow-up required.', ?3)`
      ).bind(crypto.randomUUID(), firstVariant, now).run();
    }
    cancelledOrders += 1;
  }
  return { cancelledOrders, releasedReservations };
}
export {
  sweepStalePartialPrepayOrders
};
