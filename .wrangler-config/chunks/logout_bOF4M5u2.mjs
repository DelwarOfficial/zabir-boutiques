globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { hashSessionToken } from "./sessions_BoTS18Dm.mjs";
import { w as writeAuditLog, u as userAgent, c as clientIp } from "./worker-entry_CjpE2ho_.mjs";
const prerender = false;
async function POST(context) {
  const env = getEnv();
  const cookie = context.request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp("(?:^|;\\s*)(?:__Host-)?session=([^;]+)"));
  const sessionToken = match ? decodeURIComponent(match[1]) : null;
  if (sessionToken) {
    const tokenHash = await hashSessionToken(sessionToken, env.SESSION_SECRET);
    const session = await env.DB.prepare(
      `SELECT s.id AS session_id, s.staff_user_id, u.role
       FROM staff_sessions s JOIN staff_users u ON u.id = s.staff_user_id
       WHERE s.token_hash = ?1`
    ).bind(tokenHash).first();
    await env.DB.prepare(
      `UPDATE staff_sessions SET is_revoked = 1 WHERE token_hash = ?1`
    ).bind(tokenHash).run();
    if (session) {
      await writeAuditLog(env.DB, {
        actorStaffId: session.staff_user_id,
        actorRole: session.role,
        action: "staff.logout",
        entityType: "staff_session",
        entityId: session.session_id,
        ipAddress: clientIp(context.request),
        userAgent: userAgent(context.request)
      });
    }
  }
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", "__Host-session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
  headers.append("Set-Cookie", "session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
  headers.append("Set-Cookie", "__Host-csrf-token=; Secure; SameSite=Strict; Path=/; Max-Age=0");
  headers.append("Set-Cookie", "csrf-token=; Secure; SameSite=Strict; Path=/; Max-Age=0");
  return new Response(JSON.stringify({ ok: true }), {
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
