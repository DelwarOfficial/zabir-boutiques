import type { APIContext } from 'astro';
import type { Env } from '../env';

export function getEnv(context: APIContext): Env {
  const runtime = (context.locals as { runtime?: { env?: Env } }).runtime;
  if (!runtime?.env) throw new Error('Cloudflare runtime env is unavailable');
  return runtime.env as Env;
}
