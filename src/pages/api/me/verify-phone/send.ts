/**
 * POST /api/me/verify-phone/send [v7.1]
 * Send a phone verification OTP. Rate-limited to 3 per phone per 10 minutes.
 * In development, the OTP code is returned in the response.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { sendPhoneOtp } from '../../../../lib/phone-verification';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let body: { phone?: string };
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.phone) {
    return Response.json({ ok: false, code: 'PHONE_REQUIRED' }, { status: 400 });
  }

  const allowDevCode = (env as unknown as { ALLOW_DEV_PHONE_OTP?: string }).ALLOW_DEV_PHONE_OTP === '1';
  const result = await sendPhoneOtp(env.DB, body.phone, { allowDevCode });
  if (!result.ok) {
    const status = result.code === 'INVALID_PHONE' ? 400 : result.code === 'RATE_LIMITED' ? 429 : 500;
    return Response.json({ ok: false, code: result.code }, { status });
  }

  const response: Record<string, unknown> = { ok: true, ttl_seconds: result.ttl_seconds };
  // In dev mode (no SMS provider), include the code so the flow is testable
  if (result.dev_code) response.dev_code = result.dev_code;

  return Response.json(response);
}
