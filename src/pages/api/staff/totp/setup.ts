/**
 * POST /api/staff/totp/setup [Master_Prompt v7.0 §18.1]
 * Generate TOTP secret for Owner 2FA enrollment.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requireRole, RbacError } from '../../../../lib/rbac';
import { generateTotpSecret } from '../../../../lib/totp';

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
  const totp = generateTotpSecret(`${user.id}@zabir.local`);
  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'totp.setup',
    entityType: 'staff_user',
    entityId: user.id,
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });
  return Response.json({ ok: true, secret: totp.secret, uri: totp.uri });
}
