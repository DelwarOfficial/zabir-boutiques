/**
 * Cloudflare Worker Entry [v6.8D]
 *
 * Composes:
 *   - the Astro SSR fetch handler (serves the storefront + API + staff pages)
 *   - the scheduled handler (cron triggers for maintenance / fraud / backups)
 *
 * Wrangler bundles this TypeScript file with esbuild. The Astro server
 * entrypoint is a real ES module that wrangler follows and bundles along
 * with this file.
 */
import { default as astroHandler } from "@astrojs/cloudflare/entrypoints/server";
import { dispatchCron } from "./lib/cron-dispatch";
import type { Env } from "./env";

export default {
  async fetch(request, env, ctx) {
    const handler = (astroHandler as ExportedHandler<Env>).fetch;
    if (!handler) throw new Error("Astro SSR handler does not export fetch");
    return handler.call(astroHandler, request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    console.log(`[cron] Triggered: ${cron}`);
    ctx.waitUntil(dispatchCron(cron, env as unknown as Env));
  },
} satisfies ExportedHandler<Env>;
