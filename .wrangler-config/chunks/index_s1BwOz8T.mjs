globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
import { r as requireAuth, a as requirePermission, R as RbacError } from "./rbac_cfH-YcoZ.mjs";
import { w as writeAuditLog, u as userAgent, c as clientIp } from "./worker-entry_CjpE2ho_.mjs";
const prerender = false;
async function POST(context) {
  const env = getEnv();
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "orders.update");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }
  const body = await context.request.json().catch(() => ({}));
  if (!body.order_id || !body.items?.length || !body.reason) {
    return Response.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const now = nowSql();
  await env.DB.prepare(
    `INSERT INTO return_requests (id, order_id, items_json, reason, status, refund_amount_paisa, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'pending', 0, ?5, ?5)`
  ).bind(id, body.order_id, JSON.stringify(body.items), body.reason, now).run();
  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "return.create",
    entityType: "return_request",
    entityId: id,
    metadata: { order_id: body.order_id, item_count: body.items.length },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });
  return Response.json({ ok: true, id }, { status: 201 });
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
