globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
import { r as requireAuth, a as requirePermission, R as RbacError } from "./rbac_cfH-YcoZ.mjs";
import { g as doSyncFromD1, v as verifyUddoktaPayment, w as writeAuditLog, u as userAgent, c as clientIp } from "./worker-entry_CjpE2ho_.mjs";
const TRANSITIONS = {
  pending_review: [
    { to: "staff_confirmed", effects: ["send_email_confirmed"] },
    { to: "pending_payment", effects: [] },
    { to: "cancelled", effects: ["restock", "send_email_cancelled"] }
  ],
  pending_payment: [
    { to: "payment_verified", effects: ["send_email_confirmed"] },
    { to: "cancelled", effects: ["restock", "send_email_cancelled"] }
  ],
  payment_verified: [
    { to: "staff_confirmed", effects: ["send_email_confirmed"] },
    { to: "paid_over_allocated", effects: [] },
    { to: "cancelled", effects: ["restock", "refund_full", "send_email_cancelled"] }
  ],
  paid_over_allocated: [
    { to: "staff_confirmed", effects: ["send_email_confirmed"] },
    { to: "cancelled", effects: ["restock", "refund_full", "send_email_cancelled"] }
  ],
  staff_confirmed: [
    { to: "packing", effects: [] },
    { to: "cancelled", effects: ["restock", "refund_full", "send_email_cancelled"] }
  ],
  packing: [
    { to: "shipped", effects: ["send_email_shipped"] },
    { to: "cancelled", effects: ["restock", "refund_full", "send_email_cancelled"] }
  ],
  shipped: [
    { to: "delivered", effects: ["send_email_delivered"] },
    { to: "returned", effects: [] }
  ],
  delivered: [
    { to: "returned", effects: ["send_email_returned"] }
  ],
  returned: [
    { to: "refunded", effects: ["restock", "refund_partial", "send_email_returned"] }
  ],
  cancelled: [],
  // terminal
  refunded: []
  // terminal
};
function canTransition(from, to) {
  return TRANSITIONS[from]?.some((rule) => rule.to === to) ?? false;
}
const prerender = false;
async function POST(context) {
  const env = getEnv();
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
  const rr = await env.DB.prepare("SELECT id, order_id, items_json, status, refund_amount_paisa FROM return_requests WHERE id = ?1").bind(id).first();
  if (!rr) return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  if (rr.status !== "pending") return Response.json({ ok: false, code: "ALREADY_PROCESSED" }, { status: 409 });
  const order = await env.DB.prepare("SELECT id, status, payment_status, total_paisa, advance_paisa FROM orders WHERE id = ?1").bind(rr.order_id).first();
  if (!order) return Response.json({ ok: false, code: "ORDER_NOT_FOUND" }, { status: 404 });
  if (!canTransition(order.status, "returned")) {
    return Response.json({ ok: false, code: "INVALID_ORDER_TRANSITION", current: order.status }, { status: 409 });
  }
  const items = JSON.parse(rr.items_json);
  if (items.length > 0) {
    const stmts = items.map(
      (it) => env.DB.prepare(
        `UPDATE inventory_items
         SET quantity = quantity + ?1, updated_at = ?2
         WHERE variant_id = ?3`
      ).bind(it.quantity, now, it.variant_id)
    );
    await env.DB.batch(stmts, { atomic: true });
    for (const it of items) {
      await env.DB.prepare(
        `INSERT INTO stock_adjustments (id, variant_id, delta, reason, adjusted_by, created_at)
           VALUES (?1, ?2, ?3, 'return_approved', ?4, ?5)`
      ).bind(crypto.randomUUID(), it.variant_id, it.quantity, user.id, now).run();
    }
    if (env.VARIANT_INVENTORY) {
      for (const it of items) {
        const row = await env.DB.prepare("SELECT quantity, reserved_quantity FROM inventory_items WHERE variant_id = ?1").bind(it.variant_id).first();
        if (row) await doSyncFromD1(env, it.variant_id, row.quantity, row.reserved_quantity);
      }
    }
  }
  const payment = await env.DB.prepare("SELECT id, invoice_id, amount_paisa, status FROM payments WHERE order_id = ?1 ORDER BY created_at DESC LIMIT 1").bind(rr.order_id).first();
  let refundAmount = 0;
  if (payment && payment.status === "paid") {
    refundAmount = payment.amount_paisa;
    const verified = await verifyUddoktaPayment(payment.invoice_id, env.UDDOKTAPAY_API_KEY, env.UDDOKTAPAY_BASE_URL);
    if (verified.status !== "paid") {
      return Response.json({ ok: false, code: "REFUND_FAILED_PAYMENT_UNVERIFIED" }, { status: 409 });
    }
    try {
      const r = await fetch(`${env.UDDOKTAPAY_BASE_URL}/api/refund-payment`, {
        method: "POST",
        headers: { "RT-UDDOKTAPAY-API-KEY": env.UDDOKTAPAY_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: payment.invoice_id, amount: (refundAmount / 100).toFixed(2), reason: "return_approved" })
      });
      if (!r.ok) {
        return Response.json({ ok: false, code: "REFUND_API_FAILED", status: r.status }, { status: 502 });
      }
    } catch (err) {
      return Response.json({ ok: false, code: "REFUND_API_ERROR", error: err instanceof Error ? err.message : "unknown" }, { status: 502 });
    }
  }
  await env.DB.prepare("UPDATE return_requests SET status = 'approved', refund_amount_paisa = ?2, reviewed_by = ?3, updated_at = ?4 WHERE id = ?1").bind(id, refundAmount, user.id, now).run();
  await env.DB.prepare("UPDATE orders SET status = 'returned', updated_at = ?2 WHERE id = ?1").bind(rr.order_id, now).run();
  await env.DB.prepare("INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, created_at) VALUES (?1, ?2, ?3, 'returned', ?4, ?5)").bind(crypto.randomUUID(), rr.order_id, order.status, user.id, now).run();
  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "return.approve",
    entityType: "return_request",
    entityId: id,
    metadata: { order_id: rr.order_id, restock_count: items.length, refund_paisa: refundAmount },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });
  return Response.json({ ok: true, refund_paisa: refundAmount });
}
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  POST,
  prerender
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
