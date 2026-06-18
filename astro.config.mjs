import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import cspHashes from "./scripts/csp-hashes-plugin.mjs";

export default defineConfig({
  site: "https://zabirboutiques.com",
  output: "server",
  integrations: [react()],
  adapter: cloudflare({
    runtime: { mode: "advanced" },
    imageService: { build: "compile", runtime: "passthrough" },
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
