/**
 * Payment Reconciliation [Master_Prompt v7.0 §6.2, G2]
 *
 * Cron (every 15 min) reconciles orders stuck in payment_status='pending':
 *  - < 2h: call UddoktaPay status. If 'paid', run applyPaymentVerified
 *    (the same function the inline webhook + queue consumer use). The
 *    payment_events UNIQUE claim makes this idempotent.
 *  - > 2h: assume abandoned. Auto-cancel + release stock reservations
 *    + create a low_stock_alert so staff can audit.
 *
 * P1-003 fix: the cancel and verify paths use status-guarded UPDATEs
 * so a near-simultaneous cancel + verify cannot leave the order in
 * contradictory state (status='cancelled' but payment_status='paid').
 */
import { nowSql } from "../dates";
import { applyPaymentVerified, verifyUddoktaPayment } from "../payments";
import { claimReservationsForRelease, releaseReservedVariants } from "../inventory";
import { writeAuditLog } from "../audit";
import { trackMetric } from "../analytics";
import { safeLog } from "../pii-scrubber";

const STALE_THRESHOLD_HOURS = 0.5; // 30 minutes
const ABANDONED_THRESHOLD_HOURS = 2; // 2 hours

export interface ReconcileResult {
  checked: number;
  fixed: number;
  abandoned: number;
  errors: number;
}

export async function reconcilePendingPayments(
  env: { DB: D1Database; UDDOKTAPAY_API_KEY: string; UDDOKTAPAY_BASE_URL: string; ANALYTICS?: AnalyticsEngineDataset; VARIANT_INVENTORY_DO?: DurableObjectNamespace },
  now: string = nowSql(),
): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, fixed: 0, abandoned: 0, errors: 0 };

  const staleCutoff = nowSql(new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000));
  const abandonedCutoff = nowSql(new Date(Date.now() - ABANDONED_THRESHOLD_HOURS * 60 * 60 * 1000));

  // First pass: auto-cancel orders stuck > 2h. Status-guarded so a
  // concurrent verify path that just flipped payment_status to 'paid'
  // does not get cancelled out from under it.
  const abandoned = await env.DB
    .prepare(
      `SELECT id, status FROM orders
       WHERE payment_status IN ('created','pending','processing')
         AND status IN ('pending_review','pending_payment')
         AND created_at < ?1
       LIMIT 50`,
    )
    .bind(abandonedCutoff)
    .all<{ id: string; status: string }>();
  for (const row of abandoned.results ?? []) {
    try {
      const fromStatus = row.status;
      const reservations = await env.DB
        .prepare("SELECT id, variant_id, quantity FROM stock_reservations WHERE order_id = ?1 AND status = 'active'")
        .bind(row.id)
        .all<{ id: string; variant_id: string; quantity: number }>();
      const items = (reservations.results ?? []).map(r => ({ variantId: r.variant_id, qty: r.quantity, reservationId: r.id }));
      const claimedItems = await claimReservationsForRelease(env.DB, items, now);
      if (claimedItems.length > 0) {
        await releaseReservedVariants(env, claimedItems, now);
      }
      // Atomic order status flip + history + reservation release. The
      // status guard (`AND status = ?3`) means a concurrent verify that
      // already moved the order to 'payment_verified' causes this batch
      // to no-op cleanly.
      await env.DB.batch(
        [
          env.DB.prepare(
            `UPDATE orders SET status = 'cancelled', updated_at = ?2
             WHERE id = ?1 AND status = ?3`,
          ).bind(row.id, now, fromStatus),
          env.DB.prepare(
            `UPDATE stock_reservations SET status = 'released', updated_at = ?2
             WHERE order_id = ?1 AND status = 'active'`,
          ).bind(row.id, now),
          env.DB.prepare(
            `INSERT INTO order_status_history (id, order_id, from_status, to_status, note, created_at)
             VALUES (?1, ?2, ?3, 'cancelled', 'auto-cancelled: stale_pending_payment_over_2h', ?4)`,
          ).bind(crypto.randomUUID(), row.id, fromStatus, now),
        ],
        { atomic: true },
      );
      await writeAuditLog(env.DB, {
        actorStaffId: null,
        actorRole: null,
        action: "order.reconciliation.abandoned",
        entityType: "order",
        entityId: row.id,
        metadata: { reason: "stale_pending_payment_over_2h" },
      });
      result.abandoned += 1;
    } catch (err) {
      safeLog.error("[reconciliation] abandon error", { error: err instanceof Error ? err.message : String(err) });
      result.errors += 1;
    }
  }

  // Second pass: check UddoktaPay for orders stuck > 30 min but < 2h.
  // The verify path goes through applyPaymentVerified so it shares the
  // same payment_events idempotency claim as the inline webhook and
  // the queue consumer. A `status NOT IN ('cancelled','refunded')` guard
  // in the cancel pass above means a near-simultaneous cancel cannot
  // undo this verify.
  const stale = await env.DB
    .prepare(
      `SELECT o.id AS order_id, p.invoice_id
       FROM orders o
       JOIN payments p ON p.order_id = o.id
       WHERE o.payment_status IN ('created','pending','processing')
         AND o.status IN ('pending_review','pending_payment')
         AND o.created_at >= ?1
         AND o.created_at < ?2
         AND p.invoice_id IS NOT NULL
       LIMIT 50`,
    )
    .bind(staleCutoff, abandonedCutoff)
    .all<{ order_id: string; invoice_id: string }>();
  for (const row of stale.results ?? []) {
    result.checked += 1;
    try {
      const verified = await verifyUddoktaPayment(row.invoice_id, env.UDDOKTAPAY_API_KEY, env.UDDOKTAPAY_BASE_URL, env);
      if (verified.status !== "paid") continue;
      const applyResult = await applyPaymentVerified(
        env,
        row.invoice_id,
        { amountPaisa: verified.amountPaisa, metadata: verified.metadata, rawResponse: verified.rawResponse ?? "" },
        now,
      );
      if (applyResult.ok && !applyResult.alreadyProcessed) {
        result.fixed += 1;
        await trackMetric(env, {
          name: "payment_webhook_failures",
          doubles: { count: 1 },
          indexes: ["provider:uddoktapay", "recovered:true"],
        });
      }
    } catch (err) {
      safeLog.error("[reconciliation] status check error", { error: err instanceof Error ? err.message : String(err) });
      result.errors += 1;
    }
  }

  return result;
}
