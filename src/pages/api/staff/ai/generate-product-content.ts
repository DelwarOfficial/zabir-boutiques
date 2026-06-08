export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission, RbacError } from '../../../../lib/rbac';
import { writeAuditLog, clientIp, userAgent } from '../../../../lib/audit';
import { generateProductContent } from '../../../../lib/ai-content';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'products.manage');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  if (!name) {
    return Response.json({ error: 'Product name is required' }, { status: 400 });
  }

  try {
    // Budget gate: KV-based monthly cap per Master Plan 3.35
    const budgetKey = 'AI_MONTHLY_USAGE_COUNT';
    const AI_MONTHLY_CAP = 200; // max generations per month
    const currentUsage = parseInt(await env.CACHE.get(budgetKey) ?? '0', 10);
    if (currentUsage >= AI_MONTHLY_CAP) {
      return Response.json({ ok: false, error: 'AI generation budget exhausted for this month.' }, { status: 429 });
    }

    const content = await generateProductContent(
      {
        name,
        category: body.category,
        pricePaisa: body.price_paisa,
        keyFeatures: body.key_features,
        targetAudience: body.target_audience,
        style: body.style
      },
      env.DEEPSEEK_API_KEY,
      env.OPENAI_API_KEY,
      body.provider ?? 'deepseek'
    );

    await writeAuditLog(env.DB, {
      actorStaffId: user.id,
      actorRole: user.role,
      action: 'ai.product_content.generate',
      entityType: 'product',
      entityId: name,
      metadata: { provider: body.provider ?? 'deepseek' },
      ipAddress: clientIp(context.request),
      userAgent: userAgent(context.request)
    });

    // Increment budget counter (TTL: 35 days to cover the month + buffer)
    await env.CACHE.put(budgetKey, String(currentUsage + 1), { expirationTtl: 35 * 24 * 60 * 60 });

    return Response.json({ ok: true, content });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI generation failed';
    console.error('[ai/generate-product-content]', err);
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
