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

export interface TurnstileEnv {
  TURNSTILE_SECRET_KEY?: string;
  /** Comma-separated frontend hostnames this deployment will accept. */
  TURNSTILE_HOSTNAMES?: string;
  DB?: D1Database;
  PROVIDER_HEALTH_DO?: DurableObjectNamespace;
}

function parseHostnames(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * N-23: `success` alone is not sufficient.
 *
 * A Turnstile widget is registered against a list of domains, and siteverify
 * happily validates a token minted on ANY of them. It also echoes back the
 * `action` the widget declared. Checking neither means a token solved on one
 * surface — a public contact form, a staging host, any other domain on the
 * widget — is accepted by the staff login endpoint. That is precisely the
 * replay the `hostname` and `action` fields exist to prevent, and Cloudflare's
 * canonical integration validates both.
 *
 * Fails closed: if TURNSTILE_HOSTNAMES is unset while a secret IS configured,
 * verification is refused rather than silently downgraded to `success`-only.
 * Both production (wrangler.jsonc) and local dev (.env.local) set it, so an
 * unconfigured environment is a genuine misconfiguration worth failing on.
 */
export async function verifyTurnstile(
  env: TurnstileEnv,
  token: string,
  remoteIp?: string,
  expectedAction?: string,
): Promise<TurnstileResult> {
  // Preserve the documented dev no-op: no secret means Turnstile is disabled
  // for this environment, so there is no hostname or action to validate.
  if (!env.TURNSTILE_SECRET_KEY) return { ok: true };

  const result = await new CloudflareTurnstileClient(env).verify(token, remoteIp);
  if (!result.ok) return result;

  const expectedHostnames = parseHostnames(env.TURNSTILE_HOSTNAMES);
  if (expectedHostnames.size === 0) {
    return { ...result, ok: false, errors: ['hostname-allowlist-not-configured'] };
  }
  if (!result.hostname || !expectedHostnames.has(result.hostname.toLowerCase())) {
    return { ...result, ok: false, errors: ['hostname-mismatch'] };
  }

  if (expectedAction && result.action !== expectedAction) {
    return { ...result, ok: false, errors: ['action-mismatch'] };
  }

  return result;
}
