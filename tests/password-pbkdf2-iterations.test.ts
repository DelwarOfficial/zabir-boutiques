import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  verifyPasswordWithUpgrade,
  PBKDF2_ITERATIONS,
  PBKDF2_LEGACY_ITERATIONS,
} from '../src/lib/password';

const PEPPER = 'test-pepper';

describe('K-25: PBKDF2 iterations raised to OWASP-recommended 600k, with legacy verification', () => {
  it('PBKDF2_ITERATIONS is >= 600,000 (OWASP minimum)', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it('new hashes use the current (600k) iteration count and verify correctly', async () => {
    const hash = await hashPassword('Sup3r$ecret!', 'salt1', PEPPER);
    expect(await verifyPassword('Sup3r$ecret!', hash, 'salt1', PEPPER)).toBe(true);
    expect(await verifyPassword('wrong', hash, 'salt1', PEPPER)).toBe(false);
  });

  it('verifyPasswordWithUpgrade still validates a hash produced at the old 100k count', async () => {
    // Simulate a pre-K-25 row by hashing at the legacy iteration count directly.
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
