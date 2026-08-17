import { writeApiAuditLog } from '../../api-audit';
import { doCheckProviderHealth, doRecordProviderResult } from '../../do-client';
import type { TurnstileResult } from '../../turnstile';
import type { CloudflareSiteverifyResponse, CloudflareTurnstileEnv } from './types';

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
        // N-23: the Content-Type was left implicit. Passing URLSearchParams as
        // a body usually makes the runtime infer
        // `application/x-www-form-urlencoded`, but that inference is not
        // guaranteed in the Workers runtime, and siteverify answers a request
        // it cannot parse with a bare HTTP 400 — which is exactly what
        // production was returning. Set it explicitly, per the canonical
        // integration in Cloudflare's own Turnstile setup flow.
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        // Fail fast rather than hanging a login request on a stalled upstream.
        signal: AbortSignal.timeout(10_000),
        body: form,
      });
      if (!res.ok) {
        // N-22: this discarded the response body, so a non-2xx from
        // siteverify surfaced only as a bare status with no cause. Cloudflare
        // returns its complaint (malformed secret, bad parameters) in the
        // body, which is the one thing needed to tell a misconfigured secret
        // from a genuinely broken request. Capture it; siteverify never
        // echoes the secret back, so there is nothing sensitive to leak here.
        const rawBody = await res.text().catch(() => '');
        await this.record(false);
        await this.audit(
          requestId,
          startedAt,
          'error',
          `HTTP_${res.status}`,
          JSON.stringify({ remote_ip: remoteIp ? '[redacted]' : null }),
          JSON.stringify({ status: res.status, body: rawBody.slice(0, 500) }),
          health.state,
        );
        return { ok: false, errors: [`http_${res.status}`] };
      }
      const data = (await res.json()) as CloudflareSiteverifyResponse;
      const result: TurnstileResult = {
        ok: data.success === true,
        errors: data['error-codes'],
        hostname: data.hostname,
        action: data.action,
        cdata: data.cdata,
      };
      await this.record(result.ok);
      await this.audit(
        requestId,
        startedAt,
        result.ok ? 'success' : 'error',
        result.ok ? null : (result.errors?.[0] ?? 'VERIFY_FAILED'),
        JSON.stringify({ remote_ip: remoteIp ? '[redacted]' : null }),
        JSON.stringify({ ok: result.ok, errors: result.errors ?? [], hostname: result.hostname ?? null, action: result.action ?? null }),
        health.state,
      );
      return result;
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
