import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission } from '../../../../lib/rbac';
import { CloudflareCacheClient } from '../../../../lib/integrations/cloudflare_cache/client';
import { writeCriticalAuditLog, clientIp, userAgent } from '../../../../lib/audit';

interface PurgeBody {
  tags?: string[];
}

export async function POST(context: APIContext): Promise<Response> {
  const user = await requireAuth(context);
  requirePermission(user, 'settings.platform.update');

  const env = getEnv(context);
  let body: PurgeBody = {};
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 30)
    : ['products', 'categories', 'stock'];

  if (tags.length === 0) {
    return Response.json({ ok: false, error: 'At least one cache tag is required' }, { status: 400 });
  }

  await new CloudflareCacheClient(env).purgeTags(tags);
  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'cache.purge',
    entityType: 'cache',
    entityId: tags.join(','),
    metadata: { tags },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({ ok: true, tags });
}
