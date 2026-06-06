import { describe, it, expect } from 'vitest';
import { generateSessionToken, hashSessionToken } from '../src/lib/sessions';

describe('generateSessionToken', () => {
  it('generates 64-char hex string', () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique tokens', () => {
    const t1 = generateSessionToken();
    const t2 = generateSessionToken();
    expect(t1).not.toBe(t2);
  });
});

describe('hashSessionToken', () => {
  it('produces deterministic hash for same input', async () => {
    const secret = 'test-secret-32-chars!!';
    const hash1 = await hashSessionToken('test-token', secret);
    const hash2 = await hashSessionToken('test-token', secret);
    expect(hash1).toBe(hash2);
  });

  it('produces different hash for different input', async () => {
    const secret = 'test-secret-32-chars!!';
    const hash1 = await hashSessionToken('token-a', secret);
    const hash2 = await hashSessionToken('token-b', secret);
    expect(hash1).not.toBe(hash2);
  });
});
