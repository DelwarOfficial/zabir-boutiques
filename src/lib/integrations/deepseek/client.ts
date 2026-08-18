import { DeepSeekError } from './errors';
import type { DeepSeekEnv, DeepSeekTextResult, DeepSeekUsage } from './types';
import { writeApiAuditLog } from '../../api-audit';
import { doCheckProviderHealth, doRecordProviderResult } from '../../do-client';

/**
 * N-29: published deepseek-chat rates, in USD per MILLION tokens.
 *
 * The previous `tokens * 0.000002` applied one invented flat rate to every
 * token, ignoring the ~4x gap between input and output and the ~4x discount on
 * a prompt-cache hit. Budget enforcement (Section 24.2, $5.00/day) is built on
 * this number, so an invented rate means the daily cap triggers at the wrong
 * spend in a direction nobody can predict.
 *
 * These are rates, not truths: verify against
 * https://api-docs.deepseek.com/quick_start/pricing when the provider changes
 * pricing. `deepseek-pricing.test.ts` pins the arithmetic, not the rates.
 */
export const DEEPSEEK_RATES_USD_PER_MTOK = {
  promptCacheHit: 0.07,
  promptCacheMiss: 0.27,
  completion: 1.10,
} as const;

export function deepSeekCostUsd(usage: DeepSeekUsage): number {
  const perMillion =
    usage.promptCacheHitTokens * DEEPSEEK_RATES_USD_PER_MTOK.promptCacheHit +
    usage.promptCacheMissTokens * DEEPSEEK_RATES_USD_PER_MTOK.promptCacheMiss +
    usage.completionTokens * DEEPSEEK_RATES_USD_PER_MTOK.completion;
  return perMillion / 1_000_000;
}

function readUsage(raw: unknown): DeepSeekUsage {
  const u = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const total = num(u.total_tokens);
  const hit = num(u.prompt_cache_hit_tokens);
  const completion = num(u.completion_tokens);
  // Older/partial responses report only prompt_tokens. Charging an unknown
  // split at the CACHE MISS rate is the conservative direction: it overstates
  // spend slightly rather than letting the daily cap run past its limit.
  const miss = u.prompt_cache_miss_tokens !== undefined
    ? num(u.prompt_cache_miss_tokens)
    : Math.max(0, num(u.prompt_tokens) - hit);
  return {
    promptCacheHitTokens: hit,
    promptCacheMissTokens: miss,
    completionTokens: completion,
    totalTokens: total || hit + miss + completion,
  };
}

export class DeepSeekClient {
  constructor(private readonly env: DeepSeekEnv) {}

  async generateProductDescription(prompt: string): Promise<DeepSeekTextResult> {
    if (!this.env.DEEPSEEK_API_KEY) throw new DeepSeekError('DeepSeek API key not configured', 'NO_DEEPSEEK_API_KEY');

    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const health = await doCheckProviderHealth(this.env, 'deepseek');
    if (!health.canProceed) {
      await this.audit(requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', health.state);
      throw new DeepSeekError('DeepSeek circuit breaker is open', 'CIRCUIT_OPEN');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${this.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          // N-29: constrain the decoder to valid JSON instead of asking the
          // prompt nicely and regex-scraping whatever comes back. The caller
          // parses this strictly, so a stray code fence or a preamble is no
          // longer something that can end up published as product copy.
          response_format: { type: 'json_object' },
          temperature: 0.7,
          max_tokens: 1000,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const isCircuitFailure = res.status >= 500;
        if (isCircuitFailure) await doRecordProviderResult(this.env, 'deepseek', false);
        await this.audit(requestId, startedAt, 'error', `HTTP_${res.status}`, health.state);
        throw new DeepSeekError(`DeepSeek API error: ${res.status}`, `HTTP_${res.status}`);
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text) {
        await doRecordProviderResult(this.env, 'deepseek', false);
        await this.audit(requestId, startedAt, 'error', 'EMPTY_RESPONSE', health.state);
        throw new DeepSeekError('DeepSeek returned empty content', 'EMPTY_RESPONSE');
      }
      const usage = readUsage(data.usage);
      await doRecordProviderResult(this.env, 'deepseek', true);
      await this.audit(requestId, startedAt, 'success', null, health.state);
      return { text, tokens_used: usage.totalTokens, cost_usd: deepSeekCostUsd(usage), usage };
    } catch (err) {
      if (err instanceof DeepSeekError) throw err;
      const code = err instanceof DOMException && err.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED';
      await doRecordProviderResult(this.env, 'deepseek', false);
      await this.audit(requestId, startedAt, code === 'TIMEOUT' ? 'timeout' : 'error', code, health.state);
      throw new DeepSeekError(`DeepSeek ${code}`, code);
    } finally {
      clearTimeout(timer);
    }
  }

  private async audit(requestId: string, startedAt: number, status: 'success' | 'error' | 'timeout' | 'circuit_open', errorCode: string | null, circuitState: 'closed' | 'open' | 'half_open'): Promise<void> {
    await writeApiAuditLog(this.env.DB, {
      provider: 'deepseek',
      operation: 'generate_product_description',
      requestId,
      durationMs: Date.now() - startedAt,
      status,
      errorCode,
      circuitState,
    });
  }
}
