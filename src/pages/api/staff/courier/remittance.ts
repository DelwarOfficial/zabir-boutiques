/**
 * POST /api/staff/courier/remittance — Record courier COD remittance (T-24, F-03).
 *
 * Staff enters what a courier actually paid back to the shop for a period.
 * expected_paisa is computed server-side from orders.cod_collected_paisa
 * (never trusted from the client) for delivered COD orders in that window;
 * received_paisa is what staff reports the courier actually handed over.
 * A shortfall (received < expected) is flagged in the response for the
 * owner digest — this route does not silently accept it.
 *
 * Body: { courier: string; period_start: string; period_end: string; received_paisa: number }
 * RBAC: payments.verify
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { nowSql } from '../../../../lib/dates';
import { requireAuth, requirePermission, RbacError } from '../../../../lib/rbac';
import { writeAuditLog, clientIp, userAgent } from '../../../../lib/audit';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'payments.verify');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let body: { courier?: string; period_start?: string; period_end?: string; received_paisa?: number };
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { courier, period_start: periodStart, period_end: periodEnd, received_paisa: receivedPaisa } = body;

  if (!courier || typeof courier !== 'string') {
    return Response.json({ ok: false, code: 'MISSING_COURIER' }, { status: 400 });
  }
  if (!periodStart || !periodEnd || typeof periodStart !== 'string' || typeof periodEnd !== 'string') {
    return Response.json({ ok: false, code: 'MISSING_PERIOD' }, { status: 400 });
  }
  if (typeof receivedPaisa !== 'number' || !Number.isSafeInteger(receivedPaisa) || receivedPaisa < 0) {
    return Response.json({ ok: false, code: 'INVALID_RECEIVED_AMOUNT' }, { status: 400 });
  }

  // expected_paisa: sum of COD actually collected on delivery for this
  // courier in this window, per orders.cod_collected_paisa (T-24). Never
  // the order total — a courier only owes what it collected.
  const expectedRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(cod_collected_paisa), 0) AS total
     FROM orders
     WHERE courier_provider = ?1
       AND status = 'delivered'
       AND cod_collected_paisa IS NOT NULL
       AND courier_handoff_at >= ?2
       AND courier_handoff_at < ?3`,
  ).bind(courier, periodStart, periodEnd).first<{ total: number }>();
  const expectedPaisa = expectedRow?.total ?? 0;

  const now = nowSql();
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO courier_cod_remittance
       (id, courier, period_start, period_end, expected_paisa, received_paisa, reconciled_by_staff_id, reconciled_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
  ).bind(id, courier, periodStart, periodEnd, expectedPaisa, receivedPaisa, user.id, now).run();

  const shortfallPaisa = expectedPaisa - receivedPaisa;

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'courier.remittance.reconcile',
    entityType: 'courier_cod_remittance',
    entityId: id,
    metadata: { courier, period_start: periodStart, period_end: periodEnd, expected_paisa: expectedPaisa, received_paisa: receivedPaisa, shortfall_paisa: shortfallPaisa },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({
    ok: true,
    id,
    expected_paisa: expectedPaisa,
    received_paisa: receivedPaisa,
    shortfall_paisa: shortfallPaisa,
    flagged: shortfallPaisa !== 0,
  }, { status: 201 });
}
