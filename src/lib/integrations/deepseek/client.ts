import { DeepSeekError } from './errors';
import type { DeepSeekEnv, DeepSeekTextResult } from './types';
import { writeApiAuditLog } from '../../api-audit';
import { doCheckProviderHealth, doRecordProviderResult } from '../../do-client';

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
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text) {
        await doRecordProviderResult(this.env, 'deepseek', false);
        await this.audit(requestId, startedAt, 'error', 'EMPTY_RESPONSE', health.state);
        throw new DeepSeekError('DeepSeek returned empty content', 'EMPTY_RESPONSE');
      }
      const tokens = data.usage?.total_tokens ?? 0;
      await doRecordProviderResult(this.env, 'deepseek', true);
      await this.audit(requestId, startedAt, 'success', null, health.state);
      return { text, tokens_used: tokens, cost_usd: tokens * 0.000002 };
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
