/**
 * Payment Reconciliation [Master_Prompt v7.0 §6.2, G2]
 *
 * Cron (every 15 min) reconciles orders stuck in payment_status='pending':
 *  - < 2h: call UddoktaPay status. If 'paid', fix the local state.
 *    If still 'pending' or 'processing', leave for the next run.
 *  - > 2h: assume abandoned. Auto-cancel + release stock reservations
 *    + create a low_stock_alert so staff can audit.
 *
 * This is the safety net for webhook delivery failures.
 */
import { nowSql } from "../dates";
import { verifyUddoktaPayment } from "../payments";
import { releaseReservedVariants } from "../inventory";
import { writeAuditLog } from "../audit";
import { trackMetric } from "../analytics";

const STALE_THRESHOLD_HOURS = 0.5; // 30 minutes
const ABANDONED_THRESHOLD_HOURS = 2; // 2 hours

export interface ReconcileResult {
  checked: number;
  fixed: number;
  abandoned: number;
  errors: number;
}

export async function reconcilePendingPayments(
  env: { DB: D1Database; UDDOKTAPAY_API_KEY: string; UDDOKTAPAY_BASE_URL: string; ANALYTICS?: AnalyticsEngineDataset; VARIANT_INVENTORY?: DurableObjectNamespace },
  now: string = nowSql(),
): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, fixed: 0, abandoned: 0, errors: 0 };

  const staleCutoff = nowSql(new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000));
  const abandonedCutoff = nowSql(new Date(Date.now() - ABANDONED_THRESHOLD_HOURS * 60 * 60 * 1000));

  // First pass: auto-cancel orders stuck > 2h.
  const abandoned = await env.DB
    .prepare(
      `SELECT id FROM orders
       WHERE payment_status IN ('created','pending','processing')
         AND status IN ('pending_review','pending_payment')
         AND created_at < ?1
       LIMIT 50`,
    )
    .bind(abandonedCutoff)
    .all<{ id: string }>();
  for (const row of abandoned.results ?? []) {
    try {
      const reservations = await env.DB
        .prepare("SELECT variant_id, quantity FROM stock_reservations WHERE order_id = ?1 AND status = 'active'")
        .bind(row.id)
        .all<{ variant_id: string; quantity: number }>();
      const items = (reservations.results ?? []).map(r => ({ variantId: r.variant_id, qty: r.quantity }));
      if (items.length > 0) {
        await releaseReservedVariants(env, items, now);
      }
      await env.DB
        .prepare("UPDATE orders SET status = 'cancelled', updated_at = ?2 WHERE id = ?1")
        .bind(row.id, now)
        .run();
      await env.DB
        .prepare("UPDATE stock_reservations SET status = 'released', updated_at = ?2 WHERE order_id = ?1 AND status = 'active'")
        .bind(row.id, now)
        .run();
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
      console.error("[reconciliation] abandon error", err);
      result.errors += 1;
    }
  }

  // Second pass: check UddoktaPay for orders stuck > 30 min but < 2h.
  const stale = await env.DB
    .prepare(
      `SELECT o.id AS order_id, p.invoice_id, p.amount_paisa
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
    .all<{ order_id: string; invoice_id: string; amount_paisa: number }>();
  for (const row of stale.results ?? []) {
    result.checked += 1;
    try {
      const verified = await verifyUddoktaPayment(row.invoice_id, env.UDDOKTAPAY_API_KEY, env.UDDOKTAPAY_BASE_URL);
      if (verified.status === "paid") {
        // Mark the payment paid and let the next webhook re-process
        // idempotently (or do the lightweight inline fix here).
        await env.DB
          .prepare("UPDATE payments SET status = 'paid', verified_at = ?2, updated_at = ?2 WHERE invoice_id = ?1")
          .bind(row.invoice_id, now)
          .run();
        await env.DB
          .prepare("UPDATE orders SET payment_status = 'paid', updated_at = ?2 WHERE id = ?1")
          .bind(row.order_id, now)
          .run();
        result.fixed += 1;
        await trackMetric(env, {
          name: "payment_webhook_failures",
          doubles: { count: 1 },
          indexes: ["provider:uddoktapay", "recovered:true"],
        });
      }
    } catch (err) {
      console.error("[reconciliation] status check error", err);
      result.errors += 1;
    }
  }

  return result;
}
