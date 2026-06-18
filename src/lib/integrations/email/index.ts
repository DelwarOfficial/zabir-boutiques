import type { EmailProvider } from './types';
import { CloudflareEmailProvider } from './cloudflare_email';
import { ResendEmailProvider } from './resend';

export function getEmailProvider(env: { EMAIL_PROVIDER?: string; RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string }): EmailProvider {
  return env.EMAIL_PROVIDER === 'cloudflare_email'
    ? new CloudflareEmailProvider()
    : new ResendEmailProvider(env);
}
