globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { r as requireAuth, a as requirePermission, R as RbacError, b as assertSuperAdminOnly } from "./rbac_cfH-YcoZ.mjs";
import { w as writeAuditLog, u as userAgent, c as clientIp, b as writeCriticalAuditLog } from "./worker-entry_CjpE2ho_.mjs";
import { r as requireRecentStaffSession, C as CriticalAuthError } from "./critical-auth_D2TvZBIE.mjs";
const prerender = false;
const SECRET_KEY_NAMES = [
  "SESSION_SECRET",
  "TINIFY_API_KEY",
  "UDDOKTAPAY_API_KEY",
  "UDDOKTAPAY_BASE_URL",
  "FRAUDBD_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "API_KEY_PEPPER",
  "AUDIT_LEDGER_SECRET"
];
async function GET(context) {
  const env = getEnv();
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "api_code.read");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }
  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "system.api_code.view",
    entityType: "system",
    entityId: "api-code",
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });
  return Response.json({
    ok: true,
    secret_key_names: SECRET_KEY_NAMES,
    note: "Secret values are configured in Cloudflare and never returned by this endpoint."
  });
}
async function POST(context) {
  const env = getEnv();
  let user;
  try {
    user = await requireAuth(context);
    assertSuperAdminOnly(user);
    requirePermission(user, "api_code.update");
    await requireRecentStaffSession(context, user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    if (err instanceof CriticalAuthError) return err.toResponse();
    throw err;
  }
  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "system.api_code.update",
    entityType: "system",
    entityId: "api-code",
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });
  return Response.json({ ok: true });
}
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  GET,
  POST,
  prerender
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
