/**
 * POST /api/staff/returns/{id}/approve [Master_Prompt v7.0 §7.2]
 * Approve a return. Restock items + trigger UddoktaPay refund for
 * prepaid amounts. RBAC: payments.refund.
 */
export const prerender = false;

import type { APIContext } from "astro";
import { getEnv } from "../../../../../lib/env";
import { nowSql } from "../../../../../lib/dates";
import { requireAuth, requirePermission, RbacError } from "../../../../../lib/rbac";
import { writeAuditLog, clientIp, userAgent } from "../../../../../lib/audit";
import { canTransition } from "../../../../../lib/order-state-machine";
import { doSyncFromD1 } from "../../../../../lib/do-client";
import { verifyUddoktaPayment } from "../../../../../lib/payments";

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
  if (rr.status !== "pending") return Response.json({ ok: false, code: "ALREADY_PROCESSED" }, { status: 409 });

  const order = await env.DB
    .prepare("SELECT id, status, payment_status, total_paisa, advance_paisa FROM orders WHERE id = ?1")
    .bind(rr.order_id)
    .first<{ id: string; status: string; payment_status: string; total_paisa: number; advance_paisa: number }>();
  if (!order) return Response.json({ ok: false, code: "ORDER_NOT_FOUND" }, { status: 404 });
  if (!canTransition(order.status as Parameters<typeof canTransition>[0], "returned")) {
    return Response.json({ ok: false, code: "INVALID_ORDER_TRANSITION", current: order.status }, { status: 409 });
  }

  // Restock: for each item, increment inventory_items.quantity.
  const items = JSON.parse(rr.items_json) as Array<{ variant_id: string; quantity: number }>;
  if (items.length > 0) {
    const stmts = items.map(it =>
      env.DB.prepare(
        `UPDATE inventory_items
         SET quantity = quantity + ?1, updated_at = ?2
         WHERE variant_id = ?3`,
      ).bind(it.quantity, now, it.variant_id),
    );
    await env.DB.batch(stmts, { atomic: true });
    // Log to stock_adjustments (audit trail).
    for (const it of items) {
      await env.DB
        .prepare(
          `INSERT INTO stock_adjustments (id, variant_id, delta, reason, adjusted_by, created_at)
           VALUES (?1, ?2, ?3, 'return_approved', ?4, ?5)`,
        )
        .bind(crypto.randomUUID(), it.variant_id, it.quantity, user.id, now)
        .run();
    }
    // Sync DOs.
    if (env.VARIANT_INVENTORY) {
      for (const it of items) {
        const row = await env.DB
          .prepare("SELECT quantity, reserved_quantity FROM inventory_items WHERE variant_id = ?1")
          .bind(it.variant_id)
          .first<{ quantity: number; reserved_quantity: number }>();
        if (row) await doSyncFromD1(env, it.variant_id, row.quantity, row.reserved_quantity);
      }
    }
  }

  // Refund: query UddoktaPay for the most recent payment on this order;
  // for now we record the refund intent (UddoktaPay refund API is a
  // follow-up — see docs/dr.md). Refund amount = advance + any paid
  // amount beyond the COD balance.
  const payment = await env.DB
    .prepare("SELECT id, invoice_id, amount_paisa, status FROM payments WHERE order_id = ?1 ORDER BY created_at DESC LIMIT 1")
    .bind(rr.order_id)
    .first<{ id: string; invoice_id: string; amount_paisa: number; status: string }>();
  let refundAmount = 0;
  if (payment && payment.status === "paid") {
    refundAmount = payment.amount_paisa;
    // Server-to-server verify to confirm the payment was actually settled.
    const verified = await verifyUddoktaPayment(payment.invoice_id, env.UDDOKTAPAY_API_KEY, env.UDDOKTAPAY_BASE_URL);
    if (verified.status !== "paid") {
      return Response.json({ ok: false, code: "REFUND_FAILED_PAYMENT_UNVERIFIED" }, { status: 409 });
    }
    // Initiate refund via UddoktaPay refund endpoint (POST {base}/api/refund-payment).
    try {
      const r = await fetch(`${env.UDDOKTAPAY_BASE_URL}/api/refund-payment`, {
        method: "POST",
        headers: { "RT-UDDOKTAPAY-API-KEY": env.UDDOKTAPAY_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: payment.invoice_id, amount: (refundAmount / 100).toFixed(2), reason: "return_approved" }),
      });
      if (!r.ok) {
        return Response.json({ ok: false, code: "REFUND_API_FAILED", status: r.status }, { status: 502 });
      }
    } catch (err) {
      return Response.json({ ok: false, code: "REFUND_API_ERROR", error: err instanceof Error ? err.message : "unknown" }, { status: 502 });
    }
  }

  // Mark return approved + transition order to 'returned'.
  await env.DB
    .prepare("UPDATE return_requests SET status = 'approved', refund_amount_paisa = ?2, reviewed_by = ?3, updated_at = ?4 WHERE id = ?1")
    .bind(id, refundAmount, user.id, now)
    .run();
  await env.DB
    .prepare("UPDATE orders SET status = 'returned', updated_at = ?2 WHERE id = ?1")
    .bind(rr.order_id, now)
    .run();
  await env.DB
    .prepare("INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, created_at) VALUES (?1, ?2, ?3, 'returned', ?4, ?5)")
    .bind(crypto.randomUUID(), rr.order_id, order.status, user.id, now)
    .run();

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "return.approve",
    entityType: "return_request",
    entityId: id,
    metadata: { order_id: rr.order_id, restock_count: items.length, refund_paisa: refundAmount },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });
  return Response.json({ ok: true, refund_paisa: refundAmount });
}
