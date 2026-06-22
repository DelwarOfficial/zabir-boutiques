import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, assertSuperAdminOnly, RbacError } from '../../../../lib/rbac';
import { nowSql } from '../../../../lib/dates';
import { writeCriticalAuditLog, clientIp, userAgent } from '../../../../lib/audit';
import { requireRecentStaffSession, CriticalAuthError } from '../../../../lib/critical-auth';

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
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

  const roles = await env.DB.prepare(
    `SELECT r.*,
       (SELECT COUNT(*) FROM staff_users WHERE role = r.name) as staff_count
     FROM roles r
     ORDER BY r.is_system DESC, r.name ASC`
  ).all<any>();

  const permRows = await env.DB.prepare(
    `SELECT role_id, permission FROM role_permissions ORDER BY role_id, permission`
  ).all<{ role_id: string; permission: string }>();

  const permMap = new Map<string, string[]>();
  for (const row of (permRows.results ?? [])) {
    const list = permMap.get(row.role_id);
    if (list) list.push(row.permission);
    else permMap.set(row.role_id, [row.permission]);
  }

  const result = (roles.results ?? []).map((r: any) => ({
    ...r,
    permissions: permMap.get(r.id) ?? [],
    is_system: !!r.is_system,
  }));

  return Response.json({ ok: true, roles: result });
}

export async function POST(context: APIContext): Promise<Response> {
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

  let body: any;
  try { body = await context.request.json(); } catch {
    return Response.json({ ok: false, code: 'INVALID_JSON', error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase().replace(/\s+/g, '_') : '';
  if (!name || name.length < 2 || name.length > 50) {
    return Response.json({ ok: false, code: 'INVALID_NAME', error: 'Role name must be 2-50 characters.' }, { status: 400 });
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    return Response.json({ ok: false, code: 'INVALID_NAME', error: 'Role name must start with a letter and contain only lowercase letters, numbers, and underscores.' }, { status: 400 });
  }

  const display_name = typeof body.display_name === 'string' ? body.display_name.trim() : name;
  if (display_name.length < 2 || display_name.length > 100) {
    return Response.json({ ok: false, code: 'INVALID_DISPLAY_NAME', error: 'Display name must be 2-100 characters.' }, { status: 400 });
  }

  const description = typeof body.description === 'string' ? body.description.trim() : null;
  const permissions = Array.isArray(body.permissions) ? body.permissions.filter((p: any) => typeof p === 'string') : [];

  const roleId = crypto.randomUUID();

  try {
    const insert = env.DB.prepare(
      `INSERT INTO roles (id, name, display_name, description, is_system, created_by, updated_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5, ?6, ?6)`
    ).bind(roleId, name, display_name, description, user.id, now);

    const stmts = [insert];
    if (permissions.length > 0) {
      for (const perm of permissions) {
        stmts.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO role_permissions (role_id, permission, assigned_by, assigned_at)
             VALUES (?1, ?2, ?3, ?4)`
          ).bind(roleId, perm, user.id, now)
        );
      }
    }

    await env.DB.batch(stmts, { atomic: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: roles.name')) {
      return Response.json({ ok: false, code: 'NAME_EXISTS', error: 'A role with this name already exists.' }, { status: 409 });
    }
    throw err;
  }

  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'role.create',
    entityType: 'role',
    entityId: roleId,
    metadata: { name, display_name, permission_count: permissions.length },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({ ok: true, role_id: roleId, name, display_name }, { status: 201 });
}
