globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { checkFraudBD, decideFraudRisk } from "./fraud_BFITCOJK.mjs";
import { n as normalizeBangladeshPhone } from "./phone_DlB2NzV4.mjs";
import { r as requireAuth, a as requirePermission, R as RbacError, i as isOwnerTier } from "./rbac_cfH-YcoZ.mjs";
import { w as writeAuditLog, u as userAgent, c as clientIp } from "./worker-entry_CjpE2ho_.mjs";
const prerender = false;
async function POST(context) {
  const env = getEnv();
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "fraud.override");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }
  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const phoneResult = normalizeBangladeshPhone(body.phone ?? "");
  if (!phoneResult.ok) {
    const message = phoneResult.reason === "EMPTY" ? "Missing phone" : "Invalid Bangladeshi mobile number. Enter 11 digits starting with 01X.";
    return Response.json({ error: message }, { status: 400 });
  }
  const { score, rawResponse } = await checkFraudBD(phoneResult.local, env.FRAUDBD_API_KEY);
  const decision = decideFraudRisk(score);
  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "fraud.check",
    entityType: "fraud_check",
    entityId: phoneResult.phone,
    metadata: { score, decision },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });
  const payload = { ok: true, score, decision };
  if (isOwnerTier(user.role)) payload.rawResponse = rawResponse;
  return Response.json(payload);
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
