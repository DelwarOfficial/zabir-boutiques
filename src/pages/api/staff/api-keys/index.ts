import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, assertSuperAdminOnly, requirePermission, RbacError } from '../../../../lib/rbac';
import { writeAuditLog, writeCriticalAuditLog, clientIp, userAgent } from '../../../../lib/audit';
import { generateApiKey, hashApiKey, normalizeApiKeyScopes, ApiKeyError, API_KEY_SCOPES } from '../../../../lib/api-keys';
import { nowSql } from '../../../../lib/dates';
import { requireRecentStaffSession, CriticalAuthError } from '../../../../lib/critical-auth';

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let user;
  try {
    user = await requireAuth(context);
    assertSuperAdminOnly(user);
    requirePermission(user, 'api_keys.read');
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
    action: 'api_keys.list',
    entityType: 'api_key',
    entityId: 'all',
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });

  return Response.json({ ok: true, keys: keys.results ?? [] });
}

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let user;
  try {
    user = await requireAuth(context);
    assertSuperAdminOnly(user);
    requirePermission(user, 'api_keys.create');
    await requireRecentStaffSession(context, user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    if (err instanceof CriticalAuthError) return err.toResponse();
    throw err;
  }

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  if (!name) {
    return Response.json({ error: 'Key name is required' }, { status: 400 });
  }

  const scopes = normalizeApiKeyScopes(body.scopes ?? body.permissions ?? []);
  const expiresAt = typeof body.expires_at === 'string' && body.expires_at.trim() ? body.expires_at.trim() : null;
  const purpose = typeof body.purpose === 'string' ? body.purpose.trim().slice(0, 500) : '';
  const environment = body.environment === 'staging' ? 'staging' : 'prod';
  const allowedIps = Array.isArray(body.allowed_ips)
    ? body.allowed_ips.filter((item: unknown): item is string => typeof item === 'string' && item.length <= 64)
    : [];

  if (!scopes.length) {
    return Response.json({ ok: false, code: 'MISSING_SCOPES', message: 'At least one API key scope is required.', allowed_scopes: API_KEY_SCOPES }, { status: 400 });
  }

  const { raw, prefix } = generateApiKey();
  let keyHash: string;
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
    action: 'api_keys.create',
    entityType: 'api_key',
    entityId: id,
    metadata: { name, prefix, scopes, expires_at: expiresAt, allowed_ips: allowedIps, environment, purpose },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });

  return Response.json({
    ok: true,
    key: { id, name, key: raw, prefix },
    warning: 'Store the raw key securely. It will not be shown again.'
  }, { status: 201 });
}

export async function DELETE(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let user;
  try {
    user = await requireAuth(context);
    assertSuperAdminOnly(user);
    requirePermission(user, 'api_keys.revoke');
    await requireRecentStaffSession(context, user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    if (err instanceof CriticalAuthError) return err.toResponse();
    throw err;
  }

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const keyId = (body.id ?? '').trim();
  if (!keyId) {
    return Response.json({ error: 'Key ID is required' }, { status: 400 });
  }

  const now = nowSql();
  await env.DB.prepare(
    `UPDATE api_keys SET is_revoked = 1, revoked_at = ?2, updated_at = ?2 WHERE id = ?1`
  ).bind(keyId, now).run();

  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'api_keys.revoke',
    entityType: 'api_key',
    entityId: keyId,
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });

  return Response.json({ ok: true });
}
