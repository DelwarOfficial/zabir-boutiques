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

  const url = new URL(context.request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
  const action = (url.searchParams.get('action') || '').trim();
  const actorId = (url.searchParams.get('actor_id') || '').trim();
  const entityType = (url.searchParams.get('entity_type') || '').trim();
  const entityId = (url.searchParams.get('entity_id') || '').trim();
  const dateFrom = (url.searchParams.get('date_from') || '').trim();
  const dateTo = (url.searchParams.get('date_to') || '').trim();

  const where: string[] = [];
  const bindings: unknown[] = [];

  if (action) { where.push('al.action = ?'); bindings.push(action); }
  if (actorId) { where.push('al.actor_staff_id = ?'); bindings.push(actorId); }
  if (entityType) { where.push('al.entity_type = ?'); bindings.push(entityType); }
  if (entityId) { where.push('al.entity_id = ?'); bindings.push(entityId); }
  if (dateFrom) { where.push('al.created_at >= ?'); bindings.push(dateFrom + ' 00:00:00'); }
  if (dateTo) { where.push('al.created_at <= ?'); bindings.push(dateTo + ' 23:59:59'); }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM audit_log al ${whereClause}`
  ).bind(...bindings).first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const entries = await env.DB.prepare(
    `SELECT al.id, al.actor_staff_id, al.actor_role, al.action, al.entity_type,
            al.entity_id, al.metadata_json, al.ip_address, al.created_at,
            al.previous_hash, al.chain_hash,
            s.full_name as actor_name
     FROM audit_log al
     LEFT JOIN staff_users s ON s.id = al.actor_staff_id
     ${whereClause}
     ORDER BY al.created_at DESC, al.rowid DESC
     LIMIT ? OFFSET ?`
  ).bind(...bindings, limit, (page - 1) * limit).all<any>();

  return Response.json({
    ok: true,
    entries: entries.results ?? [],
    total,
    page,
    totalPages,
  });
}
