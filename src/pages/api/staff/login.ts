export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { hashSessionToken, generateSessionToken } from '../../../lib/sessions';
import { createCsrfToken } from '../../../lib/security';
import { hashPassword, verifyPassword, legacyHashPassword } from '../../../lib/password';
import { generateRandomHex } from '../../../lib/security';
import { nowSql } from '../../../lib/dates';
import { writeAuditLog, clientIp, userAgent } from '../../../lib/audit';

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

  const staff = await env.DB.prepare(
    `SELECT id, email, phone, password_hash, password_salt, full_name, role, is_active
     FROM staff_users
     WHERE (email = ?1 OR phone = ?1) AND is_active = 1`
  ).bind(identifier).first<{ id: string; email: string | null; phone: string | null; password_hash: string; password_salt: string | null; full_name: string; role: string; is_active: number }>();

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
    await env.DB.prepare(
      `UPDATE staff_users SET password_hash = ?2, password_salt = ?3 WHERE id = ?1`
    ).bind(staff.id, newHash, newSalt).run();
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
