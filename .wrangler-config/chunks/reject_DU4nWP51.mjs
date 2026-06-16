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
    throw err instanceof Error ? err : new Error(String(err));
  }
  const id = context.params.id;
  if (!id) return Response.json({ ok: false, code: "MISSING_ID" }, { status: 400 });
  const now = nowSql();
  const result = await env.DB.prepare("UPDATE return_requests SET status = 'rejected', reviewed_by = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'pending'").bind(id, user.id, now).run();
  if (result.meta.changes !== 1) return Response.json({ ok: false, code: "NOT_FOUND_OR_RESOLVED" }, { status: 404 });
  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "return.reject",
    entityType: "return_request",
    entityId: id,
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });
  return Response.json({ ok: true });
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
