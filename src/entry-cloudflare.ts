/**
 * Cloudflare Worker Cron Entry Helper [v6.8D]
 *
 * This module exports the scheduled handler that wrangler-entry.mjs wires
 * onto the Astro SSR Worker. It is intentionally not the wrangler `main`;
 * the wrangler entry is `./wrangler-entry.mjs` at the project root.
 *
 * Registered in wrangler.jsonc under `triggers.crons`.
 */
import { dispatchCron } from './lib/cron-dispatch';
import type { Env } from './env';

export const scheduledHandler = {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron;
    console.log(`[cron] Triggered: ${cron}`);
    ctx.waitUntil(dispatchCron(cron, env as any));
  },
};
