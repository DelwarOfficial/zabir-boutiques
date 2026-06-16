import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://zabirboutiques.com",
  output: "server",
  integrations: [react()],
  adapter: cloudflare({
    // Master_Prompt §2.1: use the advanced runtime so we can host
    // Durable Objects and Queue consumers alongside SSR.
    runtime: { mode: "advanced" },
    imageService: { build: "compile", runtime: "passthrough" },
    platformProxy: { enabled: true },
  }),
  prefetch: {
    prefetchAll: false,
    defaultStrategy: "hover",
  },
  vite: {
    plugins: [tailwindcss()],
    build: { minify: true },
  },
});
