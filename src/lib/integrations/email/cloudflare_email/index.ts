import type { EmailProvider, SendEmailRequest, SendResponse } from '../types';
import { CloudflareEmailClient } from './client';
import type { CloudflareEmailEnv } from './types';
import { ResendEmailProvider } from '../resend';
import { safeLog } from '../../../pii-scrubber';

export class CloudflareEmailProvider implements EmailProvider {
  private readonly client: CloudflareEmailClient;
  private readonly fallbackProvider: ResendEmailProvider;

  constructor(env: CloudflareEmailEnv = {}) {
    this.client = new CloudflareEmailClient(env);
    this.fallbackProvider = new ResendEmailProvider(env);
  }

  async sendEmail(request: SendEmailRequest): Promise<SendResponse> {
    const primaryResult = await this.client.send(request);
    if (primaryResult.accepted) {
      return primaryResult;
    }

    safeLog.warn('[Email] MailChannels failed. Falling back to Resend.', {
      provider: 'cloudflare_email',
      errorCode: primaryResult.error_code,
      errorMessage: primaryResult.error_message,
      emailType: request.custom_args?.email_type ?? 'unknown',
      messageId: request.message_id,
    });

    const fallbackResult = await this.fallbackProvider.sendEmail(request);
    if (fallbackResult.accepted) {
      return fallbackResult;
    }

    safeLog.error('[Email] MailChannels and Resend both failed.', {
      primaryProvider: 'cloudflare_email',
      primaryErrorCode: primaryResult.error_code,
      fallbackProvider: 'resend',
      fallbackErrorCode: fallbackResult.error_code,
      emailType: request.custom_args?.email_type ?? 'unknown',
      messageId: request.message_id,
    });

    return {
      ...fallbackResult,
      error_message: fallbackResult.error_message ?? 'MailChannels failed and Resend fallback failed',
    };
  }
}
