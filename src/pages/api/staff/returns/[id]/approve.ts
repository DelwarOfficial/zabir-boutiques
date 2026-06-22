/**
 * POST /api/staff/returns/{id}/approve [Master_Prompt v7.0 §7.2]
 * Approve a return. Restock items and trigger UddoktaPay refund for
 * prepaid amounts. RBAC: payments.refund.
 */
import type { APIContext } from "astro";
import { getEnv } from "../../../../../lib/env";
import { nowSql } from "../../../../../lib/dates";
import { requireAuth, requirePermission, RbacError } from "../../../../../lib/rbac";
import { prepareAuditLogInsert, clientIp, userAgent } from "../../../../../lib/audit";
import { canTransition } from "../../../../../lib/order-state-machine";
import { doSyncFromD1 } from "../../../../../lib/do-client";
import { verifyUddoktaPayment } from "../../../../../lib/payments";
import { UddoktaPayClient } from "../../../../../lib/integrations/uddoktapay";

interface ReturnItem {
  variant_id: string;
  quantity: number;
}

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

  let items: ReturnItem[];
  try {
    items = JSON.parse(rr.items_json) as ReturnItem[];
  } catch {
    return Response.json({ ok: false, code: "INVALID_RETURN_ITEMS" }, { status: 500 });
  }

  if (items.length > 0) {
    const restockStatements = items.flatMap((item) => [
      env.DB.prepare(
        `UPDATE inventory_items
         SET quantity = quantity + ?1, updated_at = ?2
         WHERE variant_id = ?3`,
      ).bind(item.quantity, now, item.variant_id),
      env.DB.prepare(
        `INSERT INTO stock_adjustments (id, variant_id, delta, reason, adjusted_by, created_at)
         VALUES (?1, ?2, ?3, 'return_approved', ?4, ?5)`,
      ).bind(crypto.randomUUID(), item.variant_id, item.quantity, user.id, now),
    ]);
    const restockResults = await env.DB.batch(restockStatements, { atomic: true });
    const failedRestock = restockResults.find((result, index) => index % 2 === 0 && result.meta.changes !== 1);
    if (failedRestock) {
      return Response.json({ ok: false, code: "RESTOCK_FAILED" }, { status: 409 });
    }

    if (env.VARIANT_INVENTORY_DO) {
      for (const item of items) {
        const row = await env.DB
          .prepare("SELECT quantity, reserved_quantity, COALESCE(sold_quantity, 0) AS sold_quantity FROM inventory_items WHERE variant_id = ?1")
          .bind(item.variant_id)
          .first<{ quantity: number; reserved_quantity: number; sold_quantity: number }>();
        if (row) await doSyncFromD1(env, item.variant_id, row.quantity, row.reserved_quantity, row.sold_quantity);
      }
    }
  }

  const payment = await env.DB
    .prepare("SELECT id, invoice_id, amount_paisa, status FROM payments WHERE order_id = ?1 ORDER BY created_at DESC LIMIT 1")
    .bind(rr.order_id)
    .first<{ id: string; invoice_id: string; amount_paisa: number; status: string }>();
  let refundAmount = 0;

  if (payment && payment.status === "paid") {
    const verified = await verifyUddoktaPayment(payment.invoice_id, env.UDDOKTAPAY_API_KEY, env.UDDOKTAPAY_BASE_URL, env);
    if (verified.status !== "paid") {
      return Response.json({ ok: false, code: "REFUND_FAILED_PAYMENT_UNVERIFIED" }, { status: 409 });
    }

    const refundClaim = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
         VALUES (?1, ?2, ?3, 'refund', 'refunded', 'return_approved', ?4)`,
      )
      .bind(crypto.randomUUID(), payment.id, payment.invoice_id, now)
      .run();

    if (refundClaim.meta.changes === 1) {
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
          await deleteRefundClaim(env.DB, payment.id, payment.invoice_id, now);
          return Response.json({ ok: false, code: "REFUND_API_FAILED", status: refund.errorCode ?? "REFUND_FAILED" }, { status: 502 });
        }
        await env.DB
          .prepare("UPDATE payments SET status = 'refunded', updated_at = ?2 WHERE id = ?1 AND status = 'paid'")
          .bind(payment.id, now)
          .run();
      } catch (err) {
        await deleteRefundClaim(env.DB, payment.id, payment.invoice_id, now);
        return Response.json({ ok: false, code: "REFUND_API_ERROR", error: err instanceof Error ? err.message : "unknown" }, { status: 502 });
      }
    } else {
      refundAmount = payment.amount_paisa;
    }
  }

  const fromStatus = order.status;
  const auditStmt = await prepareAuditLogInsert(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "return.approve",
    entityType: "return_request",
    entityId: id,
    metadata: { order_id: rr.order_id, restock_count: items.length, refund_paisa: refundAmount, payment_id: payment?.id ?? null },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  }, now);

  const stateResults = await env.DB.batch([
    env.DB.prepare(
      "UPDATE return_requests SET status = 'approved', refund_amount_paisa = ?2, reviewed_by = ?3, updated_at = ?4 WHERE id = ?1 AND status = 'pending'",
    ).bind(id, refundAmount, user.id, now),
    env.DB.prepare(
      "UPDATE orders SET status = 'returned', updated_at = ?2 WHERE id = ?1 AND status = ?3",
    ).bind(rr.order_id, now, fromStatus),
    env.DB.prepare(
      `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, created_at)
       VALUES (?1, ?2, ?3, 'returned', ?4, ?5)`,
    ).bind(crypto.randomUUID(), rr.order_id, fromStatus, user.id, now),
    env.DB.prepare(
      "UPDATE orders SET status = 'refunded', updated_at = ?2 WHERE id = ?1 AND status = 'returned'",
    ).bind(rr.order_id, now),
    env.DB.prepare(
      `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, created_at)
       VALUES (?1, ?2, 'returned', 'refunded', ?3, ?4)`,
    ).bind(crypto.randomUUID(), rr.order_id, user.id, now),
    auditStmt,
  ], { atomic: true });

  if (stateResults[0].meta.changes !== 1 || stateResults[1].meta.changes !== 1 || stateResults[3].meta.changes !== 1) {
    return Response.json({ ok: false, code: "STATE_MACHINE_COMMIT_FAILED" }, { status: 500 });
  }

  return Response.json({ ok: true, refund_paisa: refundAmount, order_status: "refunded" });
}

async function deleteRefundClaim(db: D1Database, paymentId: string, invoiceId: string, createdAt: string): Promise<void> {
  await db
    .prepare("DELETE FROM payment_events WHERE payment_id = ?1 AND invoice_id = ?2 AND event_type = 'refund' AND status = 'refunded' AND created_at = ?3")
    .bind(paymentId, invoiceId, createdAt)
    .run();
}
