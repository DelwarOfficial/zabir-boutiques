export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { hashSessionToken, generateSessionToken } from '../../../lib/sessions';
import { createCsrfToken } from '../../../lib/security';
import { nowSql } from '../../../lib/dates';
import { writeAuditLog, clientIp, userAgent } from '../../../lib/audit';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let body: any;
  try { body = await context.request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const identifier = body.identifier ?? body.email ?? body.phone ?? '';
  const password = body.password ?? '';
  if (!identifier || !password) {
    return Response.json({ error: 'Email/phone and password required' }, { status: 400 });
  }

  const staff = await env.DB.prepare(
    `SELECT id, email, phone, password_hash, full_name, role, is_active
     FROM staff_users
     WHERE (email = ?1 OR phone = ?1) AND is_active = 1`
  ).bind(identifier).first<{ id: string; email: string | null; phone: string | null; password_hash: string; full_name: string; role: string; is_active: number }>();

  if (!staff) return Response.json({ error: 'Invalid credentials' }, { status: 401 });

  // NOTE: Password hashing uses HMAC-SHA256 with SESSION_SECRET.
  // This is NOT a production-grade password hash — it lacks per-user salt,
  // slow hashing (PBKDF2/bcrypt/argon2), and reuses the same secret used
  // for session tokens and CSRF. A production upgrade should:
  //   1. Add a `password_salt` column to staff_users
  //   2. Use crypto.subtle.deriveKey with PBKDF2
  //   3. Use a separate secret (PASSWORD_PEPPER) distinct from SESSION_SECRET
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const passwordSig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(password));
  const passwordHash = Array.from(new Uint8Array(passwordSig)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (staff.password_hash !== passwordHash) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const sessionToken = generateSessionToken();
  const tokenHash = await hashSessionToken(sessionToken, env.SESSION_SECRET);
  const sessionId = crypto.randomUUID();
  const expiresAt = nowSql(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const absoluteExpiresAt = nowSql(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

  await env.DB.prepare(
    `INSERT INTO staff_sessions (id, staff_user_id, token_hash, is_revoked, expires_at, absolute_expires_at, last_active_at, created_at)
     VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?6)`
  ).bind(sessionId, staff.id, tokenHash, expiresAt, absoluteExpiresAt, now).run();

  await env.DB.prepare(
    `UPDATE staff_users SET last_login_at = ?2 WHERE id = ?1`
  ).bind(staff.id, now).run();

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
  headers.append('Set-Cookie', `session=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
  headers.append('Set-Cookie', `csrf-token=${csrfToken}; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`);

  return new Response(JSON.stringify({ ok: true, staff: { id: staff.id, name: staff.full_name, role: staff.role } }), {
    status: 200,
    headers
  });
}
