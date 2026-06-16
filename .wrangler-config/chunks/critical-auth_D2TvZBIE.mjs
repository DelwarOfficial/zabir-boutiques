globalThis.process ??= {};
globalThis.process.env ??= {};
import { env } from "cloudflare:workers";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
const STEP_UP_WINDOW_SECONDS = 10 * 60;
class CriticalAuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "CriticalAuthError";
  }
  status;
  code;
  toResponse() {
    return Response.json({ ok: false, code: this.code, error: this.message }, { status: this.status });
  }
}
async function requireRecentStaffSession(context, user) {
  const env$1 = env;
  if (!env$1.DB) throw new CriticalAuthError(500, "DB_UNAVAILABLE", "Database unavailable");
  const row = await env$1.DB.prepare(
    `SELECT last_active_at FROM staff_sessions
     WHERE id = ?1 AND staff_user_id = ?2 AND is_revoked = 0`
  ).bind(user.sessionId, user.id).first();
  if (!row) throw new CriticalAuthError(401, "SESSION_NOT_FOUND", "Session is no longer active");
  const lastActive = Date.parse(`${row.last_active_at.replace(" ", "T")}Z`);
  if (!Number.isFinite(lastActive)) {
    throw new CriticalAuthError(403, "STEP_UP_REQUIRED", "Recent staff authentication required");
  }
  const ageSeconds = (Date.now() - lastActive) / 1e3;
  if (ageSeconds > STEP_UP_WINDOW_SECONDS) {
    throw new CriticalAuthError(403, "STEP_UP_REQUIRED", "Recent staff authentication required for this critical operation");
  }
  await env$1.DB.prepare(
    `UPDATE staff_sessions SET last_active_at = ?1 WHERE id = ?2`
  ).bind(nowSql(), user.sessionId).run();
}
export {
  CriticalAuthError as C,
  requireRecentStaffSession as r
};
