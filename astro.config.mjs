import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "hybrid",
  integrations: [react()],
  adapter: cloudflare({
    imageService: { build: "compile", runtime: "passthrough" },
    platformProxy: { enabled: true },
  }),
  prefetch: true,
  vite: {
    plugins: [tailwindcss()],
    build: { minify: true },
  },
});
