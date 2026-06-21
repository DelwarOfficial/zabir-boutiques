/**
 * GET /api/staff/settings — list all site settings (settings.manage permission required)
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { requireAuth, requirePermission } from '../../../lib/rbac';

export async function GET(context: APIContext): Promise<Response> {
  const user = await requireAuth(context);
  requirePermission(user, 'settings.manage');

  const env = getEnv(context);
  const rows = await env.DB.prepare(
    `SELECT key, value, type, label, description, group_name, sort_order
     FROM site_settings
     ORDER BY group_name, sort_order, key`
  ).all<{ key: string; value: string; type: string; label: string; description: string; group_name: string; sort_order: number }>();

  return Response.json({ ok: true, settings: rows.results || [] });
}
