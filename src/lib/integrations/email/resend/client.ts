import type { SendEmailRequest, SendResponse } from '../types';
import type { ResendEnv } from './types';
import { writeApiAuditLog } from '../../../api-audit';
import { doCheckProviderHealth, doRecordProviderResult } from '../../../do-client';

export class ResendClient {
  constructor(private readonly env: ResendEnv) {}

  async send(request: SendEmailRequest): Promise<SendResponse> {
    if (!this.env.RESEND_API_KEY) {
      return { accepted: false, provider: 'resend', status: 'queued', error_code: 'NO_RESEND_API_KEY' };
    }

    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const health = await doCheckProviderHealth(this.env, 'resend');
    if (!health.canProceed) {
      await this.audit(requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', health.state);
      return { accepted: false, provider: 'resend', status: 'failed', error_code: 'CIRCUIT_OPEN' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const from = this.env.RESEND_FROM_EMAIL ?? `${request.from_name} <orders@zabirboutiques.com>`;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: request.to,
          cc: request.cc,
          bcc: request.bcc,
          reply_to: request.reply_to,
          subject: request.subject,
          html: request.html,
          text: request.text,
          tags: request.tags?.map((tag) => ({ name: 'category', value: tag })),
          headers: { 'Idempotency-Key': request.message_id },
        }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      if (!res.ok || !data.id) {
        const isCircuitFailure = res.status >= 500;
        if (isCircuitFailure) await doRecordProviderResult(this.env, 'resend', false);
        await this.audit(requestId, startedAt, 'error', `HTTP_${res.status}`, health.state);
        return { accepted: false, provider: 'resend', status: 'failed', error_code: `HTTP_${res.status}`, error_message: data.error?.message ?? 'send_failed' };
      }
      await doRecordProviderResult(this.env, 'resend', true);
      await this.audit(requestId, startedAt, 'success', null, health.state);
      return { accepted: true, provider: 'resend', status: 'sent', provider_message_id: data.id };
    } catch (err) {
      const code = err instanceof DOMException && err.name === 'AbortError' ? 'TIMEOUT' : 'SEND_ERROR';
      await doRecordProviderResult(this.env, 'resend', false);
      await this.audit(requestId, startedAt, code === 'TIMEOUT' ? 'timeout' : 'error', code, health.state);
      return { accepted: false, provider: 'resend', status: 'failed', error_code: code };
    } finally {
      clearTimeout(timer);
    }
  }

  private async audit(requestId: string, startedAt: number, status: 'success' | 'error' | 'timeout' | 'circuit_open', errorCode: string | null, circuitState: 'closed' | 'open' | 'half_open'): Promise<void> {
    await writeApiAuditLog(this.env.DB, {
      provider: 'resend',
      operation: 'send_email',
      requestId,
      durationMs: Date.now() - startedAt,
      status,
      errorCode,
      circuitState,
    });
  }
}
