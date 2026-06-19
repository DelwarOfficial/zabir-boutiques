import { writeApiAuditLog } from '../../api-audit';
import { doCheckProviderHealth, doRecordProviderResult } from '../../do-client';
import type { TurnstileResult } from '../../turnstile';
import type { CloudflareTurnstileEnv } from './types';

export class CloudflareTurnstileClient {
  constructor(private readonly env: CloudflareTurnstileEnv) {}

  async verify(token: string, remoteIp?: string): Promise<TurnstileResult> {
    if (!this.env.TURNSTILE_SECRET_KEY) return { ok: true };
    if (!token) return { ok: false, errors: ['missing-token'] };

    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const health = await this.checkCircuit();
    if (!health.canProceed) {
      await this.audit(requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', JSON.stringify({ remote_ip: remoteIp ? '[redacted]' : null }), '{"error":"circuit_open"}', health.state);
      return { ok: false, errors: ['circuit_open'] };
    }

    const form = new URLSearchParams();
    form.set('secret', this.env.TURNSTILE_SECRET_KEY);
    form.set('response', token);
    if (remoteIp) form.set('remoteip', remoteIp);

    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        await this.record(false);
        await this.audit(requestId, startedAt, 'error', `HTTP_${res.status}`, JSON.stringify({ remote_ip: remoteIp ? '[redacted]' : null }), '{}', health.state);
        return { ok: false, errors: [`http_${res.status}`] };
      }
      const data = (await res.json()) as TurnstileResult;
      await this.record(Boolean(data.ok));
      await this.audit(requestId, startedAt, data.ok ? 'success' : 'error', data.ok ? null : (data.errors?.[0] ?? 'VERIFY_FAILED'), JSON.stringify({ remote_ip: remoteIp ? '[redacted]' : null }), JSON.stringify({ ok: data.ok, errors: data.errors ?? [] }), health.state);
      return data;
    } catch (err) {
      await this.record(false);
      await this.audit(requestId, startedAt, 'error', 'REQUEST_FAILED', JSON.stringify({ remote_ip: remoteIp ? '[redacted]' : null }), JSON.stringify({ error: err instanceof Error ? err.message : 'unknown' }), health.state);
      return { ok: false, errors: ['request_failed'] };
    }
  }

  private async checkCircuit(): Promise<{ canProceed: boolean; state: 'closed' | 'open' | 'half_open' }> {
    if (!this.env.PROVIDER_HEALTH_DO) return { canProceed: true, state: 'closed' };
    return doCheckProviderHealth(this.env, 'cloudflare_turnstile');
  }

  private async record(success: boolean): Promise<void> {
    if (!this.env.PROVIDER_HEALTH_DO) return;
    await doRecordProviderResult(this.env, 'cloudflare_turnstile', success);
  }

  private async audit(requestId: string, startedAt: number, status: 'success' | 'error' | 'timeout' | 'circuit_open', errorCode: string | null, requestSummary: string, responseSummary: string, circuitState: 'closed' | 'open' | 'half_open'): Promise<void> {
    await writeApiAuditLog(this.env.DB, {
      provider: 'cloudflare_turnstile',
      operation: 'siteverify',
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
