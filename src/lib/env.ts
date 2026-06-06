import type { APIContext } from 'astro';
import type { Env } from '../env';
import { env as cloudflareEnv } from 'cloudflare:workers';

export function getEnv(context: APIContext): Env {
  void context;
  if (!cloudflareEnv) throw new Error('Cloudflare runtime env is unavailable');
  return cloudflareEnv as Env;
}
