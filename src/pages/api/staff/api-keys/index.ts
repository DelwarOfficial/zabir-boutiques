export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, assertOwnerOnly, requirePermission, RbacError } from '../../../../lib/rbac';
import { writeAuditLog, clientIp, userAgent } from '../../../../lib/audit';
import { generateApiKey, hashApiKey } from '../../../../lib/api-keys';
import { nowSql } from '../../../../lib/dates';

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let user;
  try {
    user = await requireAuth(context);
    assertOwnerOnly(user);
    requirePermission(user, 'system.api_code.manage');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const keys = await env.DB.prepare(
    `SELECT id, name, key_prefix, permissions, is_revoked, last_used_at, created_at
     FROM api_keys ORDER BY created_at DESC`
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
    assertOwnerOnly(user);
    requirePermission(user, 'system.api_code.manage');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
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

  const { raw, prefix, hash } = generateApiKey();
  const keyHash = await hashApiKey(raw);
  const permissions = JSON.stringify(body.permissions ?? []);
  const now = nowSql();
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO api_keys (id, name, key_prefix, key_hash, permissions, created_by, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`
  ).bind(id, name, prefix, keyHash, permissions, user.id, now).run();

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'api_keys.create',
    entityType: 'api_key',
    entityId: id,
    metadata: { name, prefix },
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
    assertOwnerOnly(user);
    requirePermission(user, 'system.api_code.manage');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
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
    `UPDATE api_keys SET is_revoked = 1, updated_at = ?2 WHERE id = ?1`
  ).bind(keyId, now).run();

  await writeAuditLog(env.DB, {
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
