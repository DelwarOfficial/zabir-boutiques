/**
 * POST /api/me/verify-phone/confirm [v7.1]
 * Confirm an OTP code and receive a signed phone-verification token.
 * The token is valid for 15 minutes and must be passed as
 * Authorization: Bearer <token> on /api/me/data and /api/me/delete.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { confirmPhoneOtp } from '../../../../lib/phone-verification';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let body: { phone?: string; code?: string };
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.phone || !body.code) {
    return Response.json({ ok: false, code: 'PHONE_AND_CODE_REQUIRED' }, { status: 400 });
  }

  const sessionSecret = (env as unknown as { SESSION_SECRET?: string }).SESSION_SECRET;
  if (!sessionSecret) {
    return Response.json({ ok: false, code: 'INTERNAL_ERROR' }, { status: 500 });
  }

  const result = await confirmPhoneOtp(env.DB, body.phone, body.code, sessionSecret);
  if (!result.ok) {
    const status = result.code === 'INVALID_PHONE' || result.code === 'INVALID_CODE' ? 400
      : result.code === 'EXPIRED' ? 410
      : result.code === 'TOO_MANY_ATTEMPTS' ? 429
      : 500;
    return Response.json({ ok: false, code: result.code }, { status });
  }

  return Response.json({ ok: true, token: result.token, ttl_seconds: result.ttl_seconds });
}
