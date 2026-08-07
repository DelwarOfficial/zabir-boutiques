import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, RbacError, requirePermission } from '../../../../lib/rbac';

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'system.audit.view');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const { id } = context.params;
  if (!id) return Response.json({ ok: false, code: 'MISSING_ID', error: 'Audit entry ID required' }, { status: 400 });

  const entry = await env.DB.prepare(
    `SELECT al.*, s.full_name as actor_name
     FROM audit_log al
     LEFT JOIN staff_users s ON s.id = al.actor_staff_id
     WHERE al.id = ?1`
  ).bind(id).first<any>();

  if (!entry) return Response.json({ ok: false, code: 'NOT_FOUND', error: 'Audit entry not found' }, { status: 404 });

  // Decode metadata for convenience
  let metadata: unknown = null;
  if (entry.metadata_json) {
    try { metadata = JSON.parse(entry.metadata_json); } catch { metadata = entry.metadata_json; }
  }

  return Response.json({
    ok: true,
    entry: {
      ...entry,
      metadata,
    },
  });
}
