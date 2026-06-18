import type { EmailProvider, SendEmailRequest, SendResponse } from '../types';

export class MockCloudflareEmailProvider implements EmailProvider {
  async sendEmail(request: SendEmailRequest): Promise<SendResponse> {
    return { accepted: request.to.length > 0, provider: 'cloudflare_email', status: 'queued', provider_message_id: `mock-${request.message_id}` };
  }
}
