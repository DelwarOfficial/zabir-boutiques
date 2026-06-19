import { writeApiAuditLog } from '../../api-audit';
import { doCheckProviderHealth, doRecordProviderResult } from '../../do-client';
import type { WorkersAIEnv, WorkersAITextResult } from './types';

export class WorkersAIClient {
  constructor(private readonly env: WorkersAIEnv = {}) {}

  async generateProductDescription(prompt: string): Promise<WorkersAITextResult> {
    if (!this.env.AI) {
      return { text: JSON.stringify({ description: prompt.slice(0, 240), metaTitle: 'Product draft', metaDescription: 'Product draft generated locally.' }), tokens_used: 0, cost_usd: 0 };
    }
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const health = this.env.PROVIDER_HEALTH_DO ? await doCheckProviderHealth(this.env, 'workers_ai') : { canProceed: true, state: 'closed' as const };
    if (!health.canProceed) {
      await this.audit(requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', health.state);
      throw new Error('Workers AI circuit breaker is open');
    }
    try {
      const result = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'user', content: prompt }],
      }) as { response?: string };
      const text = result.response ?? '';
      if (!text) {
        if (this.env.PROVIDER_HEALTH_DO) await doRecordProviderResult(this.env, 'workers_ai', false);
        await this.audit(requestId, startedAt, 'error', 'EMPTY_RESPONSE', health.state);
        throw new Error('Workers AI returned empty content');
      }
      if (this.env.PROVIDER_HEALTH_DO) await doRecordProviderResult(this.env, 'workers_ai', true);
      await this.audit(requestId, startedAt, 'success', null, health.state);
      return { text, tokens_used: 0, cost_usd: 0 };
    } catch (err) {
      const code = err instanceof DOMException && err.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED';
      if (this.env.PROVIDER_HEALTH_DO) await doRecordProviderResult(this.env, 'workers_ai', false);
      await this.audit(requestId, startedAt, code === 'TIMEOUT' ? 'timeout' : 'error', code, health.state);
      throw err;
    }
  }

  private async audit(requestId: string, startedAt: number, status: 'success' | 'error' | 'timeout' | 'circuit_open', errorCode: string | null, circuitState: 'closed' | 'open' | 'half_open'): Promise<void> {
    await writeApiAuditLog(this.env.DB, {
      provider: 'workers_ai',
      operation: 'generate_product_description',
      requestId,
      durationMs: Date.now() - startedAt,
      status,
      errorCode,
      circuitState,
    });
  }
}
