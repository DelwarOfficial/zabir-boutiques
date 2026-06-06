export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { hashSessionToken } from '../../../lib/sessions';
import { nowSql } from '../../../lib/dates';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  const cookie = context.request.headers.get('Cookie') ?? '';
  const match = cookie.match(new RegExp('(?:^|;\\s*)session=([^;]+)'));
  const sessionToken = match ? decodeURIComponent(match[1]) : null;

  if (sessionToken) {
    const tokenHash = await hashSessionToken(sessionToken, env.SESSION_SECRET);
    await env.DB.prepare(
      `UPDATE staff_sessions SET is_revoked = 1, updated_at = ?2 WHERE token_hash = ?1`
    ).bind(tokenHash, now).run();
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
