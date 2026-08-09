import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'generated') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|astro)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('KPI-13 (§11.7 / D-19): VAT_RATE_PERCENT is retired — no runtime usage left', () => {
  it('every remaining reference to VAT_RATE_PERCENT is a comment, not live code', () => {
    const files = walk(resolve('./src'));
    const offenders: string[] = [];
    for (const f of files) {
      const content = readFileSync(f, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('VAT_RATE_PERCENT')) return;
        const trimmed = line.trim();
        const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**');
        if (!isComment) offenders.push(`${f}:${i + 1}: ${trimmed}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('checkout.ts, buy-now/submit.ts, staff/invoices, and staff/orders/create all read the rate from D1 tax_rates', () => {
    for (const f of [
      './src/pages/api/checkout.ts',
      './src/pages/api/buy-now/submit.ts',
      './src/pages/api/staff/invoices/index.ts',
      './src/pages/api/staff/orders/create.ts',
    ]) {
      const src = readFileSync(resolve(f), 'utf8');
      expect(src).toContain('getVatRatePercent(env.DB');
    }
  });
});
