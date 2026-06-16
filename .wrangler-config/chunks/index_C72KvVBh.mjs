globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { r as requireAuth, b as assertSuperAdminOnly, a as requirePermission, R as RbacError } from "./rbac_cfH-YcoZ.mjs";
import { b as writeCriticalAuditLog, u as userAgent, c as clientIp, w as writeAuditLog } from "./worker-entry_CjpE2ho_.mjs";
import { g as generateRandomHex, h as hmacSha256Hex } from "./security_CY3I9xIU.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
import { r as requireRecentStaffSession, C as CriticalAuthError } from "./critical-auth_D2TvZBIE.mjs";
const KEY_PREFIX = "zbk_";
const API_KEY_SCOPES = [
  "orders:create_assisted",
  "orders:read_own_integration",
  "stock:read_public",
  "media:upload_product_pending",
  "media:read_own",
  "webhooks:payment_status_read"
];
const API_KEY_SCOPE_SET = new Set(API_KEY_SCOPES);
class ApiKeyError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ApiKeyError";
  }
  status;
  code;
  toResponse() {
    return Response.json({ ok: false, code: this.code, error: this.message }, { status: this.status });
  }
}
function generateApiKey() {
  const raw = KEY_PREFIX + generateRandomHex(32);
  const prefix = raw.slice(0, 10);
  return { raw, prefix };
}
function normalizeApiKeyScopes(value) {
  if (!Array.isArray(value)) return [];
  const scopes = Array.from(new Set(value.filter((item) => typeof item === "string")));
  const unknown = scopes.filter((scope) => !API_KEY_SCOPE_SET.has(scope));
  if (unknown.length) {
    throw new ApiKeyError(400, "INVALID_API_SCOPE", `Unknown API key scope: ${unknown.join(", ")}`);
  }
  return scopes;
}
async function hashApiKey(rawKey, pepper) {
  if (!pepper) throw new ApiKeyError(500, "API_KEY_PEPPER_MISSING", "API key pepper is not configured");
  return hmacSha256Hex(rawKey, pepper);
}
const prerender = false;
async function GET(context) {
  const env = getEnv();
  let user;
  try {
    user = await requireAuth(context);
    assertSuperAdminOnly(user);
    requirePermission(user, "api_keys.read");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }
  const keys = await env.DB.prepare(
    `SELECT id, name, key_prefix, scopes_json, permissions, is_revoked, expires_at, revoked_at,
            allowed_ips_json, rate_limit_profile, environment, purpose, last_used_at, created_at
     FROM api_keys ORDER BY created_at DESC LIMIT 200`
  ).all();
  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "api_keys.list",
    entityType: "api_key",
    entityId: "all",
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });
  return Response.json({ ok: true, keys: keys.results ?? [] });
}
async function POST(context) {
  const env = getEnv();
  let user;
  try {
    user = await requireAuth(context);
    assertSuperAdminOnly(user);
    requirePermission(user, "api_keys.create");
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
  const name = (body.name ?? "").trim();
  if (!name) {
    return Response.json({ error: "Key name is required" }, { status: 400 });
  }
  const scopes = normalizeApiKeyScopes(body.scopes ?? body.permissions ?? []);
  const expiresAt = typeof body.expires_at === "string" && body.expires_at.trim() ? body.expires_at.trim() : null;
  const purpose = typeof body.purpose === "string" ? body.purpose.trim().slice(0, 500) : "";
  const environment = body.environment === "staging" ? "staging" : "prod";
  const allowedIps = Array.isArray(body.allowed_ips) ? body.allowed_ips.filter((item) => typeof item === "string" && item.length <= 64) : [];
  if (!scopes.length) {
    return Response.json({ ok: false, code: "MISSING_SCOPES", message: "At least one API key scope is required.", allowed_scopes: API_KEY_SCOPES }, { status: 400 });
  }
  const { raw, prefix } = generateApiKey();
  let keyHash;
  try {
    keyHash = await hashApiKey(raw, env.API_KEY_PEPPER);
  } catch (err) {
    if (err instanceof ApiKeyError) return err.toResponse();
    throw err;
  }
  const scopesJson = JSON.stringify(scopes);
  const now = nowSql();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO api_keys (
      id, name, key_prefix, key_hash, permissions, scopes_json, expires_at, allowed_ips_json,
      rate_limit_profile, environment, purpose, scope_version, created_by, created_at, updated_at
    )
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, 'strict', ?8, ?9, 1, ?10, ?11, ?11)`
  ).bind(id, name, prefix, keyHash, scopesJson, expiresAt, JSON.stringify(allowedIps), environment, purpose, user.id, now).run();
  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "api_keys.create",
    entityType: "api_key",
    entityId: id,
    metadata: { name, prefix, scopes, expires_at: expiresAt, allowed_ips: allowedIps, environment, purpose },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });
  return Response.json({
    ok: true,
    key: { id, name, key: raw, prefix },
    warning: "Store the raw key securely. It will not be shown again."
  }, { status: 201 });
}
async function DELETE(context) {
  const env = getEnv();
  let user;
  try {
    user = await requireAuth(context);
    assertSuperAdminOnly(user);
    requirePermission(user, "api_keys.revoke");
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
  const keyId = (body.id ?? "").trim();
  if (!keyId) {
    return Response.json({ error: "Key ID is required" }, { status: 400 });
  }
  const now = nowSql();
  await env.DB.prepare(
    `UPDATE api_keys SET is_revoked = 1, revoked_at = ?2, updated_at = ?2 WHERE id = ?1`
  ).bind(keyId, now).run();
  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "api_keys.revoke",
    entityType: "api_key",
    entityId: keyId,
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });
  return Response.json({ ok: true });
}
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  DELETE,
  GET,
  POST,
  prerender
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
