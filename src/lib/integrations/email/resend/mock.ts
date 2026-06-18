import type { EmailProvider, SendEmailRequest, SendResponse } from '../types';

export class MockResendEmailProvider implements EmailProvider {
  async sendEmail(request: SendEmailRequest): Promise<SendResponse> {
    return {
      accepted: request.to.length > 0,
      provider: 'resend',
      provider_message_id: `mock-${request.message_id}`,
      status: request.to.length > 0 ? 'sent' : 'failed',
      error_code: request.to.length > 0 ? undefined : 'NO_RECIPIENTS',
    };
  }
}
