import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('N-10: step-up window is 5 minutes, matching the plan target (was 10)', () => {
  it('critical-auth.ts sets STEP_UP_WINDOW_SECONDS to 5 * 60', () => {
    const src = readFileSync(resolve('./src/lib/critical-auth.ts'), 'utf8');
    expect(src).toContain('const STEP_UP_WINDOW_SECONDS = 5 * 60;');
    expect(src).not.toContain('const STEP_UP_WINDOW_SECONDS = 10 * 60;');
  });
});
