import { CloudflareTurnstileClient } from './integrations/cloudflare_turnstile';

/**
 * Cloudflare Turnstile [Master_Prompt v7.0 §9.3]
 *
 * Server-side verification of Turnstile tokens. If TURNSTILE_SECRET_KEY
 * is not configured (dev), the call is a no-op pass — keep local dev
 * frictionless while keeping production bot-protected.
 */
export interface TurnstileResult {
  ok: boolean;
  errors?: string[];
  hostname?: string;
  action?: string;
  cdata?: string;
}

export async function verifyTurnstile(
  env: { TURNSTILE_SECRET_KEY?: string; DB?: D1Database; PROVIDER_HEALTH_DO?: DurableObjectNamespace },
  token: string,
  remoteIp?: string,
): Promise<TurnstileResult> {
  return new CloudflareTurnstileClient(env).verify(token, remoteIp);
}
