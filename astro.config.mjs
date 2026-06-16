import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://zabirboutiques.com",
  output: "server",
  integrations: [react()],
  adapter: cloudflare({
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
