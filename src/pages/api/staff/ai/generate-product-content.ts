import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission, RbacError } from '../../../../lib/rbac';
import { writeAuditLog, clientIp, userAgent } from '../../../../lib/audit';
import { generateProductContent } from '../../../../lib/ai-content';
import { safeLog } from '../../../../lib/pii-scrubber';
import { canUseDeepSeekBudget, recordDeepSeekUsage } from '../../../../do/budget-counter-do';

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
    let provider: 'deepseek' | 'workers_ai' = body.provider === 'workers_ai' ? 'workers_ai' : 'deepseek';
    if (provider === 'deepseek') {
      try {
        const allowed = await canUseDeepSeekBudget(env);
        if (!allowed) provider = 'workers_ai';
      } catch {
        provider = 'workers_ai';
      }
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
      env,
      provider,
    );

    if (content.provider === 'deepseek') {
      await recordDeepSeekUsage(env, {
        tokens: content.tokens_used,
        cost_usd: content.cost_usd,
        request_id: crypto.randomUUID(),
        staff_id: user.id,
        operation: 'product_description',
      });
    }

    await writeAuditLog(env.DB, {
      actorStaffId: user.id,
      actorRole: user.role,
      action: 'ai.product_content.generate',
      entityType: 'product',
      entityId: name,
      metadata: { provider: content.provider },
      ipAddress: clientIp(context.request),
      userAgent: userAgent(context.request)
    });

    return Response.json({ ok: true, content });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI generation failed';
    safeLog.error('[ai/generate-product-content] failed', { error: message });
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
