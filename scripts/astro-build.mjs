/**
 * Runs `astro build` with local Miniflare bindings (no Wrangler remote session).
 * Set CLOUDFLARE_VITE_FORCE_LOCAL=true so CI and offline builds do not require `wrangler login`.
 */
import { execSync } from 'node:child_process';

process.env.CLOUDFLARE_VITE_FORCE_LOCAL = 'true';
execSync('npx astro build', { stdio: 'inherit', env: process.env });