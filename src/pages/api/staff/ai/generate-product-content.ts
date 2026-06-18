export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission, RbacError } from '../../../../lib/rbac';
import { writeAuditLog, clientIp, userAgent } from '../../../../lib/audit';
import { generateProductContent } from '../../../../lib/ai-content';
import { safeLog } from '../../../../lib/pii-scrubber';
import { chargeBudget } from '../../../../do/budget-counter-do';

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
    // Budget gate: BudgetCounterDO [Master_Prompt v7.0 §24.2]
    // 50 generations/day, 1000 generations/month
    const budgetResult = await chargeBudget(env, 'ai:product-content:daily', 1, 'product-content');
    if (!budgetResult.allowed) {
      return Response.json({ ok: false, error: 'AI generation budget exhausted for today.' }, { status: 429 });
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

    return Response.json({ ok: true, content });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI generation failed';
    safeLog.error('[ai/generate-product-content] failed', { error: message });
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
