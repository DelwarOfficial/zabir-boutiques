import type { APIContext } from 'astro';
import type { Env } from '../env';
import { env as cloudflareEnv } from 'cloudflare:workers';

export function getEnv(context: APIContext): Env {
  // Prefer per-request env from Astro + Cloudflare adapter (advanced runtime mode).
  // This is the most reliable for bindings and secrets on a per-request basis.
  const localsAny = (context as any)?.locals ?? {};
  const runtimeEnv = localsAny.runtime?.env ?? (context as any)?.runtime?.env ?? (context as any)?.env;
  if (runtimeEnv && runtimeEnv.DB) {
    return runtimeEnv as Env;
  }

  // Fallback to the cloudflare:workers virtual module (injected by the adapter).
  if (cloudflareEnv && (cloudflareEnv as any).DB) {
    return cloudflareEnv as Env;
  }

  throw new Error('Cloudflare runtime env is unavailable');
}
