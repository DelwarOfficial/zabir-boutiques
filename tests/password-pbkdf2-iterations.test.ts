import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  verifyPasswordWithUpgrade,
  PBKDF2_ITERATIONS,
  PBKDF2_LEGACY_ITERATIONS,
} from '../src/lib/password';

const PEPPER = 'test-pepper';

/**
 * N-17: K-25 raised PBKDF2_ITERATIONS to 600,000 citing OWASP's minimum,
 * but Cloudflare Workers' WebCrypto PBKDF2 hard-caps at 100,000 —
 * crypto.subtle.deriveBits throws NotSupportedError above that,
 * unconditionally, in the real Workers runtime. Node's crypto.subtle
 * (what these tests run under) does NOT enforce that same cap, which is
 * exactly why the original 600k value passed every local test while
 * 500ing on every single production login. The assertion below pins the
 * value to the actual platform ceiling, not just "some number", so a
 * future bump past 100k fails locally instead of only in production.
 */
describe('N-17: PBKDF2 iteration count stays within the Workers runtime cap (100k)', () => {
  it('PBKDF2_ITERATIONS does not exceed 100,000 (Cloudflare Workers WebCrypto PBKDF2 hard cap)', () => {
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(100_000);
  });

  it('PBKDF2_LEGACY_ITERATIONS also stays within the cap', () => {
    expect(PBKDF2_LEGACY_ITERATIONS).toBeLessThanOrEqual(100_000);
  });

  it('new hashes verify correctly at the current iteration count', async () => {
    const hash = await hashPassword('Sup3r$ecret!', 'salt1', PEPPER);
    expect(await verifyPassword('Sup3r$ecret!', hash, 'salt1', PEPPER)).toBe(true);
    expect(await verifyPassword('wrong', hash, 'salt1', PEPPER)).toBe(false);
  });

  it('verifyPasswordWithUpgrade still validates a hash produced at the legacy count', async () => {
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode('Sup3r$ecret!'), { name: 'PBKDF2' }, false, ['deriveBits']);
    const combinedSalt = new TextEncoder().encode('salt2' + PEPPER);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: combinedSalt, iterations: PBKDF2_LEGACY_ITERATIONS, hash: 'SHA-256' }, keyMaterial, 256);
    const legacyHash = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const result = await verifyPasswordWithUpgrade('Sup3r$ecret!', legacyHash, 'salt2', PEPPER);
    expect(result.valid).toBe(true);
    expect(result.matchedIterations).toBe(PBKDF2_LEGACY_ITERATIONS);
  });

  it('verifyPasswordWithUpgrade reports the current count for a new hash (no unnecessary re-hash)', async () => {
    const hash = await hashPassword('Sup3r$ecret!', 'salt3', PEPPER);
    const result = await verifyPasswordWithUpgrade('Sup3r$ecret!', hash, 'salt3', PEPPER);
    expect(result.valid).toBe(true);
    expect(result.matchedIterations).toBe(PBKDF2_ITERATIONS);
  });

  it('rejects a wrong password at either iteration count', async () => {
    const hash = await hashPassword('Sup3r$ecret!', 'salt4', PEPPER);
    const result = await verifyPasswordWithUpgrade('wrong-password', hash, 'salt4', PEPPER);
    expect(result.valid).toBe(false);
    expect(result.matchedIterations).toBeNull();
  });
});
