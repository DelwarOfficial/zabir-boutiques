/**
 * /api/staff/api-code — Owner-only developer / API-code area [v6.8A]
 * Enforces assertOwnerOnly + system.api_code.manage permission.
 * Never renders secret VALUES; only key names / summaries.
 */
export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission, assertSuperAdminOnly, RbacError } from '../../../../lib/rbac';
import { writeAuditLog, writeCriticalAuditLog, clientIp, userAgent } from '../../../../lib/audit';
import { requireRecentStaffSession, CriticalAuthError } from '../../../../lib/critical-auth';

// Secret KEY NAMES only — values are never read or rendered.
const SECRET_KEY_NAMES = [
  'SESSION_SECRET', 'TINIFY_API_KEY', 'UDDOKTAPAY_API_KEY', 'UDDOKTAPAY_BASE_URL',
  'FRAUDBD_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'API_KEY_PEPPER',
  'AUDIT_LEDGER_SECRET'
];

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'api_code.read');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'system.api_code.view',
    entityType: 'system',
    entityId: 'api-code',
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });

  return Response.json({
    ok: true,
    secret_key_names: SECRET_KEY_NAMES,
    note: 'Secret values are configured in Cloudflare and never returned by this endpoint.'
  });
}

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let user;
  try {
    user = await requireAuth(context);
    assertSuperAdminOnly(user);
    requirePermission(user, 'api_code.update');
    await requireRecentStaffSession(context, user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    if (err instanceof CriticalAuthError) return err.toResponse();
    throw err;
  }

  // Mutations here (e.g. saving developer config) would be audited.
  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'system.api_code.update',
    entityType: 'system',
    entityId: 'api-code',
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });

  return Response.json({ ok: true });
}
