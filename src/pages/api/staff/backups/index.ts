import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission, RbacError } from '../../../../lib/rbac';

export async function GET(context: APIContext): Promise<Response> {
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'backups.restore');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const env = getEnv(context);

  const policy = {
    d1Schedule: 'Sunday 04:00 UTC',
    d1Target: 'R2 backups/d1/weekly/',
    retention: 8,
    retentionUnit: 'weekly',
    logArchive: 'Monthly 1st 05:00 UTC',
    logArchiveTarget: 'R2 archive',
  };

  let backups: any[] = [];
  try {
    const rows = await env.DB.prepare(
      `SELECT id, type, status, size_bytes, r2_key, created_by, created_at
       FROM backups ORDER BY created_at DESC LIMIT 20`
    ).all<any>();
    backups = rows.results ?? [];
  } catch {
  }

  return Response.json({
    ok: true,
    policy,
    backups,
    backupCount: backups.length,
  });
}

export async function POST(context: APIContext): Promise<Response> {
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'backups.restore');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let body: any;
  try { body = await context.request.json(); } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (action === 'trigger') {
    return Response.json({
      ok: false,
      error: 'On-demand backup trigger is not yet implemented. Scheduled backups run per policy.',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  }

  return Response.json({ ok: false, error: 'Invalid action. Use "trigger".' }, { status: 400 });
}
