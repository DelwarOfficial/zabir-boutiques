/**
 * GET/POST /api/staff/purchase-orders — Purchase order header (T-26, RT-003).
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
    `SELECT id, supplier_id, status, total_cost_paisa, created_by_staff_id, created_at, updated_at
     FROM purchase_orders ORDER BY created_at DESC`,
  ).all();
  return Response.json({ ok: true, purchase_orders: rows.results ?? [] });
}

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'inventory.manage');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let body: { supplier_id?: string };
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.supplier_id || typeof body.supplier_id !== 'string') {
    return Response.json({ ok: false, code: 'MISSING_SUPPLIER' }, { status: 400 });
  }

  const supplier = await env.DB.prepare(`SELECT id FROM suppliers WHERE id = ?1 AND is_active = 1`).bind(body.supplier_id).first();
  if (!supplier) {
    return Response.json({ ok: false, code: 'SUPPLIER_NOT_FOUND' }, { status: 404 });
  }

  const id = crypto.randomUUID();
  const now = nowSql();
  await env.DB.prepare(
    `INSERT INTO purchase_orders (id, supplier_id, status, total_cost_paisa, created_by_staff_id, created_at, updated_at)
     VALUES (?1, ?2, 'draft', 0, ?3, ?4, ?4)`,
  ).bind(id, body.supplier_id, user.id, now).run();

  return Response.json({ ok: true, id, status: 'draft' }, { status: 201 });
}
