import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('N-6: rbac.ts no longer has the dead unawaited sessionKV.get() read', () => {
  it('the fire-and-forget sessionKV.get("staff-session:...", "json") probe is removed', () => {
    const src = readFileSync(resolve('./src/lib/rbac.ts'), 'utf8');
    expect(src).not.toContain("sessionKV.get(`staff-session:${tokenHash}`, 'json')");
  });

  it('sessionKV is still used for its real purpose (write-side cache population)', () => {
    const src = readFileSync(resolve('./src/lib/rbac.ts'), 'utf8');
    expect(src).toContain('sessionKV.put(');
  });
});
