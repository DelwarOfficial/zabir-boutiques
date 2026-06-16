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
  env: { TURNSTILE_SECRET_KEY?: string },
  token: string,
  remoteIp?: string,
): Promise<TurnstileResult> {
  if (!env.TURNSTILE_SECRET_KEY) {
    return { ok: true };
  }
  if (!token) return { ok: false, errors: ["missing-token"] };
  const form = new URLSearchParams();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  if (remoteIp) form.set("remoteip", remoteIp);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  if (!res.ok) return { ok: false, errors: [`http_${res.status}`] };
  const data = (await res.json()) as TurnstileResult;
  return data;
}
