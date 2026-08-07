import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { generateSessionToken, hashSessionToken } from '../../../lib/sessions';
import { writeAuditLog, clientIp, userAgent } from '../../../lib/audit';
import { verifyTurnstile } from '../../../lib/turnstile';
import { checkResetRateLimit, recordResetAttempt } from '../../../lib/password-reset-rate-limit';
import { sendPasswordResetEmail } from '../../../lib/email';
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

  const identifier = (body.identifier ?? '').trim().toLowerCase();
  if (!identifier) {
    return Response.json({ error: 'Email is required' }, { status: 400 });
  }

  // Turnstile bot protection
  if (env.TURNSTILE_SECRET_KEY) {
    const token = typeof body.turnstile === 'string' ? body.turnstile : context.request.headers.get('CF-Turnstile-Token');
    if (!token) {
      return Response.json({ error: 'Bot check required.' }, { status: 403 });
    }
    const r = await verifyTurnstile(env, token, clientIp(context.request) ?? undefined);
    if (!r.ok) {
      await writeAuditLog(env.DB, {
        actorStaffId: null,
        actorRole: null,
        action: 'staff.password.reset_turnstile_failed',
        entityType: 'staff_user',
        entityId: identifier,
        ipAddress: clientIp(context.request),
        userAgent: userAgent(context.request),
      });
      return Response.json({ error: 'Bot check failed.' }, { status: 403 });
    }
  }

  // Rate limit by IP
  const ip = clientIp(context.request) ?? 'unknown';
  const rateOk = await checkResetRateLimit(env.DB, ip);
  if (!rateOk.allowed) {
    return Response.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  }
  await recordResetAttempt(env.DB, ip);

  // Lookup staff by email (active only)
  const staff = await env.DB.prepare(
    `SELECT id, email, full_name FROM staff_users WHERE email = ?1 AND is_active = 1 LIMIT 1`,
  ).bind(identifier).first<{ id: string; email: string; full_name: string }>();

  if (staff) {
    // Generate reset token (same pattern as session tokens)
    const rawToken = generateSessionToken();
    const tokenHash = await hashSessionToken(rawToken, env.SESSION_SECRET);
    const tokenId = crypto.randomUUID();
    const expiresAt = nowSql(new Date(Date.now() + 60 * 60 * 1000)); // 1 hour

    await env.DB.prepare(
      `INSERT INTO password_reset_tokens (id, staff_id, token_hash, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(tokenId, staff.id, tokenHash, expiresAt, now).run();

    const siteUrl = env.PUBLIC_SITE_URL ?? 'https://zabirboutiques.com';
    const resetLink = `${siteUrl}/staff/reset-password?token=${rawToken}`;

    // Send email (fire-and-forget style — don't block response on email)
    const emailResult = await sendPasswordResetEmail(env as any, {
      to: staff.email,
      fullName: staff.full_name,
      resetLink,
    });
    void emailResult; // log result not needed at response time

    await writeAuditLog(env.DB, {
      actorStaffId: staff.id,
      actorRole: null,
      action: 'staff.password.reset_requested',
      entityType: 'password_reset_token',
      entityId: tokenId,
      ipAddress: clientIp(context.request),
      userAgent: userAgent(context.request),
    });
  }

  // Always return the same message — enumeration-safe
  return Response.json({
    ok: true,
    message: 'If an account exists, a reset link has been sent.',
  });
}
