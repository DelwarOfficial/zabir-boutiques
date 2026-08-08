/**
 * GET/POST /api/staff/suppliers — Supplier directory (T-26, RT-003).
 * RBAC: inventory.manage
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { nowSql } from '../../../../lib/dates';
import { requireAuth, requirePermission, RbacError } from '../../../../lib/rbac';

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  try {
    const user = await requireAuth(context);
    requirePermission(user, 'inventory.manage');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const rows = await env.DB.prepare(
    `SELECT id, name, phone, address, is_active, created_at FROM suppliers ORDER BY name ASC`,
  ).all();
  return Response.json({ ok: true, suppliers: rows.results ?? [] });
}

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  try {
    const user = await requireAuth(context);
    requirePermission(user, 'inventory.manage');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let body: { name?: string; phone?: string; address?: string };
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
    return Response.json({ ok: false, code: 'INVALID_NAME' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const now = nowSql();
  await env.DB.prepare(
    `INSERT INTO suppliers (id, name, phone, address, is_active, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
  ).bind(id, body.name.trim(), body.phone ?? null, body.address ?? null, now).run();

  return Response.json({ ok: true, id }, { status: 201 });
}
