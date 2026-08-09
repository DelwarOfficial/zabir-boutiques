/**
 * DELETE /api/me/data [Master_Prompt v7.0 §28.3, N-12]
 *
 * N-12: this used to anonymize immediately. The plan requires a 30-day
 * processing window so a fraud investigation, open order, or chargeback
 * isn't cut off by the customer's own deletion request. Actual
 * anonymization now happens via the daily `pending_deletions` cron
 * (src/lib/customer-deletion.ts) — this route only records the verified
 * request.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { nowSql } from '../../../lib/dates';
import { extractBearerToken, sha256Hex, verifyPhoneToken } from '../../../lib/phone-verification';
import { normalizeBangladeshPhone } from '../../../lib/phone';
import { scheduleCustomerDeletion } from '../../../lib/customer-deletion';

export async function DELETE(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const body = (await context.request.json().catch(() => ({}))) as { phone?: string };
  if (!body.phone) return Response.json({ ok: false, code: 'PHONE_REQUIRED' }, { status: 400 });

  const token = extractBearerToken(context.request);
  const verified = await verifyPhoneToken(token ?? '', env.SESSION_SECRET);
  if (!verified.valid) {
    return Response.json({ ok: false, code: 'PHONE_VERIFICATION_REQUIRED' }, { status: 401 });
  }

  const normalized = normalizeBangladeshPhone(body.phone);
  if (!normalized.ok || normalized.phone !== verified.phone) {
    return Response.json({ ok: false, code: 'PHONE_TOKEN_MISMATCH' }, { status: 403 });
  }

  const now = nowSql();
  const phoneHash = await sha256Hex(normalized.phone);

  const { scheduledFor, alreadyScheduled } = await scheduleCustomerDeletion(
    env.DB,
    normalized.phone,
    normalized.local,
    phoneHash,
    now,
  );

  return Response.json({
    ok: true,
    scheduled_for: scheduledFor,
    already_scheduled: alreadyScheduled,
    message: alreadyScheduled
      ? 'A deletion request is already scheduled for this account.'
      : 'Deletion request received. Your data will be anonymized in 30 days unless there is an open order, return, or fraud review in progress at that time.',
  });
}
