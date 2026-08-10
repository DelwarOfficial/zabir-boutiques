import type { APIContext } from 'astro';
import type { Env } from '../env';
import { env as cloudflareEnv } from 'cloudflare:workers';

export function getEnv(_context: APIContext): Env {
  // Astro v6 removed Astro.locals.runtime.env.
  // Use the cloudflare:workers virtual module (injected by the adapter).
  if (cloudflareEnv && (cloudflareEnv as any).DB) {
    return cloudflareEnv as Env;
  }

  throw new Error('Cloudflare runtime env is unavailable');
}
