/**
 * POST /api/staff/totp/verify [Master_Prompt v7.0 §18.1]
 * Verify TOTP code and enable 2FA for Owner.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { nowSql } from '../../../../lib/dates';
import { requireAuth, requireRole, RbacError } from '../../../../lib/rbac';
import { verifyTotp } from '../../../../lib/totp';
import { writeAuditLog } from '../../../../lib/audit';

export async function POST(context: APIContext): Promise<Response> {
  let user;
  try {
    user = await requireAuth(context);
    requireRole(user, 'owner');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const env = getEnv(context);
  const body = (await context.request.json().catch(() => ({}))) as { code?: string; secret?: string };
  if (!body.code || !body.secret) return Response.json({ ok: false, code: 'CODE_AND_SECRET_REQUIRED' }, { status: 400 });

  const valid = verifyTotp(body.secret, body.code);
  if (!valid) return Response.json({ ok: false, code: 'INVALID_CODE' }, { status: 400 });

  const now = nowSql();
  await env.DB.prepare(
    `INSERT INTO otp_secrets (staff_id, secret_cipher, backup_codes_hash, enabled_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT (staff_id) DO UPDATE SET secret_cipher = excluded.secret_cipher, enabled_at = excluded.enabled_at, updated_at = excluded.updated_at`,
  ).bind(user.id, new TextEncoder().encode(body.secret), '', now).run();

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'totp.enabled',
    entityType: 'staff_user',
    entityId: user.id,
    metadata: {},
  });

  return Response.json({ ok: true, message: 'TOTP 2FA enabled.' });
}
