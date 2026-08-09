import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('N-4: audit-drift D-19 check validates the real §11.7 canonical VAT rule, not the retired env var', () => {
  const script = readFileSync(resolve('./scripts/audit/audit-drift.ts'), 'utf8');
  const d19Block = script.slice(script.indexOf("code: 'D-19'"), script.indexOf("code: 'D-20'"));

  it('checks for the canonical D1 tax_rates + largest-remainder implementation', () => {
    expect(d19Block).toContain("getVatRatePercent(env.DB");
    expect(d19Block).toContain('allocateVatByLargestRemainder');
  });

  it('flags any live (non-comment) VAT_RATE_PERCENT reference as a finding', () => {
    expect(d19Block).toContain('usesRetiredEnvVar');
  });

  it('checkout.ts now actually satisfies this check (real code, not just the test)', () => {
    const checkout = readFileSync(resolve('./src/pages/api/checkout.ts'), 'utf8');
    expect(checkout).toContain('getVatRatePercent(env.DB');
    expect(checkout).toContain('allocateVatByLargestRemainder');
    const nonCommentLines = checkout.split('\n').filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/**');
    });
    expect(nonCommentLines.some((l) => l.includes('VAT_RATE_PERCENT'))).toBe(false);
  });

  it('D-23 is untouched (already correctly requires the live index, per verified INV-7)', () => {
    const d23Block = script.slice(script.indexOf("code: 'D-23'"), script.indexOf("code: 'D-24'"));
    expect(d23Block).toContain('idx_stock_reservations_order_active');
  });
});
