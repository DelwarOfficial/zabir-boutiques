import type { APIContext } from 'astro';
import { getEnv } from '../../../../../lib/env';
import { requireAuth, assertSuperAdminOnly, RbacError } from '../../../../../lib/rbac';

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

  const role = await env.DB.prepare(`SELECT id, name, display_name FROM roles WHERE id = ?1`).bind(id).first<any>();
  if (!role) return Response.json({ ok: false, code: 'NOT_FOUND', error: 'Role not found' }, { status: 404 });

  const staff = await env.DB.prepare(
    `SELECT id, email, phone, full_name, role, is_active, last_login_at, created_at
     FROM staff_users WHERE role = ?1
     ORDER BY is_active DESC, full_name ASC`
  ).bind(role.name).all<any>();

  return Response.json({ ok: true, role, staff: staff.results ?? [] });
}
