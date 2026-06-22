/**
 * GET /api/staff/settings — list site settings (settings.manage permission required)
 * Platform-group settings are only returned for super_admin.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { requireAuth, requirePermission, isSuperAdmin } from '../../../lib/rbac';

export async function GET(context: APIContext): Promise<Response> {
  const user = await requireAuth(context);
  requirePermission(user, 'settings.manage');

  const env = getEnv(context);
  const rows = await env.DB.prepare(
    `SELECT key, value, type, label, description, group_name, sort_order
     FROM site_settings
     ORDER BY group_name, sort_order, key`
  ).all<{ key: string; value: string; type: string; label: string; description: string; group_name: string; sort_order: number }>();

  const settings = isSuperAdmin(user.role)
    ? (rows.results || [])
    : (rows.results || []).filter(s => s.group_name !== 'platform');

  return Response.json({ ok: true, settings });
}

export async function POST(context: APIContext): Promise<Response> {
  const user = await requireAuth(context);
  requirePermission(user, 'settings.manage');

  const env = getEnv(context);
  const body = await context.request.json<{ key: string; value: string }>();
  if (!body.key) {
    return Response.json({ ok: false, error: 'Key is required' }, { status: 400 });
  }

  const setting = await env.DB.prepare(
    `SELECT group_name FROM site_settings WHERE key = ?`
  ).bind(body.key).first<{ group_name: string }>();

  if (!setting) {
    return Response.json({ ok: false, error: 'Setting not found' }, { status: 404 });
  }

  if (setting.group_name === 'platform' && !isSuperAdmin(user.role)) {
    return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  await env.DB.prepare(
    `UPDATE site_settings SET value = ?, updated_at = datetime('now') WHERE key = ?`
  ).bind(body.value, body.key).run();

  return Response.json({ ok: true });
}
