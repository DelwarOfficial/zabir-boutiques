import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('K-20/N-7: session-limit eviction writes the same KV key isSessionRevoked reads', () => {
  it('login.ts no longer writes the dead session:blacklist:{sessionId} key', () => {
    const src = readFileSync(resolve('./src/pages/api/staff/login.ts'), 'utf8');
    expect(src).not.toContain('session:blacklist:${oldestId}');
  });

  it('login.ts calls the shared revokeSession() helper with the session token_hash', () => {
    const src = readFileSync(resolve('./src/pages/api/staff/login.ts'), 'utf8');
    expect(src).toContain("SELECT id, token_hash FROM staff_sessions");
    expect(src).toContain("import('../../../lib/session-blacklist')");
    expect(src).toContain('revokeSession(env, oldest.token_hash, 8 * 60 * 60)');
  });

  it('revokeSession() and isSessionRevoked() use the identical key prefix', () => {
    const src = readFileSync(resolve('./src/lib/session-blacklist.ts'), 'utf8');
    // Both functions must derive their key from the same keyFor() helper.
    expect(src).toContain('const KV_PREFIX = "session-blacklist:";');
    expect((src.match(/keyFor\(tokenHash\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
