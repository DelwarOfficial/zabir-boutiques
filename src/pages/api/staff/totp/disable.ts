import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requireRole, RbacError } from '../../../../lib/rbac';
import { writeAuditLog } from '../../../../lib/audit';

export async function POST(context: APIContext): Promise<Response> {
  let user;
  try {
    user = await requireAuth(context);
    requireRole(user, ['owner']);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const env = getEnv(context);
  await env.DB.prepare(
    `UPDATE staff_users SET totp_secret = NULL, totp_required = 0 WHERE id = ?1`,
  ).bind(user.id).run();

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'totp.disabled',
    entityType: 'staff_user',
    entityId: user.id,
  });

  return Response.json({ ok: true });
}