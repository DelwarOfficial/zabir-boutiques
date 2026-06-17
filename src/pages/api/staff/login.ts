import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { hashSessionToken, generateSessionToken } from '../../../lib/sessions';
import { createCsrfToken } from '../../../lib/security';
import { hashPassword, verifyPassword, legacyHashPassword } from '../../../lib/password';
import { generateRandomHex } from '../../../lib/security';
import { nowSql } from '../../../lib/dates';
import { writeAuditLog, clientIp, userAgent } from '../../../lib/audit';
import { normalizeBangladeshPhone } from '../../../lib/phone';
import { verifyTurnstile } from '../../../lib/turnstile';
import { safeLog } from '../../../lib/pii-scrubber';
import type { StaffUser } from '../../../lib/rbac';

export const prerender = false;

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let body: any = {};
  try {
    const contentType = context.request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await context.request.json();
    } else {
      const form = await context.request.formData();
      body = Object.fromEntries(form.entries());
    }
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const identifier = body.identifier ?? body.email ?? body.phone ?? '';
  const password = body.password ?? '';
  if (!identifier || !password) {
    return Response.json({ error: 'Email/phone and password required' }, { status: 400 });
  }

  // Turnstile bot protection on staff login (Master_Prompt v7.0 §9.3)
  if (env.TURNSTILE_SECRET_KEY) {
    const token = typeof body.turnstile === "string" ? body.turnstile : context.request.headers.get("CF-Turnstile-Token");
    if (token) {
      const r = await verifyTurnstile(env, token, clientIp(context.request) ?? undefined);
      if (!r.ok) {
        await writeAuditLog(env.DB, {
          actorStaffId: null,
          actorRole: null,
          action: "staff.login.turnstile_failed",
          entityType: "staff_session",
          entityId: identifier,
          ipAddress: clientIp(context.request),
          userAgent: userAgent(context.request),
        });
        return Response.json({ error: "Bot check failed." }, { status: 403 });
      }
    }
  }

  // Build a list of candidate identifier strings to try: the raw input
  // plus its Bangladesh-phone canonical form (e.g. 017... → +88017...).
  // This keeps existing logins working regardless of how the phone was
  // originally stored on the staff_users row.
  const candidates: string[] = [identifier];
  const phoneNormalized = normalizeBangladeshPhone(identifier);
  if (phoneNormalized.ok) {
    if (!candidates.includes(phoneNormalized.local)) candidates.push(phoneNormalized.local);
    if (!candidates.includes(phoneNormalized.phone)) candidates.push(phoneNormalized.phone);
  }

  const staff = await env.DB.prepare(
    `SELECT id, email, phone, password_hash, password_salt, full_name, role, is_active
     FROM staff_users
     WHERE (email IN (${candidates.map((_, i) => `?${i + 1}`).join(',')})
        OR phone IN (${candidates.map((_, i) => `?${candidates.length + i + 1}`).join(',')}))
       AND is_active = 1
     LIMIT 1`
  ).bind(...candidates, ...candidates).first<{ id: string; email: string | null; phone: string | null; password_hash: string; password_salt: string | null; full_name: string; role: string; is_active: number }>();

  if (!staff) return Response.json({ error: 'Invalid credentials' }, { status: 401 });

  // PBKDF2 verification with transparent upgrade from legacy HMAC-SHA256.
  // If the stored hash uses the old format (no password_salt), verify with
  // legacy HMAC and re-hash with PBKDF2 on success.
  if (staff.password_salt) {
    const valid = await verifyPassword(password, staff.password_hash, staff.password_salt, env.PASSWORD_PEPPER);
    if (!valid) return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  } else {
    const legacyHash = await legacyHashPassword(password, env.SESSION_SECRET);
    if (staff.password_hash !== legacyHash) return Response.json({ error: 'Invalid credentials' }, { status: 401 });
    const newSalt = generateRandomHex(16);
    const newHash = await hashPassword(password, newSalt, env.PASSWORD_PEPPER);
    // Conditional upgrade: only update if the row still has the legacy
    // hash AND salt is null. A concurrent login that won the race will
    // have set password_salt; the second login's UPDATE matches 0 rows
    // and we proceed without throwing.
    const upgradeResult = await env.DB.prepare(
      `UPDATE staff_users SET password_hash = ?2, password_salt = ?3
       WHERE id = ?1 AND password_hash = ?4 AND password_salt IS NULL`
    ).bind(staff.id, newHash, newSalt, legacyHash).run();
    if (upgradeResult.meta.changes === 1) {
      await writeAuditLog(env.DB, {
        actorStaffId: staff.id,
        actorRole: staff.role,
        action: 'staff.password.upgraded',
        entityType: 'staff_user',
        entityId: staff.id,
        ipAddress: clientIp(context.request),
        userAgent: userAgent(context.request),
      });
    }
  }

  const sessionToken = generateSessionToken();
  const tokenHash = await hashSessionToken(sessionToken, env.SESSION_SECRET);
  const sessionId = crypto.randomUUID();
  // Master_Prompt v7.0 §9.1: 30-min idle + 8-hour absolute timeout.
  const expiresAt = nowSql(new Date(Date.now() + 30 * 60 * 1000));
  const absoluteExpiresAt = nowSql(new Date(Date.now() + 8 * 60 * 60 * 1000));

  // Atomic session creation. If any statement fails, the batch rolls
  // back the session row and the user does not get a half-created
  // session. The audit log is also part of the batch so the two writes
  // succeed together (or both fail).
  try {
    await env.DB.batch(
      [
        env.DB.prepare(
          `INSERT INTO staff_sessions (id, staff_user_id, token_hash, is_revoked, expires_at, absolute_expires_at, last_active_at, created_at)
           VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?6)`,
        ).bind(sessionId, staff.id, tokenHash, expiresAt, absoluteExpiresAt, now),
        env.DB.prepare(
          `UPDATE staff_users SET last_login_at = ?2 WHERE id = ?1`,
        ).bind(staff.id, now),
      ],
      { atomic: true },
    );

    // Populate KV for fast RBAC extraction (Task 5). D1 remains source of truth.
    if ((env as any).SESSION) {
      const sessPayload: Partial<StaffUser> & { sessionId: string } = {
        id: staff.id,
        role: staff.role as any,
        fullName: staff.full_name,
        sessionId,
      };
      await (env as any).SESSION.put(
        `staff-session:${tokenHash}`,
        JSON.stringify(sessPayload),
        { expirationTtl: 8 * 60 * 60 }
      );
    }
  } catch (err) {
    safeLog.error('[staff/login] session insert failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Login service unavailable. Please try again.' }, { status: 503 });
  }

  await writeAuditLog(env.DB, {
    actorStaffId: staff.id,
    actorRole: staff.role,
    action: 'staff.login',
    entityType: 'staff_session',
    entityId: sessionId,
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });

  const csrfToken = await createCsrfToken(env.SESSION_SECRET);

  const headers = new Headers({ 'Content-Type': 'application/json' });
  const maxAge = 24 * 60 * 60;
  // __Host- prefix requires Path=/; Secure; no Domain attribute. This
  // guarantees the cookie is bound to the exact host (no subdomain leaks)
  // and that it is only ever sent over HTTPS. Works in tandem with the
  // session-independent nonce.HMAC(nonce) CSRF token to prevent XSS-driven
  // session hijack via the CSRF cookie.
  headers.append('Set-Cookie', `__Host-session=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
  headers.append('Set-Cookie', `__Host-csrf-token=${csrfToken}; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`);

  return new Response(JSON.stringify({ ok: true, staff: { id: staff.id, name: staff.full_name, role: staff.role } }), {
    status: 200,
    headers
  });
}
