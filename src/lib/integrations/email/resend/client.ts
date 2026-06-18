import type { SendEmailRequest, SendResponse } from '../types';
import type { ResendEnv } from './types';

export class ResendClient {
  constructor(private readonly env: ResendEnv) {}

  async send(request: SendEmailRequest): Promise<SendResponse> {
    if (!this.env.RESEND_API_KEY) {
      return { accepted: false, provider: 'resend', status: 'queued', error_code: 'NO_RESEND_API_KEY' };
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
        return { accepted: false, provider: 'resend', status: 'failed', error_code: `HTTP_${res.status}`, error_message: data.error?.message ?? 'send_failed' };
      }
      return { accepted: true, provider: 'resend', status: 'sent', provider_message_id: data.id };
    } catch (err) {
      return { accepted: false, provider: 'resend', status: 'failed', error_code: err instanceof DOMException && err.name === 'AbortError' ? 'TIMEOUT' : 'SEND_ERROR' };
    } finally {
      clearTimeout(timer);
    }
  }
}
