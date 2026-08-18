import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission, RbacError } from '../../../../lib/rbac';
import { writeAuditLog, clientIp, userAgent } from '../../../../lib/audit';
import { generateProductContent } from '../../../../lib/ai-content';
import { safeLog } from '../../../../lib/pii-scrubber';
import { canUseDeepSeekBudget } from '../../../../do/budget-counter-do';
import { checkAiProviderAllowed, recordAiUsage } from '../../../../lib/ai-provider-gate';
import { AIContentError } from '../../../../lib/ai-content';

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
    // §24.1: DeepSeek is primary for product descriptions. Workers AI is the
    // fallback, and every route into it is metered — see below.
    let provider: 'deepseek' | 'workers_ai' = body.provider === 'workers_ai' ? 'workers_ai' : 'deepseek';
    let viaFallback = provider === 'workers_ai';
    if (provider === 'deepseek') {
      try {
        const allowed = await canUseDeepSeekBudget(env);
        if (!allowed) {
          provider = 'workers_ai';
          viaFallback = true;
        }
      } catch {
        // §24.2: a budget-check timeout must never block the staff action.
        provider = 'workers_ai';
        viaFallback = true;
      }
    }

    const gate = await checkAiProviderAllowed(env, provider, viaFallback);
    if (!gate.allowed) {
      const error = gate.code === 'AI_FALLBACK_CAP_REACHED'
        ? 'AI is temporarily unavailable — please write the description manually.'
        : 'AI budget limit reached — please write the description manually.';
      return Response.json({ ok: false, code: gate.code, error }, { status: 429 });
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

    const usage = {
      tokens: content.tokens_used,
      cost_usd: content.cost_usd,
      request_id: crypto.randomUUID(),
      staff_id: user.id,
      operation: 'product_description',
    };
    await recordAiUsage(env, content.provider, usage);

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
    // N-29: a generation that produced no usable content is surfaced to the
    // staff member to retry, not silently degraded into published copy.
    if (err instanceof AIContentError) {
      safeLog.warn('[ai/generate-product-content] unusable AI response', { code: err.code });
      return Response.json(
        { ok: false, code: err.code, error: 'AI returned unusable content — please try again.' },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : 'AI generation failed';
    safeLog.error('[ai/generate-product-content] failed', { error: message });
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
