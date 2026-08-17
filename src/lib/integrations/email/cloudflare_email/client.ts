import type { SendEmailRequest, SendResponse } from '../types';
import type { CloudflareEmailEnv } from './types';

const MAILCHANNELS_ENDPOINT = 'https://api.mailchannels.net/tx/v1/send';
const DEFAULT_FROM_EMAIL = 'orders@zabirboutiques.com';

/**
 * Extract a bare address from a sender string.
 *
 * RESEND_FROM_EMAIL is shared with the Resend path, which accepts either a
 * bare address (`orders@example.com`) or a display form
 * (`Zabir Boutiques <orders@example.com>`). MailChannels rejects the display
 * form in `from.email` — the name belongs in `from.name` — so strip it here
 * rather than forcing the two providers onto different config keys.
 */
function bareAddress(sender: string): string {
  const angled = sender.match(/<([^>]+)>/);
  return (angled ? angled[1] : sender).trim();
}

export class CloudflareEmailClient {
  constructor(private readonly env: CloudflareEmailEnv) {}

  /**
   * Sender identity is configurable and shared with the Resend fallback, so a
   * message keeps the same From address whichever provider delivers it. This
   * was hardcoded to `noreply@`, which meant switching EMAIL_PROVIDER also
   * silently switched the sender to an address that may not be covered by the
   * domain's SPF/DKIM records — accepted by the provider, then spam-foldered.
   */
  private fromEmail(): string {
    const configured = this.env.RESEND_FROM_EMAIL?.trim();
    return configured ? bareAddress(configured) : DEFAULT_FROM_EMAIL;
  }

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
            email: this.fromEmail(),
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
