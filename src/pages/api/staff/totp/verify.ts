/**
 * POST /api/staff/totp/verify [Master_Prompt v7.0 §18.1]
 * Verify TOTP code and enable 2FA for Owner.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requireRole, RbacError } from '../../../../lib/rbac';
import { verifyTotpCode } from '../../../../lib/totp';
import { writeCriticalAuditLog } from '../../../../lib/audit';
import { storeStaffTotpSecret } from '../../../../lib/otp-secrets';

export async function POST(context: APIContext): Promise<Response> {
  let user;
  try {
    user = await requireAuth(context);
    requireRole(user, ['owner', 'super_admin']);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const env = getEnv(context);
  const body = (await context.request.json().catch(() => ({}))) as { code?: string; secret?: string };
  if (!body.code || !body.secret) return Response.json({ ok: false, code: 'CODE_AND_SECRET_REQUIRED' }, { status: 400 });

  const valid = await verifyTotpCode(body.secret, body.code);
  if (!valid) return Response.json({ ok: false, code: 'INVALID_CODE' }, { status: 400 });

  await storeStaffTotpSecret(env.DB, user.id, body.secret, env);

  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'totp.enabled',
    entityType: 'staff_user',
    entityId: user.id,
    metadata: {},
  });

  return Response.json({ ok: true, message: 'TOTP 2FA enabled.' });
}
