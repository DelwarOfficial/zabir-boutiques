import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { hashSessionToken } from '../../../lib/sessions';
import { generateRandomHex } from '../../../lib/security';
import { hashPassword, validatePasswordPolicy } from '../../../lib/password';
import { writeAuditLog, clientIp, userAgent } from '../../../lib/audit';
import { nowSql } from '../../../lib/dates';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let body: any = {};
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const rawToken = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!rawToken || !password) {
    return Response.json({ error: 'Token and password are required.' }, { status: 400 });
  }

  // Validate password policy
  const policy = validatePasswordPolicy(password);
  if (!policy.ok) {
    return Response.json({ error: policy.error }, { status: 400 });
  }

  // Hash the token and look it up
  const tokenHash = await hashSessionToken(rawToken, env.SESSION_SECRET);
  const token = await env.DB.prepare(
    `SELECT id, staff_id, expires_at, used_at, revoked_at
     FROM password_reset_tokens WHERE token_hash = ?1 LIMIT 1`,
  ).bind(tokenHash).first<{ id: string; staff_id: string; expires_at: string; used_at: string | null; revoked_at: string | null }>();

  if (!token) {
    return Response.json({ error: 'Invalid or expired reset link.' }, { status: 400 });
  }

  if (token.used_at) {
    return Response.json({ error: 'This reset link has already been used.' }, { status: 400 });
  }

  if (token.revoked_at) {
    return Response.json({ error: 'This reset link has been revoked.' }, { status: 400 });
  }

  if (token.expires_at < now) {
    return Response.json({ error: 'This reset link has expired.' }, { status: 400 });
  }

  // Hash the new password and update staff_users
  const newSalt = generateRandomHex(16);
  const newHash = await hashPassword(password, newSalt, env.PASSWORD_PEPPER);

  await env.DB.prepare(
    `UPDATE staff_users SET password_hash = ?2, password_salt = ?3 WHERE id = ?1`,
  ).bind(token.staff_id, newHash, newSalt).run();

  // Mark token as used
  await env.DB.prepare(
    `UPDATE password_reset_tokens SET used_at = ?2 WHERE id = ?1`,
  ).bind(token.id, now).run();

  // Revoke all active sessions for this staff — force re-login
  const sessions = await env.DB.prepare(
    `SELECT id FROM staff_sessions WHERE staff_user_id = ?1 AND is_revoked = 0 AND absolute_expires_at > ?2`,
  ).bind(token.staff_id, now).all<{ id: string }>();

  if (sessions.results && sessions.results.length > 0) {
    const ids = sessions.results.map(s => s.id);
    await env.DB.prepare(
      `UPDATE staff_sessions SET is_revoked = 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
    ).bind(...ids).run();
  }

  // Audit
  await writeAuditLog(env.DB, {
    actorStaffId: token.staff_id,
    actorRole: null,
    action: 'staff.password.reset_completed',
    entityType: 'staff_user',
    entityId: token.staff_id,
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({
    ok: true,
    message: 'Password reset successful. Please sign in.',
  });
}
