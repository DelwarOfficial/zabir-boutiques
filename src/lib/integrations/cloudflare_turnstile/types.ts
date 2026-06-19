import type { TurnstileResult } from '../../turnstile';

export interface CloudflareTurnstileEnv {
  TURNSTILE_SECRET_KEY?: string;
  DB?: D1Database;
  PROVIDER_HEALTH_DO?: DurableObjectNamespace;
}

export type { TurnstileResult };
