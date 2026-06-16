globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
import { r as requireAuth, a as requirePermission, R as RbacError, e as canConfirmOrder } from "./rbac_cfH-YcoZ.mjs";
import { w as writeAuditLog, u as userAgent, c as clientIp, b as writeCriticalAuditLog } from "./worker-entry_CjpE2ho_.mjs";
const prerender = false;
async function POST(context) {
  const env = getEnv();
  const orderId = context.params.id;
  const now = nowSql();
  if (!orderId) return Response.json({ error: "Missing order ID" }, { status: 400 });
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "orders.confirm");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }
  const order = await env.DB.prepare(
    `SELECT id, status, payment_status, fraud_decision FROM orders WHERE id = ?1`
  ).bind(orderId).first();
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  if (!canConfirmOrder(user.role, order.fraud_decision)) {
    await writeAuditLog(env.DB, {
      actorStaffId: user.id,
      actorRole: user.role,
      action: "orders.confirm_denied_fraud",
      entityType: "order",
      entityId: orderId,
      metadata: { reason: "fraud_blocked", order_status: order.status },
      ipAddress: clientIp(context.request),
      userAgent: userAgent(context.request)
    });
    return Response.json(
      { ok: false, code: "FRAUD_BLOCKED", error: "Order is fraud-blocked and cannot be confirmed without fraud override." },
      { status: 403 }
    );
  }
  if (order.status === "pending_review" || order.status === "pending_payment") {
    const reservations = await env.DB.prepare(
      `SELECT id, variant_id, quantity FROM stock_reservations
       WHERE order_id = ?1 AND status = 'active'`
    ).bind(orderId).all();
    if (reservations.results && reservations.results.length > 0) {
      const deductStmts = reservations.results.map(
        (r) => env.DB.prepare(
          `UPDATE inventory_items
           SET reserved_quantity = reserved_quantity - ?1,
               quantity = quantity - ?1,
               updated_at = ?3
           WHERE variant_id = ?2 AND reserved_quantity >= ?1 AND quantity >= ?1`
        ).bind(r.quantity, r.variant_id, now)
      );
      const confirmStmts = reservations.results.map(
        (r) => env.DB.prepare(
          `UPDATE stock_reservations SET status = 'confirmed', updated_at = ?2 WHERE id = ?1`
        ).bind(r.id, now)
      );
      await env.DB.batch([...deductStmts, ...confirmStmts], { atomic: true });
    }
    await env.DB.prepare(
      `UPDATE orders SET status = 'staff_confirmed', updated_at = ?2 WHERE id = ?1`
    ).bind(orderId, now).run();
  } else {
    await env.DB.prepare(
      `UPDATE orders SET status = 'staff_confirmed', updated_at = ?2 WHERE id = ?1`
    ).bind(orderId, now).run();
  }
  await env.DB.prepare(
    `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, created_at)
     VALUES (?1, ?2, ?3, 'staff_confirmed', ?4, ?5)`
  ).bind(crypto.randomUUID(), orderId, order.status, user.id, now).run();
  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "orders.confirm",
    entityType: "order",
    entityId: orderId,
    metadata: { from_status: order.status, to_status: "staff_confirmed" },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });
  return Response.json({ ok: true, status: "staff_confirmed" }, { status: 200 });
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
