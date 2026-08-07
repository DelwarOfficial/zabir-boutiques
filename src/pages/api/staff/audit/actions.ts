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

  const rows = await env.DB.prepare(
    `SELECT DISTINCT action, COUNT(*) as count
     FROM audit_log
     GROUP BY action
     ORDER BY count DESC
     LIMIT 100`
  ).all<{ action: string; count: number }>();

  const types = rows.results?.map(r => ({ action: r.action, count: r.count })) ?? [];

  return Response.json({ ok: true, types });
}
