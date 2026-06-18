import type { EmailProvider, SendEmailRequest, SendResponse } from '../types';
import { ResendClient } from './client';
import type { ResendEnv } from './types';

export class ResendEmailProvider implements EmailProvider {
  private readonly client: ResendClient;

  constructor(env: ResendEnv) {
    this.client = new ResendClient(env);
  }

  sendEmail(request: SendEmailRequest): Promise<SendResponse> {
    return this.client.send(request);
  }
}
