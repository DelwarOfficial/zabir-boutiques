/**
 * POST /api/staff/step-up — Re-authenticate for step-up operations.
 * Verifies the current staff user's password and refreshes last_active_at
 * to reset the step-up window (10 minutes).
 *
 * Does NOT create a new session — just proves recent identity.
 * CSRF required.
 */
export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { requireAuth, RbacError } from '../../../lib/rbac';
import { verifyPassword, legacyHashPassword } from '../../../lib/password';
import { nowSql } from '../../../lib/dates';
import { writeAuditLog, clientIp, userAgent } from '../../../lib/audit';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let user;
  try {
    user = await requireAuth(context);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const password = body.password ?? '';
  if (!password) {
    return Response.json({ error: 'Password is required' }, { status: 400 });
  }

  // Look up the user's password hash
  const staff = await env.DB.prepare(
    `SELECT password_hash, password_salt FROM staff_users WHERE id = ?1 AND is_active = 1`
  ).bind(user.id).first<{ password_hash: string; password_salt: string | null }>();

  if (!staff) {
    return Response.json({ error: 'Account not found or inactive' }, { status: 401 });
  }

  // Verify password
  let valid = false;
  if (staff.password_salt) {
    valid = await verifyPassword(password, staff.password_hash, staff.password_salt, env.PASSWORD_PEPPER);
  } else {
    const legacyHash = await legacyHashPassword(password, env.SESSION_SECRET);
    valid = staff.password_hash === legacyHash;
  }

  if (!valid) {
    await writeAuditLog(env.DB, {
      actorStaffId: user.id,
      actorRole: user.role,
      action: 'staff.step_up.failed',
      entityType: 'staff_session',
      entityId: user.sessionId,
      ipAddress: clientIp(context.request),
      userAgent: userAgent(context.request)
    });
    return Response.json({ error: 'Invalid password' }, { status: 401 });
  }

  // Update last_active_at to reset step-up window
  const now = nowSql();
  await env.DB.prepare(
    `UPDATE staff_sessions SET last_active_at = ?1 WHERE id = ?2 AND staff_user_id = ?3`
  ).bind(now, user.sessionId, user.id).run();

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'staff.step_up.success',
    entityType: 'staff_session',
    entityId: user.sessionId,
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });

  return Response.json({ ok: true });
}
