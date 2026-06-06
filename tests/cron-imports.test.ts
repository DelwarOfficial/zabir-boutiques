import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CRON_PATH = resolve('./src/lib/cron-dispatch.ts');

describe('Cron import safety', () => {
  const cronCode = readFileSync(CRON_PATH, 'utf-8');

  it('does not import from ../env.d', () => {
    const lines = cronCode.split('\n').filter(l => {
      const t = l.trim();
      return (t.startsWith('import ') || t.startsWith('import type ') || t.startsWith('import {')) &&
        (t.includes("'../env.d'") || t.includes('"../env.d"'));
    });
    expect(lines).toHaveLength(0);
  });

  it('does not import from ../scripts/', () => {
    const importLines = cronCode.split('\n').filter(l => {
      const t = l.trim();
      return t.startsWith('import ') || t.startsWith('import type ') || t.startsWith('import {');
    });
    const scriptImports = importLines.filter(l => l.includes('../scripts/') || l.includes('scripts/'));
    expect(scriptImports).toHaveLength(0);
  });

  it('only uses dynamic imports for runtime modules', () => {
    const imports = cronCode.split('\n').filter(l => l.includes('await import'));
    for (const imp of imports) {
      expect(imp).toMatch(/import\('\.\/[^)]+'\)/);
    }
  });
});
