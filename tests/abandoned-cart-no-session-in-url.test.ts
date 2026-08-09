import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('K-39: abandoned-cart recovery URL no longer leaks session_id in the query string', () => {
  it('consumers.ts builds recovery_url without a session_id param', () => {
    const src = readFileSync(resolve('./src/queues/consumers.ts'), 'utf8');
    expect(src).not.toContain('/checkout?session_id=');
    expect(src).toContain("recovery_url: `${(env.PUBLIC_SITE_URL ?? 'https://zabirboutiques.com').replace(/\\/$/, '')}/checkout`");
  });

  it('no route anywhere reads a session_id query param from /checkout (confirms it was dead)', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    function walk(dir: string, out: string[] = []): string[] {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(ts|tsx|astro)$/.test(entry.name)) out.push(full);
      }
      return out;
    }
    const files = walk(resolve('./src'));
    const offenders = files.filter((f) => {
      const content = fs.readFileSync(f, 'utf8');
      return /searchParams\.get\(['"]session_id['"]\)/.test(content);
    });
    expect(offenders).toEqual([]);
  });
});
