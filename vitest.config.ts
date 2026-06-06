import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    alias: {
      // `cloudflare:workers` is a Workers-runtime virtual module that does not
      // exist under Node/Vitest. Alias it to a stub so modules importing it
      // (e.g. src/lib/rbac.ts, src/lib/env.ts) can be unit-tested.
      'cloudflare:workers': fileURLToPath(new URL('./tests/stubs/cloudflare-workers.ts', import.meta.url))
    }
  }
});
