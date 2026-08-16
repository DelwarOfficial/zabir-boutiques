import type { TurnstileResult } from '../../turnstile';

export interface CloudflareTurnstileEnv {
  TURNSTILE_SECRET_KEY?: string;
  DB?: D1Database;
  PROVIDER_HEALTH_DO?: DurableObjectNamespace;
}

export interface CloudflareSiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
  hostname?: string;
  action?: string;
  cdata?: string;
}

export type { TurnstileResult };
