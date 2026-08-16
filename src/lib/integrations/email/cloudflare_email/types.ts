import type { ResendEnv } from '../resend/types';

export interface CloudflareEmailEnv extends ResendEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}
