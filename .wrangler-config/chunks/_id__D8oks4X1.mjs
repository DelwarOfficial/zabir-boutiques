globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { r as requireAuth, c as assertOwnerOnly, R as RbacError } from "./rbac_cfH-YcoZ.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
import { b as writeCriticalAuditLog, u as userAgent, c as clientIp } from "./worker-entry_CjpE2ho_.mjs";
import { r as requireRecentStaffSession, C as CriticalAuthError } from "./critical-auth_D2TvZBIE.mjs";
const prerender = false;
async function PATCH(context) {
  const env = getEnv();
  const couponId = context.params.id;
  const now = nowSql();
  if (!couponId) return Response.json({ error: "Missing coupon ID" }, { status: 400 });
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
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const isActive = body.is_active === true ? 1 : body.is_active === false ? 0 : null;
  if (isActive === null) {
    return Response.json({ ok: false, code: "INVALID_ACTION", message: "Provide is_active: true or false." }, { status: 400 });
  }
  const result = await env.DB.prepare(
    `UPDATE coupons SET is_active = ?2, updated_at = ?3 WHERE id = ?1`
  ).bind(couponId, isActive, now).run();
  if (result.meta.changes !== 1) {
    return Response.json({ ok: false, code: "NOT_FOUND", message: "Coupon not found." }, { status: 404 });
  }
  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: isActive ? "coupon.activate" : "coupon.deactivate",
    entityType: "coupon",
    entityId: couponId,
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });
  return Response.json({ ok: true, is_active: isActive === 1 });
}
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  PATCH,
  prerender
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
