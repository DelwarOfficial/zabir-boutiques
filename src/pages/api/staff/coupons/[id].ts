/**
 * /api/staff/coupons/:id — Coupon Activate/Deactivate [Staff Operations v2]
 *
 * PATCH — Toggle is_active (owner-tier only)
 *
 * RBAC: Owner_Tier (super_admin, owner)
 * CSRF: Required
 */
export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, assertOwnerOnly, RbacError } from '../../../../lib/rbac';
import { nowSql } from '../../../../lib/dates';
import { writeCriticalAuditLog, clientIp, userAgent } from '../../../../lib/audit';
import { requireRecentStaffSession, CriticalAuthError } from '../../../../lib/critical-auth';

export async function PATCH(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const couponId = context.params.id;
  const now = nowSql();

  if (!couponId) return Response.json({ error: 'Missing coupon ID' }, { status: 400 });

  let user;
  try {
    user = await requireAuth(context);
    assertOwnerOnly(user);
    await requireRecentStaffSession(context, user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    if (err instanceof CriticalAuthError) return err.toResponse();
    throw err;
  }

  let body: any;
  try { body = await context.request.json(); } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const isActive = body.is_active === true ? 1 : body.is_active === false ? 0 : null;
  if (isActive === null) {
    return Response.json({ ok: false, code: 'INVALID_ACTION', message: 'Provide is_active: true or false.' }, { status: 400 });
  }

  const result = await env.DB.prepare(
    `UPDATE coupons SET is_active = ?2, updated_at = ?3 WHERE id = ?1`
  ).bind(couponId, isActive, now).run();

  if (result.meta.changes !== 1) {
    return Response.json({ ok: false, code: 'NOT_FOUND', message: 'Coupon not found.' }, { status: 404 });
  }

  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: isActive ? 'coupon.activate' : 'coupon.deactivate',
    entityType: 'coupon',
    entityId: couponId,
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });

  return Response.json({ ok: true, is_active: isActive === 1 });
}
