import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import cspHashes from "./scripts/csp-hashes-plugin.mjs";

export default defineConfig({
  site: "https://zabirboutiques.com",
  // Master Plan §2.1 hybrid mode: Astro 6 uses `static` (prerender by default)
  // with per-route `export const prerender = false` for server routes — equivalent
  // to the deprecated `output: "hybrid"` from Astro 4. Do not use `server` here.
  output: "static",
  integrations: [react()],
  adapter: cloudflare({
    runtime: { mode: "advanced" },
    imageService: { build: "compile", runtime: "passthrough" },
    platformProxy: { enabled: true },
  }),
  prefetch: {
    prefetchAll: false,
    defaultStrategy: "hover",
  },
  vite: {
    plugins: [tailwindcss(), cspHashes()],
    build: { minify: true },
  },
});
