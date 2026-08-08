/**
 * POST /api/staff/pos/drawer/close — Close a cash drawer session (T-25, F-09).
 *
 * expected_cash_paisa = opening_float + SUM(cash invoice_payments since
 * opened_at for invoices this cashier rang up), computed server-side —
 * never trusted from the client. counted_cash_paisa is what the cashier
 * physically counted. variance_paisa = counted - expected.
 *
 * Body: { counted_cash_paisa: number; notes?: string }
 * RBAC: orders.create (cashier closes their own drawer)
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../../lib/env';
import { nowSql } from '../../../../../lib/dates';
import { requireAuth, requirePermission, RbacError } from '../../../../../lib/rbac';
import { writeAuditLog, clientIp, userAgent } from '../../../../../lib/audit';

/** Variance above this is flagged in the response for the owner digest, not blocked. */
const VARIANCE_ALERT_THRESHOLD_PAISA = 50_000; // BDT 500

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

  let body: { counted_cash_paisa?: number; notes?: string };
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const countedCashPaisa = body.counted_cash_paisa;
  if (typeof countedCashPaisa !== 'number' || !Number.isSafeInteger(countedCashPaisa) || countedCashPaisa < 0) {
    return Response.json({ ok: false, code: 'INVALID_COUNTED_CASH' }, { status: 400 });
  }

  const session = await env.DB.prepare(
    `SELECT id, opened_at, opening_float_paisa FROM pos_cash_drawer_sessions
     WHERE opened_by_staff_id = ?1 AND closed_at IS NULL`,
  ).bind(user.id).first<{ id: string; opened_at: string; opening_float_paisa: number }>();

  if (!session) {
    return Response.json({ ok: false, code: 'NO_OPEN_DRAWER' }, { status: 404 });
  }

  const cashTotal = await env.DB.prepare(
    `SELECT COALESCE(SUM(ip.amount_paisa), 0) AS total
     FROM invoice_payments ip
     JOIN invoices i ON i.id = ip.invoice_id
     WHERE ip.method = 'cash' AND i.cashier_id = ?1 AND ip.created_at >= ?2`,
  ).bind(user.id, session.opened_at).first<{ total: number }>();

  const expectedCashPaisa = session.opening_float_paisa + (cashTotal?.total ?? 0);
  const variancePaisa = countedCashPaisa - expectedCashPaisa;

  const now = nowSql();
  const update = await env.DB.prepare(
    `UPDATE pos_cash_drawer_sessions
     SET closed_by_staff_id = ?2, closed_at = ?3, expected_cash_paisa = ?4, counted_cash_paisa = ?5, variance_paisa = ?6, notes = ?7
     WHERE id = ?1 AND closed_at IS NULL`,
  ).bind(session.id, user.id, now, expectedCashPaisa, countedCashPaisa, variancePaisa, body.notes ?? null).run();

  if (update.meta.changes !== 1) {
    return Response.json({ ok: false, code: 'DRAWER_ALREADY_CLOSED' }, { status: 409 });
  }

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'pos.drawer.close',
    entityType: 'pos_cash_drawer_session',
    entityId: session.id,
    metadata: { expected_cash_paisa: expectedCashPaisa, counted_cash_paisa: countedCashPaisa, variance_paisa: variancePaisa },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({
    ok: true,
    drawer_session_id: session.id,
    expected_cash_paisa: expectedCashPaisa,
    counted_cash_paisa: countedCashPaisa,
    variance_paisa: variancePaisa,
    flagged: Math.abs(variancePaisa) > VARIANCE_ALERT_THRESHOLD_PAISA,
  }, { status: 200 });
}
