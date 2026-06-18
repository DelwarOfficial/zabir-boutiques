/**
 * Email Provider Interface [Master_Prompt v7.0 §2.6, §17.1]
 *
 * Common interface for email providers (Resend, Cloudflare Email Sending, etc.)
 * All email operations must go through this interface.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailProvider {
  name: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
