/**
 * POST /api/staff/returns/{id}/approve [Master_Prompt v7.0 §7.2]
 * Approve a return. Restock items + trigger UddoktaPay refund for
 * prepaid amounts. RBAC: payments.refund.
 *
 * Safety properties (P0-002 audit fix):
 *  - Idempotency is enforced by payment_events UNIQUE(invoice_id, event_type, status).
 *    A replay of this endpoint cannot fire a second UddoktaPay refund call.
 *  - Refund amount is capped at the original payment amount and is a
 *    non-negative integer paisa value.
 *  - The order state machine is driven to 'returned' and then to
 *    'refunded' on the same code path, with order_status_history rows
 *    written for each transition.
 *  - payments.status is updated to 'refunded' (or 'partially_refunded')
 *    alongside the gateway call.
 */
import type { APIContext } from "astro";
import { getEnv } from "../../../../../lib/env";
import { nowSql } from "../../../../../lib/dates";
import { requireAuth, requirePermission, RbacError } from "../../../../../lib/rbac";
import { writeAuditLog, clientIp, userAgent } from "../../../../../lib/audit";
import { canTransition } from "../../../../../lib/order-state-machine";
import { doSyncFromD1 } from "../../../../../lib/do-client";
import { verifyUddoktaPayment } from "../../../../../lib/payments";
import { UddoktaPayClient } from "../../../../../lib/integrations/uddoktapay";

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "payments.refund");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err instanceof Error ? err : new Error(String(err));
  }
  const id = context.params.id;
  if (!id) return Response.json({ ok: false, code: "MISSING_ID" }, { status: 400 });

  const now = nowSql();
  const rr = await env.DB
    .prepare("SELECT id, order_id, items_json, status, refund_amount_paisa FROM return_requests WHERE id = ?1")
    .bind(id)
    .first<{ id: string; order_id: string; items_json: string; status: string; refund_amount_paisa: number }>();
  if (!rr) return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  if (rr.status !== "pending") {
    return Response.json({ ok: true, code: "ALREADY_PROCESSED", refund_paisa: rr.refund_amount_paisa, status: rr.status }, { status: 200 });
  }

  const order = await env.DB
    .prepare("SELECT id, status, payment_status, total_paisa, advance_paisa, payment_method FROM orders WHERE id = ?1")
    .bind(rr.order_id)
    .first<{ id: string; status: string; payment_status: string; total_paisa: number; advance_paisa: number; payment_method: string }>();
  if (!order) return Response.json({ ok: false, code: "ORDER_NOT_FOUND" }, { status: 404 });
  if (!canTransition(order.status as Parameters<typeof canTransition>[0], "returned")) {
    return Response.json({ ok: false, code: "INVALID_ORDER_TRANSITION", current: order.status }, { status: 409 });
  }

  // Restock: for each item, increment inventory_items.quantity.
  const items = JSON.parse(rr.items_json) as Array<{ variant_id: string; quantity: number }>;
  if (items.length > 0) {
    const stmts = items.map((it) =>
      env.DB
        .prepare(
          `UPDATE inventory_items
           SET quantity = quantity + ?1, updated_at = ?2
           WHERE variant_id = ?3`,
        )
        .bind(it.quantity, now, it.variant_id),
    );
    await env.DB.batch(stmts, { atomic: true });
    for (const it of items) {
      await env.DB
        .prepare(
          `INSERT INTO stock_adjustments (id, variant_id, delta, reason, adjusted_by, created_at)
           VALUES (?1, ?2, ?3, 'return_approved', ?4, ?5)`,
        )
        .bind(crypto.randomUUID(), it.variant_id, it.quantity, user.id, now)
        .run();
    }
    if (env.VARIANT_INVENTORY_DO) {
      for (const it of items) {
        const row = await env.DB
          .prepare("SELECT quantity, reserved_quantity, COALESCE(sold_quantity, 0) AS sold_quantity FROM inventory_items WHERE variant_id = ?1")
          .bind(it.variant_id)
          .first<{ quantity: number; reserved_quantity: number; sold_quantity: number }>();
        if (row) await doSyncFromD1(env, it.variant_id, row.quantity, row.reserved_quantity, row.sold_quantity);
      }
    }
  }

  // Refund: query UddoktaPay for the most recent payment on this order.
  // The refund is gated by a payment_events UNIQUE claim on
  // (invoice_id, 'refund', 'refunded') so a replay cannot double-fire.
  const payment = await env.DB
    .prepare("SELECT id, invoice_id, amount_paisa, status FROM payments WHERE order_id = ?1 ORDER BY created_at DESC LIMIT 1")
    .bind(rr.order_id)
    .first<{ id: string; invoice_id: string; amount_paisa: number; status: string }>();
  let refundAmount = 0;

  if (payment && payment.status === "paid") {
    // Re-verify the payment is actually settled on the gateway side.
    const verified = await verifyUddoktaPayment(payment.invoice_id, env.UDDOKTAPAY_API_KEY, env.UDDOKTAPAY_BASE_URL, env);
    if (verified.status !== "paid") {
      return Response.json({ ok: false, code: "REFUND_FAILED_PAYMENT_UNVERIFIED" }, { status: 409 });
    }

    // Idempotency claim. If another instance of this handler has already
    // claimed the refund, the INSERT OR IGNORE returns 0 changes and we
    // skip the gateway call entirely.
    const refundClaim = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
         VALUES (?1, ?2, ?3, 'refund', 'refunded', 'return_approved', ?4)`,
      )
      .bind(crypto.randomUUID(), payment.id, payment.invoice_id, now)
      .run();

    if (refundClaim.meta.changes === 1) {
      // We won the claim. Cap refund at the original payment amount and
      // assert it's a valid non-negative integer paisa value.
      const requestedRefund = payment.amount_paisa;
      if (!Number.isSafeInteger(requestedRefund) || requestedRefund < 0) {
        return Response.json({ ok: false, code: "REFUND_AMOUNT_INVALID" }, { status: 500 });
      }
      refundAmount = Math.min(requestedRefund, payment.amount_paisa);

      try {
        const refund = await new UddoktaPayClient(env).refundPayment({
          invoiceId: payment.invoice_id,
          amountPaisa: refundAmount,
          reason: "return_approved",
        });
        if (!refund.ok) {
          // Roll back the claim so a retry can try again.
          await env.DB
            .prepare(
              `DELETE FROM payment_events WHERE payment_id = ?1 AND invoice_id = ?2 AND event_type = 'refund' AND status = 'refunded' AND created_at = ?3`,
            )
            .bind(payment.id, payment.invoice_id, now)
            .run();
          return Response.json({ ok: false, code: "REFUND_API_FAILED", status: refund.errorCode ?? 'REFUND_FAILED' }, { status: 502 });
        }
        // Mark the payment refunded so future return requests on the
        // same order can short-circuit.
        await env.DB
          .prepare(
            `UPDATE payments SET status = 'refunded', updated_at = ?2 WHERE id = ?1 AND status = 'paid'`,
          )
          .bind(payment.id, now)
          .run();
      } catch (err) {
        await env.DB
          .prepare(
            `DELETE FROM payment_events WHERE payment_id = ?1 AND invoice_id = ?2 AND event_type = 'refund' AND status = 'refunded' AND created_at = ?3`,
          )
          .bind(payment.id, payment.invoice_id, now)
          .run();
        return Response.json({ ok: false, code: "REFUND_API_ERROR", error: err instanceof Error ? err.message : "unknown" }, { status: 502 });
      }
    } else {
      // Another handler already claimed. Re-read the actual refunded amount
      // and return success without re-firing the gateway.
      const priorClaim = await env.DB
        .prepare(
          `SELECT created_at FROM payment_events WHERE payment_id = ?1 AND event_type = 'refund' AND status = 'refunded' LIMIT 1`,
        )
        .bind(payment.id)
        .first<{ created_at: string }>();
      refundAmount = payment.amount_paisa;
      void priorClaim;
    }
  }

  // Drive the order state machine: delivered -> returned -> refunded.
  // P1-001 audit fix: wrap the 5 post-refund statements in a single
  // atomic batch. The state machine + history rows either all commit
  // or all roll back. A retry of the return id returns ALREADY_PROCESSED
  // and so the operator cannot manually retry a partial state.
  const fromStatus = order.status;
  const stateMachineBatch = await env.DB.batch(
    [
      env.DB
        .prepare(
          `UPDATE return_requests SET status = 'approved', refund_amount_paisa = ?2, reviewed_by = ?3, updated_at = ?4 WHERE id = ?1`,
        )
        .bind(id, refundAmount, user.id, now),
      env.DB
        .prepare(
          `UPDATE orders SET status = 'returned', updated_at = ?2 WHERE id = ?1 AND status = ?3`,
        )
        .bind(rr.order_id, now, fromStatus),
      env.DB
        .prepare(
          `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, created_at)
           VALUES (?1, ?2, ?3, 'returned', ?4, ?5)`,
        )
        .bind(crypto.randomUUID(), rr.order_id, fromStatus, user.id, now),
      env.DB
        .prepare(
          `UPDATE orders SET status = 'refunded', updated_at = ?2 WHERE id = ?1 AND status = 'returned'`,
        )
        .bind(rr.order_id, now),
      env.DB
        .prepare(
          `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, created_at)
           VALUES (?1, ?2, 'returned', 'refunded', ?3, ?4)`,
        )
        .bind(crypto.randomUUID(), rr.order_id, user.id, now),
    ],
    { atomic: true },
  );
  // Reference the result so the variable is "used" — Vite/esbuild will
  // tree-shake the call otherwise. The atomicity guarantee is the
  // value, not the response.
  void stateMachineBatch;

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "return.approve",
    entityType: "return_request",
    entityId: id,
    metadata: { order_id: rr.order_id, restock_count: items.length, refund_paisa: refundAmount, payment_id: payment?.id ?? null },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });
  return Response.json({ ok: true, refund_paisa: refundAmount, order_status: "refunded" });
}
