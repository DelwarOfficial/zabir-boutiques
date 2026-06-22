import type { APIContext } from 'astro';
import type { Env } from '../env';
import { env as cloudflareEnv } from 'cloudflare:workers';

export function getEnv(context: APIContext): Env {
  void context;
  // Primary: virtual module provided by @astrojs/cloudflare adapter (advanced runtime)
  if (cloudflareEnv && (cloudflareEnv as any).DB) {
    return cloudflareEnv as Env;
  }
  // Fallback for some page/API contexts or adapter variations: runtime injected on locals
  const localsAny = (context as any)?.locals;
  const runtimeEnv = localsAny?.runtime?.env ?? (context as any)?.runtime?.env;
  if (runtimeEnv && runtimeEnv.DB) {
    return runtimeEnv as Env;
  }
  if (cloudflareEnv) {
    return cloudflareEnv as Env;
  }
  throw new Error('Cloudflare runtime env is unavailable');
}
