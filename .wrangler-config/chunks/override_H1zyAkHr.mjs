globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { r as requireAuth, c as assertOwnerOnly, R as RbacError } from "./rbac_cfH-YcoZ.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
import { b as writeCriticalAuditLog, u as userAgent, c as clientIp } from "./worker-entry_CjpE2ho_.mjs";
import { r as requireRecentStaffSession, C as CriticalAuthError } from "./critical-auth_D2TvZBIE.mjs";
const prerender = false;
const DECISIONS = /* @__PURE__ */ new Set(["approved", "review", "blocked"]);
async function POST(context) {
  const env = getEnv();
  const now = nowSql();
  let user;
  try {
    user = await requireAuth(context);
    assertOwnerOnly(user);
    await requireRecentStaffSession(context, user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    if (err instanceof CriticalAuthError) return err.toResponse();
    throw err;
  }
  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ ok: false, code: "INVALID_JSON", message: "Invalid JSON body" }, { status: 400 });
  }
  const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
  const nextDecision = typeof body.decision === "string" ? body.decision.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!orderId) return Response.json({ ok: false, code: "MISSING_ORDER_ID", message: "Missing order_id" }, { status: 400 });
  if (!DECISIONS.has(nextDecision)) return Response.json({ ok: false, code: "INVALID_DECISION", message: "Decision must be approved, review, or blocked." }, { status: 400 });
  if (reason.length < 12 || reason.length > 500) {
    return Response.json({ ok: false, code: "INVALID_REASON", message: "Override reason must be 12-500 characters." }, { status: 400 });
  }
  const order = await env.DB.prepare(
    `SELECT id, fraud_decision, status FROM orders WHERE id = ?1`
  ).bind(orderId).first();
  if (!order) return Response.json({ ok: false, code: "ORDER_NOT_FOUND", message: "Order not found." }, { status: 404 });
  if (order.fraud_decision === nextDecision) {
    return Response.json({ ok: true, order_id: orderId, decision: nextDecision, unchanged: true });
  }
  await env.DB.prepare(
    `UPDATE orders SET fraud_decision = ?2, updated_at = ?3 WHERE id = ?1`
  ).bind(orderId, nextDecision, now).run();
  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "fraud.override",
    entityType: "order",
    entityId: orderId,
    metadata: {
      from_decision: order.fraud_decision,
      to_decision: nextDecision,
      order_status: order.status,
      reason
    },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });
  return Response.json({ ok: true, order_id: orderId, decision: nextDecision });
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
