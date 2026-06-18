import { writeApiAuditLog } from '../../api-audit';
import { doCheckProviderHealth, doRecordProviderResult } from '../../do-client';
import type { FraudBDEnv, FraudBDResult } from './types';

export class FraudBDClient {
  constructor(private readonly env: FraudBDEnv) {}

  async checkCourierInfo(localPhone: string, timeoutMs = 1500, baseUrl = 'https://fraudbd.com'): Promise<FraudBDResult> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const health = await this.checkCircuit();
    if (!health.canProceed) {
      const rawResponse = '{"error":"circuit_open","fallback_score":50}';
      await this.audit(requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', JSON.stringify({ phone_number: '[redacted]' }), rawResponse, health.state);
      return { data: null, rawResponse, circuitOpen: true };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/api/check-courier-info`, {
        method: 'POST',
        headers: {
          api_key: this.env.FRAUDBD_API_KEY ?? '',
          accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone_number: localPhone }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      const rawResponse = JSON.stringify(data ?? { error: 'invalid_json' });
      await this.record(res.ok);
      await this.audit(requestId, startedAt, res.ok ? 'success' : 'error', res.ok ? null : `HTTP_${res.status}`, JSON.stringify({ phone_number: '[redacted]' }), rawResponse, health.state);
      return { data, rawResponse, circuitOpen: false };
    } catch (err) {
      const code = err instanceof DOMException && err.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED';
      await this.record(false);
      await this.audit(requestId, startedAt, code === 'TIMEOUT' ? 'timeout' : 'error', code, JSON.stringify({ phone_number: '[redacted]' }), JSON.stringify({ error: code }), health.state);
      return { data: null, rawResponse: JSON.stringify({ error: code }), circuitOpen: false };
    } finally {
      clearTimeout(timer);
    }
  }

  private async checkCircuit(): Promise<{ canProceed: boolean; state: 'closed' | 'open' | 'half_open' }> {
    if (!this.env.PROVIDER_HEALTH_DO) return { canProceed: true, state: 'closed' };
    return doCheckProviderHealth(this.env, 'fraudbd');
  }

  private async record(success: boolean): Promise<void> {
    if (!this.env.PROVIDER_HEALTH_DO) return;
    await doRecordProviderResult(this.env, 'fraudbd', success);
  }

  private async audit(requestId: string, startedAt: number, status: 'success' | 'error' | 'timeout' | 'circuit_open', errorCode: string | null, requestSummary: string, responseSummary: string, circuitState: 'closed' | 'open' | 'half_open'): Promise<void> {
    await writeApiAuditLog(this.env.DB, {
      provider: 'fraudbd',
      operation: 'check_courier_info',
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
