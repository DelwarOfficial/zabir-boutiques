import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('K-40: cart session cookie is SameSite=Strict, not Lax', () => {
  it('setCartSessionCookie no longer sets SameSite=Lax', () => {
    const src = readFileSync(resolve('./src/pages/api/cart/index.ts'), 'utf8');
    expect(src).not.toContain('SameSite=Lax');
    expect(src).toContain('SameSite=Strict');
  });
});
