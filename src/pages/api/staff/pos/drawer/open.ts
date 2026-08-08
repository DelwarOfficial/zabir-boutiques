/**
 * POST /api/staff/pos/drawer/open — Open a cash drawer session (T-25, F-09).
 *
 * A cashier must have an open drawer session before a cash invoice_payments
 * row can be recorded (enforced in POST /api/staff/invoices). Refuses a
 * second open session for the same cashier.
 *
 * Body: { opening_float_paisa: number }
 * RBAC: orders.create (same tier as invoice creation — any cashier)
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../../lib/env';
import { nowSql } from '../../../../../lib/dates';
import { requireAuth, requirePermission, RbacError } from '../../../../../lib/rbac';
import { writeAuditLog, clientIp, userAgent } from '../../../../../lib/audit';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'orders.create');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let body: { opening_float_paisa?: number };
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const openingFloatPaisa = body.opening_float_paisa;
  if (typeof openingFloatPaisa !== 'number' || !Number.isSafeInteger(openingFloatPaisa) || openingFloatPaisa < 0) {
    return Response.json({ ok: false, code: 'INVALID_OPENING_FLOAT' }, { status: 400 });
  }

  const existing = await env.DB.prepare(
    `SELECT id FROM pos_cash_drawer_sessions WHERE opened_by_staff_id = ?1 AND closed_at IS NULL`,
  ).bind(user.id).first<{ id: string }>();
  if (existing) {
    return Response.json({ ok: false, code: 'DRAWER_ALREADY_OPEN', drawer_session_id: existing.id }, { status: 409 });
  }

  const now = nowSql();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO pos_cash_drawer_sessions (id, opened_by_staff_id, opened_at, opening_float_paisa)
     VALUES (?1, ?2, ?3, ?4)`,
  ).bind(id, user.id, now, openingFloatPaisa).run();

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'pos.drawer.open',
    entityType: 'pos_cash_drawer_session',
    entityId: id,
    metadata: { opening_float_paisa: openingFloatPaisa },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({ ok: true, drawer_session_id: id, opened_at: now }, { status: 201 });
}
