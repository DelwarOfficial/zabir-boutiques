/**
 * N-29: product-description generation quality and cost controls.
 *
 * Two classes of defect are pinned here:
 *   1. Output that was silently degraded — an unparseable AI response used to
 *      be sliced into the description field and published.
 *   2. Spend that was never counted — Workers AI usage and the §24.2 hourly
 *      fallback cap.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseContentResponse,
  trimToLimit,
  AIContentError,
  META_TITLE_MAX,
  META_DESCRIPTION_MAX,
} from '../src/lib/ai-content';
import { deepSeekCostUsd, DEEPSEEK_RATES_USD_PER_MTOK } from '../src/lib/integrations/deepseek/client';
import { claimAiFallbackSlot, fallbackCapKey, AI_FALLBACK_HOURLY_CAP } from '../src/lib/ai-fallback-cap';

const GOOD = JSON.stringify({
  description: 'A beautifully embroidered three-piece set, cut from soft lawn cotton and finished with hand-worked detailing across the yoke. Ideal for both daytime wear and evening occasions.',
  metaTitle: 'Embroidered Lawn Three-Piece',
  metaDescription: 'Soft lawn cotton three-piece with hand-worked embroidery. Free delivery inside Dhaka.',
});

describe('strict parsing of AI content', () => {
  it('accepts a well-formed response', () => {
    const result = parseContentResponse(GOOD);
    expect(result.metaTitle).toBe('Embroidered Lawn Three-Piece');
    expect(result.description).toContain('embroidered');
  });

  it('tolerates a fenced code block, which models emit routinely', () => {
    expect(parseContentResponse('```json\n' + GOOD + '\n```').metaTitle).toBe('Embroidered Lawn Three-Piece');
  });

  it('throws instead of publishing a refusal as the product description', () => {
    // The old implementation stored `cleaned.slice(0, 500)` — i.e. this exact
    // sentence would have become the customer-facing copy.
    const refusal = "I'm sorry, but I can't help with that request.";
    expect(() => parseContentResponse(refusal)).toThrow(AIContentError);
    try {
      parseContentResponse(refusal);
    } catch (err) {
      expect((err as AIContentError).code).toBe('UNPARSEABLE_RESPONSE');
    }
  });

  it('throws on a preamble wrapped around valid JSON', () => {
    expect(() => parseContentResponse('Sure! Here is your content:\n' + GOOD)).toThrow(AIContentError);
  });

  it('throws when a required field is missing, empty or too short', () => {
    const cases = [
      { description: 'x'.repeat(80), metaTitle: '', metaDescription: 'm' },
      { description: 'x'.repeat(80), metaTitle: 't', metaDescription: '' },
      { description: 'too short', metaTitle: 't', metaDescription: 'm' },
      { metaTitle: 't', metaDescription: 'm' },
    ];
    for (const c of cases) {
      expect(() => parseContentResponse(JSON.stringify(c))).toThrow(AIContentError);
    }
  });

  it('rejects a JSON array or a bare string', () => {
    expect(() => parseContentResponse('[]')).toThrow(AIContentError);
    expect(() => parseContentResponse('"just a string"')).toThrow(AIContentError);
  });
});

describe('SEO field caps', () => {
  it('enforces the documented limits on the parsed result', () => {
    const long = JSON.stringify({
      description: 'x'.repeat(200),
      metaTitle: 'Exquisite Hand Embroidered Premium Lawn Cotton Three Piece Set For Eid Celebrations',
      metaDescription: 'A truly exceptional and beautifully crafted three piece set featuring intricate hand embroidery across the yoke and sleeves, made from the finest soft lawn cotton available anywhere in Dhaka today.',
    });
    const result = parseContentResponse(long);
    expect(result.metaTitle.length).toBeLessThanOrEqual(META_TITLE_MAX);
    expect(result.metaDescription.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
  });

  it('trims on a word boundary rather than severing a word', () => {
    const trimmed = trimToLimit('Embroidered lawn cotton three piece celebration set', 30);
    expect(trimmed.length).toBeLessThanOrEqual(30);
    expect(trimmed.endsWith(' ')).toBe(false);
    // Every retained token is a whole word from the input.
    const source = 'Embroidered lawn cotton three piece celebration set'.split(' ');
    for (const word of trimmed.split(' ')) expect(source).toContain(word);
  });

  it('leaves a field that already fits completely untouched', () => {
    expect(trimToLimit('Short title', META_TITLE_MAX)).toBe('Short title');
  });
});

describe('DeepSeek cost accounting', () => {
  it('prices input and output separately instead of one flat rate', () => {
    const inputOnly = deepSeekCostUsd({ promptCacheHitTokens: 0, promptCacheMissTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 });
    const outputOnly = deepSeekCostUsd({ promptCacheHitTokens: 0, promptCacheMissTokens: 0, completionTokens: 1_000_000, totalTokens: 1_000_000 });
    expect(inputOnly).toBeCloseTo(DEEPSEEK_RATES_USD_PER_MTOK.promptCacheMiss, 10);
    expect(outputOnly).toBeCloseTo(DEEPSEEK_RATES_USD_PER_MTOK.completion, 10);
    // The old `tokens * 0.000002` gave both the same price. It must not.
    expect(outputOnly).not.toBeCloseTo(inputOnly, 6);
  });

  it('charges a cache hit less than a cache miss', () => {
    const hit = deepSeekCostUsd({ promptCacheHitTokens: 500_000, promptCacheMissTokens: 0, completionTokens: 0, totalTokens: 500_000 });
    const miss = deepSeekCostUsd({ promptCacheHitTokens: 0, promptCacheMissTokens: 500_000, completionTokens: 0, totalTokens: 500_000 });
    expect(hit).toBeLessThan(miss);
  });

  it('is zero for zero usage and never negative', () => {
    expect(deepSeekCostUsd({ promptCacheHitTokens: 0, promptCacheMissTokens: 0, completionTokens: 0, totalTokens: 0 })).toBe(0);
  });

  it('sends JSON mode so the decoder is constrained, not merely asked', () => {
    const src = readFileSync(resolve('src/lib/integrations/deepseek/client.ts'), 'utf8');
    expect(src).toContain("response_format: { type: 'json_object' }");
  });
});

describe('Workers AI fallback hourly cap (§24.2)', () => {
  function kv() {
    const store = new Map<string, string>();
    return {
      store,
      CACHE: {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => { store.set(k, v); },
      } as unknown as KVNamespace,
    };
  }

  it('keys the counter by UTC hour', () => {
    expect(fallbackCapKey(new Date('2026-08-18T14:37:02Z'))).toBe('ai_fallback:2026-08-18T14');
    expect(fallbackCapKey(new Date('2026-08-18T15:00:00Z'))).toBe('ai_fallback:2026-08-18T15');
  });

  it('allows calls up to the cap and blocks the one after', async () => {
    const { CACHE } = kv();
    for (let i = 0; i < AI_FALLBACK_HOURLY_CAP; i++) {
      expect((await claimAiFallbackSlot({ CACHE })).allowed, `call ${i + 1}`).toBe(true);
    }
    expect((await claimAiFallbackSlot({ CACHE })).allowed).toBe(false);
  });

  it('resets on the next UTC hour', async () => {
    const { CACHE } = kv();
    const hour1 = new Date('2026-08-18T14:00:00Z');
    for (let i = 0; i < AI_FALLBACK_HOURLY_CAP; i++) await claimAiFallbackSlot({ CACHE }, hour1);
    expect((await claimAiFallbackSlot({ CACHE }, hour1)).allowed).toBe(false);
    expect((await claimAiFallbackSlot({ CACHE }, new Date('2026-08-18T15:00:00Z'))).allowed).toBe(true);
  });

  it('increments before the call, so a crashed generation still consumes budget', async () => {
    const { CACHE, store } = kv();
    await claimAiFallbackSlot({ CACHE }, new Date('2026-08-18T14:00:00Z'));
    expect(store.get('ai_fallback:2026-08-18T14')).toBe('1');
  });

  it('fails open when KV is unavailable — the cap is a backstop, not a gate', async () => {
    const broken = { get: async () => { throw new Error('kv down'); }, put: async () => {} } as unknown as KVNamespace;
    expect((await claimAiFallbackSlot({ CACHE: broken })).allowed).toBe(true);
    expect((await claimAiFallbackSlot({})).allowed).toBe(true);
  });

  it('treats a corrupt counter value as zero rather than blocking forever', async () => {
    const { CACHE, store } = kv();
    store.set(fallbackCapKey(), 'not-a-number');
    expect((await claimAiFallbackSlot({ CACHE })).allowed).toBe(true);
  });
});

describe('Workers AI is metered at all (CF-08)', () => {
  it('routes both providers through the shared budget gate', async () => {
    const gate = await import('../src/lib/ai-provider-gate');
    expect(typeof gate.checkAiProviderAllowed).toBe('function');
    expect(typeof gate.recordAiUsage).toBe('function');
  });

  it('exposes a Workers AI recorder from the budget DO module', async () => {
    const mod = await import('../src/do/budget-counter-do');
    expect(typeof mod.recordWorkersAIUsage).toBe('function');
  });

  it('records against the provider that actually ran, not always DeepSeek', async () => {
    vi.resetModules();
    const recordDeepSeekUsage = vi.fn();
    const recordWorkersAIUsage = vi.fn();
    vi.doMock('../src/do/budget-counter-do', () => ({
      canUseDeepSeekBudget: vi.fn().mockResolvedValue(true),
      canUseWorkersAIBudget: vi.fn().mockResolvedValue(true),
      recordDeepSeekUsage,
      recordWorkersAIUsage,
    }));
    const { recordAiUsage } = await import('../src/lib/ai-provider-gate');
    const usage = { tokens: 1, cost_usd: 0, request_id: 'r', staff_id: 's', operation: 'o' };

    await recordAiUsage({} as any, 'workers_ai', usage);
    expect(recordWorkersAIUsage).toHaveBeenCalledTimes(1);
    expect(recordDeepSeekUsage).not.toHaveBeenCalled();

    await recordAiUsage({} as any, 'deepseek', usage);
    expect(recordDeepSeekUsage).toHaveBeenCalledTimes(1);
    vi.doUnmock('../src/do/budget-counter-do');
    vi.resetModules();
  });

  it('caps only the fallback route into Workers AI, not an explicit request', async () => {
    vi.resetModules();
    vi.doMock('../src/do/budget-counter-do', () => ({
      canUseDeepSeekBudget: vi.fn().mockResolvedValue(true),
      canUseWorkersAIBudget: vi.fn().mockResolvedValue(true),
      recordDeepSeekUsage: vi.fn(),
      recordWorkersAIUsage: vi.fn(),
    }));
    const { checkAiProviderAllowed } = await import('../src/lib/ai-provider-gate');
    const store = new Map<string, string>();
    const env = { CACHE: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } } } as any;

    // Explicit requests never touch the hourly fallback counter.
    for (let i = 0; i < AI_FALLBACK_HOURLY_CAP + 5; i++) {
      expect((await checkAiProviderAllowed(env, 'workers_ai', false)).allowed).toBe(true);
    }
    expect(store.size).toBe(0);

    // Fallback calls do.
    for (let i = 0; i < AI_FALLBACK_HOURLY_CAP; i++) {
      expect((await checkAiProviderAllowed(env, 'workers_ai', true)).allowed).toBe(true);
    }
    const blocked = await checkAiProviderAllowed(env, 'workers_ai', true);
    expect(blocked).toEqual({ allowed: false, code: 'AI_FALLBACK_CAP_REACHED' });
    vi.doUnmock('../src/do/budget-counter-do');
    vi.resetModules();
  });

  it('never blocks the staff action when the budget check itself fails', async () => {
    vi.resetModules();
    vi.doMock('../src/do/budget-counter-do', () => ({
      canUseDeepSeekBudget: vi.fn().mockRejectedValue(new Error('DO unreachable')),
      canUseWorkersAIBudget: vi.fn().mockRejectedValue(new Error('DO unreachable')),
      recordDeepSeekUsage: vi.fn(),
      recordWorkersAIUsage: vi.fn(),
    }));
    const { checkAiProviderAllowed } = await import('../src/lib/ai-provider-gate');
    expect((await checkAiProviderAllowed({} as any, 'deepseek', false)).allowed).toBe(true);
    vi.doUnmock('../src/do/budget-counter-do');
    vi.resetModules();
  });

  it('blocks when the budget is genuinely exhausted', async () => {
    vi.resetModules();
    vi.doMock('../src/do/budget-counter-do', () => ({
      canUseDeepSeekBudget: vi.fn().mockResolvedValue(false),
      canUseWorkersAIBudget: vi.fn().mockResolvedValue(false),
      recordDeepSeekUsage: vi.fn(),
      recordWorkersAIUsage: vi.fn(),
    }));
    const { checkAiProviderAllowed } = await import('../src/lib/ai-provider-gate');
    expect(await checkAiProviderAllowed({} as any, 'deepseek', false)).toEqual({ allowed: false, code: 'AI_BUDGET_REACHED' });
    vi.doUnmock('../src/do/budget-counter-do');
    vi.resetModules();
  });
});
