/**
 * POST /api/fraud/check — FraudBD Risk Check [v6.8A]
 * Internal use only for staff override or manual recheck.
 */
export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { checkFraudBD, decideFraudRisk } from '../../../lib/fraud';
import { normalizeBangladeshPhone } from '../../../lib/phone';

const phoneErrorMessage = 'Invalid Bangladeshi mobile number. Enter 11 digits starting with 01X.';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const phoneResult = normalizeBangladeshPhone(body.phone ?? '');
  if (!phoneResult.ok) {
    return Response.json({ error: phoneResult.reason === 'EMPTY' ? 'Missing phone' : phoneErrorMessage }, { status: 400 });
  }

  const { score, rawResponse } = await checkFraudBD(phoneResult.phone, env.FRAUDBD_API_KEY);
  const decision = decideFraudRisk(score);

  return Response.json({ score, decision, rawResponse });
}
