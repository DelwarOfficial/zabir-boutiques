export interface SendEmailRequest {
  to: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
  from_name: string;
  subject: string;
  html: string;
  text?: string;
  tags?: string[];
  custom_args?: Record<string, string>;
  message_id: string;
}

export interface SendResponse {
  accepted: boolean;
  provider_message_id?: string;
  provider: 'resend' | 'cloudflare_email';
  status: 'sent' | 'queued' | 'failed';
  error_code?: string;
  error_message?: string;
}

export interface EmailProvider {
  sendEmail(request: SendEmailRequest): Promise<SendResponse>;
}
