/**
 * Cloudflare Worker Cron Entry Point [v6.8A]
 * Receives scheduled cron triggers and dispatches to registered handlers.
 * Registered in wrangler.jsonc under triggers.crons
 */
import { dispatchCron } from './lib/cron-dispatch';

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron;
    console.log(`[cron] Triggered: ${cron}`);
    ctx.waitUntil(dispatchCron(cron, env as any));
  },
} satisfies ExportedHandler<Env>;