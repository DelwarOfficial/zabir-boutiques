globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { r as requireAuth, R as RbacError } from "./rbac_cfH-YcoZ.mjs";
import { v as verifyPassword, l as legacyHashPassword } from "./password_oS77SVcG.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
import { w as writeAuditLog, u as userAgent, c as clientIp } from "./worker-entry_CjpE2ho_.mjs";
const prerender = false;
async function POST(context) {
  const env = getEnv();
  let user;
  try {
    user = await requireAuth(context);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }
  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const password = body.password ?? "";
  if (!password) {
    return Response.json({ error: "Password is required" }, { status: 400 });
  }
  const staff = await env.DB.prepare(
    `SELECT password_hash, password_salt FROM staff_users WHERE id = ?1 AND is_active = 1`
  ).bind(user.id).first();
  if (!staff) {
    return Response.json({ error: "Account not found or inactive" }, { status: 401 });
  }
  let valid = false;
  if (staff.password_salt) {
    valid = await verifyPassword(password, staff.password_hash, staff.password_salt, env.PASSWORD_PEPPER);
  } else {
    const legacyHash = await legacyHashPassword(password, env.SESSION_SECRET);
    valid = staff.password_hash === legacyHash;
  }
  if (!valid) {
    await writeAuditLog(env.DB, {
      actorStaffId: user.id,
      actorRole: user.role,
      action: "staff.step_up.failed",
      entityType: "staff_session",
      entityId: user.sessionId,
      ipAddress: clientIp(context.request),
      userAgent: userAgent(context.request)
    });
    return Response.json({ error: "Invalid password" }, { status: 401 });
  }
  const now = nowSql();
  await env.DB.prepare(
    `UPDATE staff_sessions SET last_active_at = ?1 WHERE id = ?2 AND staff_user_id = ?3`
  ).bind(now, user.sessionId, user.id).run();
  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "staff.step_up.success",
    entityType: "staff_session",
    entityId: user.sessionId,
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
