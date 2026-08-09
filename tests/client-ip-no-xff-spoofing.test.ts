import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clientIp } from '../src/lib/audit';

describe('K-27: X-Forwarded-For is never trusted as a client-IP source', () => {
  it('clientIp() ignores X-Forwarded-For entirely, even when CF-Connecting-IP is absent', () => {
    const req = new Request('https://x/', { headers: { 'X-Forwarded-For': '1.2.3.4' } });
    expect(clientIp(req)).toBeNull();
  });

  it('clientIp() uses CF-Connecting-IP when present, ignoring a spoofed XFF', () => {
    const req = new Request('https://x/', {
      headers: { 'CF-Connecting-IP': '5.6.7.8', 'X-Forwarded-For': '1.2.3.4' },
    });
    expect(clientIp(req)).toBe('5.6.7.8');
  });

  it('middleware.ts rate limiter no longer falls back to X-Forwarded-For', () => {
    const src = readFileSync(resolve('./src/middleware.ts'), 'utf8');
    expect(src).not.toContain("headers.get('X-Forwarded-For')");
  });

  it('api-keys.ts IP allowlist gate no longer falls back to X-Forwarded-For', () => {
    const src = readFileSync(resolve('./src/lib/api-keys.ts'), 'utf8');
    expect(src).not.toContain("headers.get('X-Forwarded-For')");
  });
});
