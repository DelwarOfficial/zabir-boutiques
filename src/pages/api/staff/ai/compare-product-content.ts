/**
 * POST /api/staff/ai/compare-product-content — blind A/B (N-29, Master Plan §24.1)
 *
 * Generates the same product content with both providers and returns them as
 * unlabelled slots A and B, in a randomized order. The provider names are
 * deliberately NOT sent to the browser: a comparison where the reviewer can see
 * which one is the expensive model measures expectation, not quality.
 *
 * The mapping is persisted in `ai_generation_trials` and revealed only by
 * POST /api/staff/ai/trial-choice, after a pick is recorded.
 *
 * Both calls pass the same §24.2 budget gate as the normal generate path. A
 * compare is two paid generations, and is charged as such.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission, RbacError } from '../../../../lib/rbac';
import { writeAuditLog, clientIp, userAgent } from '../../../../lib/audit';
import { nowSql } from '../../../../lib/dates';
import { generateProductContent, AIContentError, type GeneratedContent } from '../../../../lib/ai-content';
import { checkAiProviderAllowed, recordAiUsage, type AiProvider } from '../../../../lib/ai-provider-gate';
import { safeLog } from '../../../../lib/pii-scrubber';

type SlotMetrics = {
  words: number;
  metaTitleLength: number;
  metaDescriptionLength: number;
  metaTitleOverran: boolean;
  metaDescriptionOverran: boolean;
  latencyMs: number;
  costUsd: number;
};

function measure(content: GeneratedContent, latencyMs: number, costUsd: number): SlotMetrics {
  return {
    words: content.description.split(/\s+/).filter(Boolean).length,
    metaTitleLength: content.metaTitle.length,
    metaDescriptionLength: content.metaDescription.length,
    metaTitleOverran: content.metaTitleOverran === true,
    metaDescriptionOverran: content.metaDescriptionOverran === true,
    latencyMs,
    costUsd,
  };
}

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let user: Awaited<ReturnType<typeof requireAuth>>;
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
  if (!name) return Response.json({ error: 'Product name is required' }, { status: 400 });

  // Both providers are explicitly requested here, so neither is "via fallback":
  // this is a deliberate spend, not an outage detour.
  for (const provider of ['deepseek', 'workers_ai'] as AiProvider[]) {
    const gate = await checkAiProviderAllowed(env, provider, false);
    if (!gate.allowed) {
      return Response.json(
        { ok: false, code: gate.code, error: 'AI budget limit reached — comparison unavailable.' },
        { status: 429 },
      );
    }
  }

  const productInput = {
    name,
    category: body.category,
    pricePaisa: body.price_paisa,
    keyFeatures: body.key_features,
    targetAudience: body.target_audience,
    style: body.style,
  };

  async function runOne(provider: AiProvider) {
    const startedAt = Date.now();
    const content = await generateProductContent(productInput, env, provider);
    const latencyMs = Date.now() - startedAt;
    await recordAiUsage(env, provider, {
      tokens: content.tokens_used,
      cost_usd: content.cost_usd,
      request_id: crypto.randomUUID(),
      staff_id: user.id,
      operation: 'product_description_trial',
    });
    // Return ONLY the copy fields. `content` also carries `provider`,
    // `tokens_used` and `cost_usd`, and spreading it wholesale would put the
    // provider name straight into the browser — defeating the blind.
    const blind: GeneratedContent = {
      description: content.description,
      metaTitle: content.metaTitle,
      metaDescription: content.metaDescription,
    };
    return { content: blind, metrics: measure(content, latencyMs, content.cost_usd) };
  }

  let deepseek, workersAi;
  try {
    // Sequential, not parallel: a compare that half-fails should not leave one
    // provider charged for output nobody will ever see.
    deepseek = await runOne('deepseek');
    workersAi = await runOne('workers_ai');
  } catch (err) {
    if (err instanceof AIContentError) {
      safeLog.warn('[ai/compare] unusable AI response', { code: err.code });
      return Response.json(
        { ok: false, code: err.code, error: 'One provider returned unusable content — please try again.' },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : 'AI comparison failed';
    safeLog.error('[ai/compare] failed', { error: message });
    return Response.json({ ok: false, error: message }, { status: 502 });
  }

  // Randomize which provider occupies slot A. crypto.getRandomValues rather
  // than Math.random so the ordering cannot be predicted and quietly bias a
  // reviewer who runs many trials in a row.
  const coin = crypto.getRandomValues(new Uint8Array(1))[0] < 128;
  const slotA = coin ? deepseek : workersAi;
  const slotB = coin ? workersAi : deepseek;
  const slotAProvider: AiProvider = coin ? 'deepseek' : 'workers_ai';
  const slotBProvider: AiProvider = coin ? 'workers_ai' : 'deepseek';

  const trialId = crypto.randomUUID();
  const now = nowSql();
  await env.DB.prepare(
    `INSERT INTO ai_generation_trials (id, staff_id, product_name, slot_a_provider, slot_b_provider, metrics_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      trialId,
      user.id,
      name,
      slotAProvider,
      slotBProvider,
      JSON.stringify({ a: slotA.metrics, b: slotB.metrics }),
      now,
    )
    .run();

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'ai.product_content.compare',
    entityType: 'ai_generation_trial',
    entityId: trialId,
    metadata: { product_name: name },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  // costUsd identifies the provider as surely as its name would: a slot priced
  // at $0 is Workers AI. It stays in metrics_json for the server-side rollup
  // and is stripped from anything the reviewer can see.
  const blindMetrics = ({ costUsd, ...rest }: SlotMetrics) => rest;

  return Response.json({
    ok: true,
    trial_id: trialId,
    // No provider names, no prices. Revealed only after a pick is recorded.
    a: { content: slotA.content, metrics: blindMetrics(slotA.metrics) },
    b: { content: slotB.content, metrics: blindMetrics(slotB.metrics) },
  });
}
