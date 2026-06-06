export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { hashSessionToken } from '../../../lib/sessions';
import { writeAuditLog, clientIp, userAgent } from '../../../lib/audit';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  const cookie = context.request.headers.get('Cookie') ?? '';
  const match = cookie.match(new RegExp('(?:^|;\\s*)session=([^;]+)'));
  const sessionToken = match ? decodeURIComponent(match[1]) : null;

  if (sessionToken) {
    const tokenHash = await hashSessionToken(sessionToken, env.SESSION_SECRET);
    const session = await env.DB.prepare(
      `SELECT s.id AS session_id, s.staff_user_id, u.role
       FROM staff_sessions s JOIN staff_users u ON u.id = s.staff_user_id
       WHERE s.token_hash = ?1`
    ).bind(tokenHash).first<{ session_id: string; staff_user_id: string; role: string }>();

    await env.DB.prepare(
      `UPDATE staff_sessions SET is_revoked = 1 WHERE token_hash = ?1`
    ).bind(tokenHash).run();

    if (session) {
      await writeAuditLog(env.DB, {
        actorStaffId: session.staff_user_id,
        actorRole: session.role,
        action: 'staff.logout',
        entityType: 'staff_session',
        entityId: session.session_id,
        ipAddress: clientIp(context.request),
        userAgent: userAgent(context.request)
      });
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': [
        'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
        'csrf-token=; Secure; SameSite=Strict; Path=/; Max-Age=0'
      ].join(', ')
    }
  });
}
