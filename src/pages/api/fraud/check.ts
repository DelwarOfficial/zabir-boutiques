/**
 * POST /api/fraud/check — FraudBD Risk Check [v6.8A]
 * Manager or Owner only. Staff override / manual recheck.
 * FraudBD is a risk signal only; raw response is summarized for non-owner viewers.
 */
export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { checkFraudBD, decideFraudRisk } from '../../../lib/fraud';
import { normalizeBangladeshPhone } from '../../../lib/phone';
import { requireAuth, requirePermission, isOwnerTier, RbacError } from '../../../lib/rbac';
import { writeAuditLog, clientIp, userAgent } from '../../../lib/audit';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'fraud.override');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const phoneResult = normalizeBangladeshPhone(body.phone ?? '');
  if (!phoneResult.ok) {
    const message = phoneResult.reason === 'EMPTY'
      ? 'Missing phone'
      : 'Invalid Bangladeshi mobile number. Enter 11 digits starting with 01X.';
    return Response.json({ error: message }, { status: 400 });
  }

  const { score, rawResponse } = await checkFraudBD(phoneResult.local, env.FRAUDBD_API_KEY);
  const decision = decideFraudRisk(score);

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'fraud.check',
    entityType: 'fraud_check',
    entityId: phoneResult.phone,
    metadata: { score, decision },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });

  // Raw FraudBD payload is Owner-only; others get the summarized decision.
  const payload: Record<string, unknown> = { ok: true, score, decision };
  if (isOwnerTier(user.role)) payload.rawResponse = rawResponse;

  return Response.json(payload);
}
