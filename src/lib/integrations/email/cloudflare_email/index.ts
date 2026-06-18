import type { EmailProvider, SendEmailRequest, SendResponse } from '../types';
import { CloudflareEmailClient } from './client';

export class CloudflareEmailProvider implements EmailProvider {
  private readonly client = new CloudflareEmailClient();

  sendEmail(request: SendEmailRequest): Promise<SendResponse> {
    return this.client.send(request);
  }
}
