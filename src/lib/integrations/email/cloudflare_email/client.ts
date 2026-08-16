import type { SendEmailRequest, SendResponse } from '../types';
import type { CloudflareEmailEnv } from './types';

const MAILCHANNELS_ENDPOINT = 'https://api.mailchannels.net/tx/v1/send';
const DEFAULT_FROM_EMAIL = 'noreply@zabirboutiques.com';

export class CloudflareEmailClient {
  constructor(private readonly _env: CloudflareEmailEnv) {}

  async send(request: SendEmailRequest): Promise<SendResponse> {
    try {
      const response = await fetch(MAILCHANNELS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [
            {
              to: request.to.map((email) => ({ email })),
            },
          ],
          from: {
            email: DEFAULT_FROM_EMAIL,
            name: request.from_name,
          },
          subject: request.subject,
          content: [
            {
              type: 'text/html',
              value: request.html,
            },
          ],
        }),
      });

      if (!response.ok) {
        const responseText = await response.text().catch(() => '');
        return {
          accepted: false,
          provider: 'cloudflare_email',
          status: 'failed',
          error_code: `HTTP_${response.status}`,
          error_message: responseText || 'mailchannels_send_failed',
        };
      }

      return {
        accepted: true,
        provider: 'cloudflare_email',
        status: 'sent',
        provider_message_id: request.message_id,
      };
    } catch (error) {
      return {
        accepted: false,
        provider: 'cloudflare_email',
        status: 'failed',
        error_code: 'MAILCHANNELS_FETCH_FAILED',
        error_message: error instanceof Error ? error.message : 'mailchannels_fetch_failed',
      };
    }
  }
}
