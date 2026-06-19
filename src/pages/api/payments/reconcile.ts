import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { nowSql } from '../../../lib/dates';
import { requireAuth } from '../../../lib/rbac';
import { reconcilePendingPayments } from '../../../lib/maintenance/reconciliation';

export async function POST(context: APIContext): Promise<Response> {
  const user = await requireAuth(context);
  if (!user) {
    return Response.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (user.role !== 'owner' && user.role !== 'manager') {
    return Response.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
  }

  const env = getEnv(context) as Parameters<typeof reconcilePendingPayments>[0];
  const now = nowSql();
  const result = await reconcilePendingPayments(env, now);
  return Response.json({ ok: true, ...result });
}
