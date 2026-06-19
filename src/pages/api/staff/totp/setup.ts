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
    requireRole(user, ['owner']);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const totp = generateTotpSecret(`${user.id}@zabir.local`);
  return Response.json({ ok: true, secret: totp.secret, uri: totp.uri });
}
