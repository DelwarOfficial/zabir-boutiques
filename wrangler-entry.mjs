/**
 * Worker entry wrapper [v6.8D]
 *
 * The Astro Cloudflare adapter emits `dist/server/entry.mjs` as a Workers
 * fetch handler. To also run cron jobs (via `triggers.crons` in
 * wrangler.jsonc) we re-export that handler under our own ExportedHandler
 * shape and add a `scheduled` handler.
 *
 * This file lives at the project root so wrangler can bundle it directly
 * without going through the Astro build pipeline.
 */
import { scheduledHandler } from './src/entry-cloudflare.ts';
import { default as astroHandler } from './dist/server/entry.mjs';

export default {
  async fetch(request, env, ctx) {
    return astroHandler.fetch(request, env, ctx);
  },
  scheduled: scheduledHandler.scheduled,
};
