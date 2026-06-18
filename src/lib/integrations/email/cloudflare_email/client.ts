import type { SendEmailRequest, SendResponse } from '../types';

export class CloudflareEmailClient {
  async send(_request: SendEmailRequest): Promise<SendResponse> {
    return { accepted: false, provider: 'cloudflare_email', status: 'failed', error_code: 'CLOUDFLARE_EMAIL_NOT_CONFIGURED' };
  }
}
