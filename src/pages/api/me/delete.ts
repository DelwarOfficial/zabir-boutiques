/**
 * DELETE /api/me/data [Master_Prompt v7.0 §28.3]
 * Anonymize customer PII while preserving order integrity.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { nowSql } from '../../../lib/dates';
import { writeAuditLog } from '../../../lib/audit';
import { extractBearerToken, sha256Hex, verifyPhoneToken } from '../../../lib/phone-verification';
import { normalizeBangladeshPhone } from '../../../lib/phone';

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
  const anon = `DELETED-${crypto.randomUUID().slice(0, 8)}`;
  const phoneHash = await sha256Hex(normalized.phone);

  await env.DB.batch([
    env.DB.prepare(`UPDATE orders SET name = ?2, address = ?3, email = NULL, updated_at = ?4 WHERE phone IN (?1, ?5)`).bind(normalized.phone, anon, anon, now, normalized.local),
    env.DB.prepare(`UPDATE cart_activity SET customer_name = ?2, customer_email = NULL, customer_phone = NULL WHERE customer_phone IN (?1, ?3)`).bind(normalized.phone, anon, normalized.local),
  ]);

  await writeAuditLog(env.DB, {
    actorStaffId: null,
    actorRole: null,
    action: 'customer.data_deletion',
    entityType: 'customer',
    entityId: `sha256:${phoneHash}`,
    metadata: { anonymized: true },
  });

  return Response.json({ ok: true, message: 'Data anonymized. Orders preserved with redacted PII.' });
}
