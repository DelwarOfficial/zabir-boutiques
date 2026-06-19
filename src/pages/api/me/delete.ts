/**
 * DELETE /api/me/data [Master_Prompt v7.0 §28.3]
 * Anonymize customer PII while preserving order integrity.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { nowSql } from '../../../lib/dates';
import { writeAuditLog } from '../../../lib/audit';

export async function DELETE(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const body = (await context.request.json().catch(() => ({}))) as { phone?: string };
  if (!body.phone) return Response.json({ ok: false, code: 'PHONE_REQUIRED' }, { status: 400 });

  const now = nowSql();
  const anon = `DELETED-${crypto.randomUUID().slice(0, 8)}`;

  await env.DB.batch([
    env.DB.prepare(`UPDATE orders SET name = ?2, address = ?3, email = NULL, updated_at = ?4 WHERE phone = ?1`).bind(body.phone, anon, anon, now),
    env.DB.prepare(`UPDATE cart_activity SET customer_name = ?2, customer_email = NULL, customer_phone = NULL WHERE customer_phone = ?1`).bind(body.phone, anon),
  ]);

  await writeAuditLog(env.DB, {
    actorStaffId: null,
    actorRole: null,
    action: 'customer.data_deletion',
    entityType: 'customer',
    entityId: body.phone,
    metadata: { anonymized: true },
  });

  return Response.json({ ok: true, message: 'Data anonymized. Orders preserved with redacted PII.' });
}
