import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requireRole, RbacError } from '../../../../lib/rbac';
import { requireRecentStaffSession, CriticalAuthError } from '../../../../lib/critical-auth';
import { writeCriticalAuditLog } from '../../../../lib/audit';
import { clearStaffTotpSecret } from '../../../../lib/otp-secrets';

export async function POST(context: APIContext): Promise<Response> {
  let user;
  try {
    user = await requireAuth(context);
    requireRole(user, ['owner', 'super_admin']);
    // K-23: disabling 2FA is exactly the kind of action a stolen-cookie
    // session (no step-up) must not be able to take on its own.
    await requireRecentStaffSession(context, user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    if (err instanceof CriticalAuthError) return err.toResponse();
    throw err;
  }

  const env = getEnv(context);
  await clearStaffTotpSecret(env.DB, user.id);

  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'totp.disabled',
    entityType: 'staff_user',
    entityId: user.id,
  });

  return Response.json({ ok: true });
}