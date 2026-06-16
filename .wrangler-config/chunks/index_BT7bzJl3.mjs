globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { r as requireAuth, c as assertOwnerOnly, R as RbacError } from "./rbac_cfH-YcoZ.mjs";
import { a as assertPaisa } from "./money_DWLDQpFs.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
import { b as writeCriticalAuditLog, u as userAgent, c as clientIp } from "./worker-entry_CjpE2ho_.mjs";
import { r as requireRecentStaffSession, C as CriticalAuthError } from "./critical-auth_D2TvZBIE.mjs";
const prerender = false;
const ALLOWED_FIXED_AMOUNTS = [5e3, 1e4, 15e3, 2e4];
async function GET(context) {
  const env = getEnv();
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
  const coupons = await env.DB.prepare(
    `SELECT id, code, discount_type, discount_amount_paisa, discount_percent,
            max_discount_paisa, min_order_paisa, usage_limit, used_count,
            starts_at, expires_at, is_active, created_by, created_at
     FROM coupons ORDER BY created_at DESC LIMIT 100`
  ).all();
  return Response.json({ ok: true, coupons: coupons.results ?? [] });
}
async function POST(context) {
  const env = getEnv();
  const now = nowSql();
  let user;
  try {
    user = await requireAuth(context);
    assertOwnerOnly(user);
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
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code || code.length < 3 || code.length > 30) {
    return Response.json({ ok: false, code: "INVALID_CODE", message: "Coupon code must be 3-30 characters." }, { status: 400 });
  }
  const discountAmountPaisa = Number(body.discount_amount_paisa);
  if (!ALLOWED_FIXED_AMOUNTS.includes(discountAmountPaisa)) {
    return Response.json({
      ok: false,
      code: "INVALID_AMOUNT",
      message: `Fixed coupon amount must be one of: ${ALLOWED_FIXED_AMOUNTS.map((a) => `৳${a / 100}`).join(", ")}`
    }, { status: 400 });
  }
  assertPaisa(discountAmountPaisa, "discount_amount_paisa");
  const usageLimit = body.usage_limit != null ? Number(body.usage_limit) : null;
  const minOrderPaisa = body.min_order_paisa != null ? assertPaisa(Number(body.min_order_paisa), "min_order_paisa") : 0;
  const startsAt = body.starts_at ?? null;
  const expiresAt = body.expires_at ?? null;
  const couponId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO coupons (id, code, discount_type, discount_amount_paisa, discount_percent,
                            max_discount_paisa, min_order_paisa, usage_limit, used_count,
                            starts_at, expires_at, is_active, created_by, created_at, updated_at)
       VALUES (?1, ?2, 'fixed', ?3, NULL, NULL, ?4, ?5, 0, ?6, ?7, 1, ?8, ?9, ?9)`
    ).bind(
      couponId,
      code,
      discountAmountPaisa,
      minOrderPaisa,
      usageLimit,
      startsAt,
      expiresAt,
      user.id,
      now
    ).run();
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed: coupons.code")) {
      return Response.json({ ok: false, code: "CODE_EXISTS", message: "This coupon code already exists." }, { status: 409 });
    }
    throw err;
  }
  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "coupon.create",
    entityType: "coupon",
    entityId: couponId,
    metadata: { code, discount_amount_paisa: discountAmountPaisa, usage_limit: usageLimit },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });
  return Response.json({ ok: true, coupon_id: couponId, code }, { status: 201 });
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
