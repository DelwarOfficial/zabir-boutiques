import type { APIContext } from 'astro';
import { getEnv } from '../../../../../lib/env';
import { getCurrentStaffUser, requirePermission } from '../../../../../lib/rbac';
import { requireRecentStaffSession } from '../../../../../lib/critical-auth';
import { generateSessionToken, hashSessionToken } from '../../../../../lib/sessions';
import { writeAuditLog, clientIp, userAgent } from '../../../../../lib/audit';
import { sendPasswordResetEmail } from '../../../../../lib/email';
import { nowSql } from '../../../../../lib/dates';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  // Require auth + staff.manage permission + step-up
  const user = await getCurrentStaffUser(context);
  if (!user) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }
  requirePermission(user, 'staff.manage' as any);
  await requireRecentStaffSession(context, user);

  // Target staff user from URL param
  const targetId = context.params.id;
  if (!targetId) {
    return Response.json({ error: 'Staff user ID is required.' }, { status: 400 });
  }

  const target = await env.DB.prepare(
    `SELECT id, email, full_name FROM staff_users WHERE id = ?1 AND is_active = 1 LIMIT 1`,
  ).bind(targetId).first<{ id: string; email: string; full_name: string }>();

  if (!target) {
    return Response.json({ error: 'Staff user not found or inactive.' }, { status: 404 });
  }

  if (!target.email) {
    return Response.json({ error: 'This staff user has no email address.' }, { status: 400 });
  }

  // Generate reset token
  const rawToken = generateSessionToken();
  const tokenHash = await hashSessionToken(rawToken, env.SESSION_SECRET);
  const tokenId = crypto.randomUUID();
  const expiresAt = nowSql(new Date(Date.now() + 60 * 60 * 1000)); // 1 hour

  await env.DB.prepare(
    `INSERT INTO password_reset_tokens (id, staff_id, token_hash, expires_at, created_by, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(tokenId, target.id, tokenHash, expiresAt, user.id, now).run();

  // Send email
  const siteUrl = env.PUBLIC_SITE_URL ?? 'https://zabirboutiques.com';
  const resetLink = `${siteUrl}/staff/reset-password?token=${rawToken}`;

  const emailResult = await sendPasswordResetEmail(env as any, {
    to: target.email,
    fullName: target.full_name,
    resetLink,
  });
  void emailResult;

  // Audit
  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'staff.password.admin_initiated_reset',
    entityType: 'password_reset_token',
    entityId: tokenId,
    metadata: JSON.stringify({ targetStaffId: target.id, targetEmail: target.email }),
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({
    ok: true,
    message: 'Reset link sent to staff email.',
  });
}
