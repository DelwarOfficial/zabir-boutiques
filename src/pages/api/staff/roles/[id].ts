import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, assertSuperAdminOnly, RbacError } from '../../../../lib/rbac';
import { nowSql } from '../../../../lib/dates';
import { writeCriticalAuditLog, clientIp, userAgent } from '../../../../lib/audit';

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  let user;
  try {
    user = await requireAuth(context);
    assertSuperAdminOnly(user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const { id } = context.params;
  if (!id) return Response.json({ ok: false, code: 'MISSING_ID', error: 'Role ID required' }, { status: 400 });

  const role = await env.DB.prepare(
    `SELECT r.*,
       (SELECT COUNT(*) FROM staff_users WHERE role = r.name) as staff_count
     FROM roles r WHERE r.id = ?1`
  ).bind(id).first<any>();

  if (!role) return Response.json({ ok: false, code: 'NOT_FOUND', error: 'Role not found' }, { status: 404 });

  const permRows = await env.DB.prepare(
    `SELECT permission FROM role_permissions WHERE role_id = ?1 ORDER BY permission`
  ).bind(id).all<{ permission: string }>();

  role.permissions = (permRows.results ?? []).map(r => r.permission);
  role.is_system = !!role.is_system;

  return Response.json({ ok: true, role });
}

export async function PUT(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let user;
  try {
    user = await requireAuth(context);
    assertSuperAdminOnly(user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const { id } = context.params;
  if (!id) return Response.json({ ok: false, code: 'MISSING_ID', error: 'Role ID required' }, { status: 400 });

  const existing = await env.DB.prepare(`SELECT id, is_system FROM roles WHERE id = ?1`).bind(id).first<any>();
  if (!existing) return Response.json({ ok: false, code: 'NOT_FOUND', error: 'Role not found' }, { status: 404 });

  let body: any;
  try { body = await context.request.json(); } catch {
    return Response.json({ ok: false, code: 'INVALID_JSON', error: 'Invalid JSON body' }, { status: 400 });
  }

  const display_name = typeof body.display_name === 'string' ? body.display_name.trim() : undefined;
  const description = typeof body.description === 'string' ? body.description.trim() : body.description === null ? null : undefined;

  if (display_name !== undefined && (display_name.length < 2 || display_name.length > 100)) {
    return Response.json({ ok: false, code: 'INVALID_DISPLAY_NAME', error: 'Display name must be 2-100 characters.' }, { status: 400 });
  }

  const updates: string[] = [];
  const bindings: any[] = [];

  if (display_name !== undefined) { updates.push('display_name = ?'); bindings.push(display_name); }
  if (description !== undefined) { updates.push('description = ?'); bindings.push(description); }

  if (updates.length === 0) {
    return Response.json({ ok: false, code: 'NO_CHANGES', error: 'No fields to update.' }, { status: 400 });
  }

  updates.push('updated_by = ?');
  bindings.push(user.id);
  updates.push('updated_at = ?');
  bindings.push(now);
  bindings.push(id);

  await env.DB.prepare(
    `UPDATE roles SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...bindings).run();

  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'role.update',
    entityType: 'role',
    entityId: id,
    metadata: { display_name, description },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({ ok: true });
}

export async function DELETE(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  let user;
  try {
    user = await requireAuth(context);
    assertSuperAdminOnly(user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const { id } = context.params;
  if (!id) return Response.json({ ok: false, code: 'MISSING_ID', error: 'Role ID required' }, { status: 400 });

  const existing = await env.DB.prepare(
    `SELECT id, name, is_system FROM roles WHERE id = ?1`
  ).bind(id).first<any>();

  if (!existing) return Response.json({ ok: false, code: 'NOT_FOUND', error: 'Role not found' }, { status: 404 });
  if (existing.is_system) {
    return Response.json({ ok: false, code: 'SYSTEM_ROLE', error: 'System roles cannot be deleted.' }, { status: 403 });
  }

  const staffCount = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM staff_users WHERE role = ?1`
  ).bind(existing.name).first<{ c: number }>();

  if (staffCount && staffCount.c > 0) {
    return Response.json({ ok: false, code: 'HAS_STAFF', error: `Cannot delete role: ${staffCount.c} staff user(s) are assigned to it.` }, { status: 409 });
  }

  await env.DB.prepare(`DELETE FROM role_permissions WHERE role_id = ?1`).bind(id).run();
  await env.DB.prepare(`DELETE FROM roles WHERE id = ?1`).bind(id).run();

  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'role.delete',
    entityType: 'role',
    entityId: id,
    metadata: { name: existing.name },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({ ok: true });
}
