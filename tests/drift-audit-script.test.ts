import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('drift audit script', () => {
  it('defines all 35 drift checks and the completeness gate', () => {
    const script = readFileSync('scripts/audit/audit-drift.ts', 'utf8');
    const uniqueCodes = new Set(script.match(/D-\d{2}/g) ?? []);
    expect(uniqueCodes.size).toBe(35);
    expect(script).toContain('expected 35 checks');
  });
});
