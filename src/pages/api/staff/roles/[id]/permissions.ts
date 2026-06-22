import type { APIContext } from 'astro';
import { getEnv } from '../../../../../lib/env';
import { requireAuth, assertSuperAdminOnly, RbacError } from '../../../../../lib/rbac';
import { nowSql } from '../../../../../lib/dates';
import { writeCriticalAuditLog, clientIp, userAgent } from '../../../../../lib/audit';
import { requireRecentStaffSession, CriticalAuthError } from '../../../../../lib/critical-auth';
import { getAllPermissions } from '../../../../../types/rbac';

export async function PUT(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let user;
  try {
    user = await requireAuth(context);
    assertSuperAdminOnly(user);
    await requireRecentStaffSession(context, user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    if (err instanceof CriticalAuthError) return err.toResponse();
    throw err;
  }

  const { id } = context.params;
  if (!id) return Response.json({ ok: false, code: 'MISSING_ID', error: 'Role ID required' }, { status: 400 });

  const existing = await env.DB.prepare(`SELECT id, name, is_system FROM roles WHERE id = ?1`).bind(id).first<any>();
  if (!existing) return Response.json({ ok: false, code: 'NOT_FOUND', error: 'Role not found' }, { status: 404 });

  let body: any;
  try { body = await context.request.json(); } catch {
    return Response.json({ ok: false, code: 'INVALID_JSON', error: 'Invalid JSON body' }, { status: 400 });
  }

  const permissions = Array.isArray(body.permissions) ? body.permissions.filter((p: any) => typeof p === 'string') : [];
  const validPerms = new Set(getAllPermissions());
  const invalid = permissions.filter((p: string) => !validPerms.has(p));
  if (invalid.length > 0) {
    return Response.json({
      ok: false, code: 'INVALID_PERMISSIONS',
      error: `Unknown permissions: ${invalid.join(', ')}`,
    }, { status: 400 });
  }

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM role_permissions WHERE role_id = ?1`).bind(id),
    ...permissions.map((perm: string) =>
      env.DB.prepare(
        `INSERT INTO role_permissions (role_id, permission, assigned_by, assigned_at)
         VALUES (?1, ?2, ?3, ?4)`
      ).bind(id, perm, user.id, now)
    ),
  ], { atomic: true });

  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'role.permissions.update',
    entityType: 'role',
    entityId: id,
    metadata: { permissions, count: permissions.length },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({ ok: true, permissions });
}
