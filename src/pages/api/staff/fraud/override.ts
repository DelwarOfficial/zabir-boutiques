/**
 * POST /api/staff/fraud/override -- Manual FraudBD decision override.
 *
 * Owner-tier only. FraudBD remains a risk signal; D1 order state is the source
 * of truth, and every override requires a reason plus fail-closed audit.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, assertOwnerOnly, isSuperAdmin, RbacError } from '../../../../lib/rbac';
import { nowSql } from '../../../../lib/dates';
import { writeCriticalAuditLog, clientIp, userAgent } from '../../../../lib/audit';
import { requireRecentStaffSession, CriticalAuthError } from '../../../../lib/critical-auth';

const DECISIONS = new Set(['approved', 'review', 'blocked']);

// K-16: no cooldown meant a compromised/rogue owner-tier session could
// flip fraud_decision on many orders in rapid succession (e.g. mass
// approve blocked COD orders). 10 overrides / 5 min per staff member —
// generous for genuine review work, but bounds abuse volume. Fails open
// (no throttle) when SESSION KV isn't bound, matching login-rate-limit.ts.
const OVERRIDE_RATE_LIMIT = { max: 10, windowSeconds: 5 * 60 };

async function checkOverrideRateLimit(kv: KVNamespace | undefined, staffId: string): Promise<boolean> {
  if (!kv) return true;
  const key = `ratelimit:fraud-override:${staffId}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= OVERRIDE_RATE_LIMIT.max) return false;
  await kv.put(key, String(count + 1), { expirationTtl: OVERRIDE_RATE_LIMIT.windowSeconds });
  return true;
}

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let user;
  try {
    user = await requireAuth(context);
    assertOwnerOnly(user);
    if (!isSuperAdmin(user.role)) {
      await requireRecentStaffSession(context, user);
    }
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    if (err instanceof CriticalAuthError) return err.toResponse();
    throw err;
  }

  const sessionKv = (env as typeof env & { SESSION?: KVNamespace }).SESSION;
  if (!(await checkOverrideRateLimit(sessionKv, user.id))) {
    return Response.json(
      { ok: false, code: 'RATE_LIMITED', message: 'Too many overrides. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(OVERRIDE_RATE_LIMIT.windowSeconds) } },
    );
  }

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ ok: false, code: 'INVALID_JSON', message: 'Invalid JSON body' }, { status: 400 });
  }

  const orderId = typeof body.order_id === 'string' ? body.order_id.trim() : '';
  const nextDecision = typeof body.decision === 'string' ? body.decision.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!orderId) return Response.json({ ok: false, code: 'MISSING_ORDER_ID', message: 'Missing order_id' }, { status: 400 });
  if (!DECISIONS.has(nextDecision)) return Response.json({ ok: false, code: 'INVALID_DECISION', message: 'Decision must be approved, review, or blocked.' }, { status: 400 });
  if (reason.length < 12 || reason.length > 500) {
    return Response.json({ ok: false, code: 'INVALID_REASON', message: 'Override reason must be 12-500 characters.' }, { status: 400 });
  }

  const order = await env.DB.prepare(
    `SELECT id, fraud_decision, status FROM orders WHERE id = ?1`
  ).bind(orderId).first<{ id: string; fraud_decision: string; status: string }>();

  if (!order) return Response.json({ ok: false, code: 'ORDER_NOT_FOUND', message: 'Order not found.' }, { status: 404 });
  if (order.fraud_decision === nextDecision) {
    return Response.json({ ok: true, order_id: orderId, decision: nextDecision, unchanged: true });
  }

  await env.DB.prepare(
    `UPDATE orders SET fraud_decision = ?2, updated_at = ?3 WHERE id = ?1`
  ).bind(orderId, nextDecision, now).run();

  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'fraud.override',
    entityType: 'order',
    entityId: orderId,
    metadata: {
      from_decision: order.fraud_decision,
      to_decision: nextDecision,
      order_status: order.status,
      reason
    },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });

  return Response.json({ ok: true, order_id: orderId, decision: nextDecision });
}
