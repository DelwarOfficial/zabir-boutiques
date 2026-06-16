globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { generateSessionToken, hashSessionToken } from "./sessions_BoTS18Dm.mjs";
import { g as generateRandomHex, c as createCsrfToken } from "./security_CY3I9xIU.mjs";
import { v as verifyPassword, l as legacyHashPassword, h as hashPassword } from "./password_oS77SVcG.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
import { c as clientIp, w as writeAuditLog, u as userAgent } from "./worker-entry_CjpE2ho_.mjs";
import { n as normalizeBangladeshPhone } from "./phone_DlB2NzV4.mjs";
import { v as verifyTurnstile } from "./turnstile_DZLnxhOe.mjs";
const prerender = false;
async function POST(context) {
  const env = getEnv();
  const now = nowSql();
  let body = {};
  try {
    const contentType = context.request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await context.request.json();
    } else {
      const form = await context.request.formData();
      body = Object.fromEntries(form.entries());
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const identifier = body.identifier ?? body.email ?? body.phone ?? "";
  const password = body.password ?? "";
  if (!identifier || !password) {
    return Response.json({ error: "Email/phone and password required" }, { status: 400 });
  }
  if (env.TURNSTILE_SECRET_KEY) {
    const token = typeof body.turnstile === "string" ? body.turnstile : context.request.headers.get("CF-Turnstile-Token");
    if (token) {
      const r = await verifyTurnstile(env, token, clientIp(context.request) ?? void 0);
      if (!r.ok) {
        await writeAuditLog(env.DB, {
          actorStaffId: null,
          actorRole: null,
          action: "staff.login.turnstile_failed",
          entityType: "staff_session",
          entityId: identifier,
          ipAddress: clientIp(context.request),
          userAgent: userAgent(context.request)
        });
        return Response.json({ error: "Bot check failed." }, { status: 403 });
      }
    }
  }
  const candidates = [identifier];
  const phoneNormalized = normalizeBangladeshPhone(identifier);
  if (phoneNormalized.ok) {
    if (!candidates.includes(phoneNormalized.local)) candidates.push(phoneNormalized.local);
    if (!candidates.includes(phoneNormalized.phone)) candidates.push(phoneNormalized.phone);
  }
  const staff = await env.DB.prepare(
    `SELECT id, email, phone, password_hash, password_salt, full_name, role, is_active
     FROM staff_users
     WHERE (email IN (${candidates.map((_, i) => `?${i + 1}`).join(",")})
        OR phone IN (${candidates.map((_, i) => `?${candidates.length + i + 1}`).join(",")}))
       AND is_active = 1
     LIMIT 1`
  ).bind(...candidates, ...candidates).first();
  if (!staff) return Response.json({ error: "Invalid credentials" }, { status: 401 });
  if (staff.password_salt) {
    const valid = await verifyPassword(password, staff.password_hash, staff.password_salt, env.PASSWORD_PEPPER);
    if (!valid) return Response.json({ error: "Invalid credentials" }, { status: 401 });
  } else {
    const legacyHash = await legacyHashPassword(password, env.SESSION_SECRET);
    if (staff.password_hash !== legacyHash) return Response.json({ error: "Invalid credentials" }, { status: 401 });
    const newSalt = generateRandomHex(16);
    const newHash = await hashPassword(password, newSalt, env.PASSWORD_PEPPER);
    await env.DB.prepare(
      `UPDATE staff_users SET password_hash = ?2, password_salt = ?3 WHERE id = ?1`
    ).bind(staff.id, newHash, newSalt).run();
  }
  const sessionToken = generateSessionToken();
  const tokenHash = await hashSessionToken(sessionToken, env.SESSION_SECRET);
  const sessionId = crypto.randomUUID();
  const expiresAt = nowSql(new Date(Date.now() + 30 * 60 * 1e3));
  const absoluteExpiresAt = nowSql(new Date(Date.now() + 8 * 60 * 60 * 1e3));
  await env.DB.prepare(
    `INSERT INTO staff_sessions (id, staff_user_id, token_hash, is_revoked, expires_at, absolute_expires_at, last_active_at, created_at)
     VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?6)`
  ).bind(sessionId, staff.id, tokenHash, expiresAt, absoluteExpiresAt, now).run();
  await env.DB.prepare(
    `UPDATE staff_users SET last_login_at = ?2 WHERE id = ?1`
  ).bind(staff.id, now).run();
  await writeAuditLog(env.DB, {
    actorStaffId: staff.id,
    actorRole: staff.role,
    action: "staff.login",
    entityType: "staff_session",
    entityId: sessionId,
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });
  const csrfToken = await createCsrfToken(env.SESSION_SECRET);
  const headers = new Headers({ "Content-Type": "application/json" });
  const maxAge = 24 * 60 * 60;
  headers.append("Set-Cookie", `__Host-session=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
  headers.append("Set-Cookie", `__Host-csrf-token=${csrfToken}; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
  return new Response(JSON.stringify({ ok: true, staff: { id: staff.id, name: staff.full_name, role: staff.role } }), {
    status: 200,
    headers
  });
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
