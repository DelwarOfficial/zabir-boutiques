globalThis.process ??= {};
globalThis.process.env ??= {};
import { env } from "cloudflare:workers";
import { hashSessionToken } from "./sessions_BoTS18Dm.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
const VALID_STAFF_ROLES = /* @__PURE__ */ new Set([
  "super_admin",
  "owner",
  "manager",
  "salesman",
  "packing",
  "support",
  "developer",
  "auditor"
]);
function isValidStaffRole(value) {
  return typeof value === "string" && VALID_STAFF_ROLES.has(value);
}
const SUPER_ADMIN_ONLY = /* @__PURE__ */ new Set(["super_admin"]);
const BUSINESS_OWNER_TIER = /* @__PURE__ */ new Set(["super_admin", "owner"]);
const MANAGER_PERMS = [
  "products.manage",
  "categories.manage",
  "inventory.manage",
  "inventory.adjust",
  "orders.view",
  "orders.create",
  "orders.update",
  "orders.confirm",
  "orders.cancel",
  "orders.pack",
  "orders.ship",
  "fraud.view",
  "media.upload",
  "support.view",
  "support.note",
  "reports.view",
  "payments.view"
];
const SALESMAN_PERMS = [
  "orders.view",
  "orders.create",
  "orders.update",
  "support.note"
];
const PACKING_PERMS = [
  "orders.view",
  "orders.pack",
  "orders.ship"
];
const SUPPORT_PERMS = [
  "support.view",
  "support.note",
  "orders.view"
];
const DEVELOPER_PERMS = [
  "api_code.read"
];
const AUDITOR_PERMS = [
  "system.audit.view",
  "reports.view"
];
const OWNER_PERMS = [
  "staff.manage",
  "roles.manage",
  "settings.manage",
  "system.audit.view",
  "system.backup.manage",
  "products.manage",
  "categories.manage",
  "inventory.manage",
  "inventory.adjust",
  "orders.view",
  "orders.create",
  "orders.update",
  "orders.confirm",
  "orders.cancel",
  "orders.pack",
  "orders.ship",
  "fraud.view",
  "fraud.override",
  "media.upload",
  "support.view",
  "support.note",
  "reports.view",
  "payments.view",
  "payments.verify",
  "payments.refund",
  "api_code.read",
  "backups.read",
  "backups.download",
  "integrations.read"
];
const PERMISSION_MATRIX = {
  super_admin: /* @__PURE__ */ new Set(),
  // handled by isSuperAdmin short-circuit
  owner: new Set(OWNER_PERMS),
  manager: new Set(MANAGER_PERMS),
  salesman: new Set(SALESMAN_PERMS),
  packing: new Set(PACKING_PERMS),
  support: new Set(SUPPORT_PERMS),
  developer: new Set(DEVELOPER_PERMS),
  auditor: new Set(AUDITOR_PERMS)
};
class RbacError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "RbacError";
  }
  status;
  code;
  toResponse() {
    return Response.json({ ok: false, code: this.code, error: this.message }, { status: this.status });
  }
}
function isSuperAdmin(role) {
  return SUPER_ADMIN_ONLY.has(role);
}
function isOwnerTier(role) {
  return BUSINESS_OWNER_TIER.has(role);
}
function canConfirmOrder(role, fraudDecision) {
  if (fraudDecision === "blocked") return can(role, "fraud.override");
  return true;
}
function can(role, permission) {
  if (SUPER_ADMIN_ONLY.has(role)) return true;
  return PERMISSION_MATRIX[role]?.has(permission) ?? false;
}
function readSessionCookie(request) {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp("(?:^|;\\s*)(?:__Host-)?session=([^;]+)"));
  return match ? decodeURIComponent(match[1]) : null;
}
async function getCurrentStaffUser(context) {
  const locals = context.locals;
  if (locals?.staffUserResolved) return locals.staffUser ?? null;
  const env$1 = env;
  if (!env$1?.DB || !env$1.SESSION_SECRET) return null;
  const sessionToken = readSessionCookie(context.request);
  if (!sessionToken) return null;
  const tokenHash = await hashSessionToken(sessionToken, env$1.SESSION_SECRET);
  const now = nowSql();
  const row = await env$1.DB.prepare(
    `SELECT s.id AS session_id, s.staff_user_id, u.role, u.full_name, s.last_active_at
     FROM staff_sessions s
     JOIN staff_users u ON u.id = s.staff_user_id
     WHERE s.token_hash = ?1
       AND s.is_revoked = 0
       AND s.expires_at > ?2
       AND s.absolute_expires_at > ?2
       AND u.is_active = 1`
  ).bind(tokenHash, now).first();
  if (!row) return null;
  const lastActiveMs = Date.parse(row.last_active_at.replace(" ", "T") + "Z");
  if (Number.isFinite(lastActiveMs)) {
    const idleMs = Date.now() - lastActiveMs;
    if (idleMs > 30 * 60 * 1e3) {
      await env$1.DB.prepare("UPDATE staff_sessions SET is_revoked = 1, expires_at = ?2 WHERE id = ?1").bind(row.session_id, now).run();
      return null;
    }
  }
  env$1.DB.prepare("UPDATE staff_sessions SET last_active_at = ?2, expires_at = ?3 WHERE id = ?1").bind(row.session_id, now, nowSql(new Date(Date.now() + 30 * 60 * 1e3))).run().catch((err) => console.warn("[rbac] failed to refresh session last_active_at:", err));
  if (!isValidStaffRole(row.role)) {
    console.error("[rbac] Unknown staff_users.role value, rejecting session:", row.role);
    return null;
  }
  return {
    id: row.staff_user_id,
    role: row.role,
    fullName: row.full_name,
    sessionId: row.session_id
  };
}
async function requireAuth(context) {
  const user = await getCurrentStaffUser(context);
  if (!user) throw new RbacError(401, "UNAUTHENTICATED", "Authentication required");
  return user;
}
function requireRole(user, allowedRoles) {
  if (!allowedRoles.includes(user.role)) {
    throw new RbacError(403, "FORBIDDEN_ROLE", "Insufficient role");
  }
}
function requirePermission(user, permission) {
  if (!can(user.role, permission)) {
    throw new RbacError(403, "FORBIDDEN_PERMISSION", `Missing permission: ${permission}`);
  }
}
function assertSuperAdminOnly(user) {
  if (!isSuperAdmin(user.role)) {
    throw new RbacError(403, "SUPER_ADMIN_ONLY", "Super Admin access required for platform operations");
  }
}
function assertOwnerOnly(user) {
  if (!isOwnerTier(user.role)) {
    throw new RbacError(403, "OWNER_ONLY", "Owner / Super Admin access required");
  }
}
function assertSalesAccess(user) {
  requireRole(user, ["super_admin", "owner", "manager", "salesman"]);
}
function permissionsFor(role) {
  if (SUPER_ADMIN_ONLY.has(role)) return ["platform.full_access"];
  return Array.from(PERMISSION_MATRIX[role] ?? []);
}
export {
  RbacError as R,
  requirePermission as a,
  assertSuperAdminOnly as b,
  assertOwnerOnly as c,
  assertSalesAccess as d,
  canConfirmOrder as e,
  can as f,
  getCurrentStaffUser as g,
  isSuperAdmin as h,
  isOwnerTier as i,
  permissionsFor as p,
  requireAuth as r
};
