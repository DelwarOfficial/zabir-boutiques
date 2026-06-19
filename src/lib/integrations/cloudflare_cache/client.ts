import { writeApiAuditLog } from '../../api-audit';
import { doCheckProviderHealth, doRecordProviderResult } from '../../do-client';
import type { CloudflareCacheEnv } from './types';

export class CloudflareCacheClient {
  constructor(private readonly env: CloudflareCacheEnv) {}

  async purgeTags(tags: string[]): Promise<void> {
    if (!this.env.CF_API_TOKEN || !this.env.CF_ZONE_ID || tags.length === 0) return;
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const health = await this.checkCircuit();
    if (!health.canProceed) {
      await this.audit(requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', JSON.stringify({ tags }), '{"error":"circuit_open"}', health.state);
      return;
    }
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${this.env.CF_ZONE_ID}/purge_cache`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      });
      await this.record(res.ok);
      await this.audit(requestId, startedAt, res.ok ? 'success' : 'error', res.ok ? null : `HTTP_${res.status}`, JSON.stringify({ tags }), '{}', health.state);
    } catch (err) {
      await this.record(false);
      await this.audit(requestId, startedAt, 'error', 'REQUEST_FAILED', JSON.stringify({ tags }), JSON.stringify({ error: err instanceof Error ? err.message : 'unknown' }), health.state);
    }
  }

  private async checkCircuit(): Promise<{ canProceed: boolean; state: 'closed' | 'open' | 'half_open' }> {
    if (!this.env.PROVIDER_HEALTH_DO) return { canProceed: true, state: 'closed' };
    return doCheckProviderHealth(this.env, 'cloudflare_cache');
  }

  private async record(success: boolean): Promise<void> {
    if (!this.env.PROVIDER_HEALTH_DO) return;
    await doRecordProviderResult(this.env, 'cloudflare_cache', success);
  }

  private async audit(requestId: string, startedAt: number, status: 'success' | 'error' | 'timeout' | 'circuit_open', errorCode: string | null, requestSummary: string, responseSummary: string, circuitState: 'closed' | 'open' | 'half_open'): Promise<void> {
    await writeApiAuditLog(this.env.DB, {
      provider: 'cloudflare_cache',
      operation: 'purge_cache',
      requestId,
      durationMs: Date.now() - startedAt,
      status,
      errorCode,
      circuitState,
      redactedRequestSummary: requestSummary,
      redactedResponseSummary: responseSummary,
    });
  }
}
