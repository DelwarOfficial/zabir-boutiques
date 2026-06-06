import { describe, it, expect } from 'vitest';
import {
  timingSafeEqualHex,
  generateRandomHex,
  hmacSha256Hex,
  createCsrfToken,
  verifyCsrfToken
} from '../src/lib/security';

const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('generateRandomHex', () => {
  it('produces hex of the requested byte length', () => {
    expect(generateRandomHex(32)).toMatch(/^[0-9a-f]{64}$/);
    expect(generateRandomHex(16)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('defaults to 32 bytes', () => {
    expect(generateRandomHex()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique values', () => {
    expect(generateRandomHex()).not.toBe(generateRandomHex());
  });
});

describe('hmacSha256Hex', () => {
  it('is deterministic for the same value and secret', async () => {
    const a = await hmacSha256Hex('nonce-value', SECRET);
    const b = await hmacSha256Hex('nonce-value', SECRET);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different values', async () => {
    const a = await hmacSha256Hex('value-a', SECRET);
    const b = await hmacSha256Hex('value-b', SECRET);
    expect(a).not.toBe(b);
  });
});

describe('createCsrfToken', () => {
  it('has the format nonce.hmac', async () => {
    const token = await createCsrfToken(SECRET);
    const parts = token.split('.');
    expect(parts.length).toBe(2);
    expect(parts[0]).toMatch(/^[0-9a-f]{64}$/); // 32-byte nonce
    expect(parts[1]).toMatch(/^[0-9a-f]{64}$/); // hmac-sha256
  });

  it('hmac segment equals HMAC(nonce)', async () => {
    const token = await createCsrfToken(SECRET);
    const [nonce, hmac] = token.split('.');
    expect(await hmacSha256Hex(nonce, SECRET)).toBe(hmac);
  });

  it('generates a fresh independent nonce each call', async () => {
    const t1 = await createCsrfToken(SECRET);
    const t2 = await createCsrfToken(SECRET);
    expect(t1).not.toBe(t2);
  });
});

describe('verifyCsrfToken', () => {
  it('accepts a freshly created token', async () => {
    const token = await createCsrfToken(SECRET);
    expect(await verifyCsrfToken(token, SECRET)).toBe(true);
  });

  it('rejects a token with a tampered hmac', async () => {
    const token = await createCsrfToken(SECRET);
    const [nonce] = token.split('.');
    const tampered = `${nonce}.${'0'.repeat(64)}`;
    expect(await verifyCsrfToken(tampered, SECRET)).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createCsrfToken(SECRET);
    expect(await verifyCsrfToken(token, 'a-different-secret-value-here-32+')).toBe(false);
  });

  it('rejects malformed tokens', async () => {
    expect(await verifyCsrfToken('', SECRET)).toBe(false);
    expect(await verifyCsrfToken('no-dot', SECRET)).toBe(false);
    expect(await verifyCsrfToken('a.b.c', SECRET)).toBe(false);
  });

  it('does not embed the raw session token or its hash (legacy format eliminated)', async () => {
    // Legacy v6.8A login built csrf = `${sessionToken}.${HMAC(sessionToken)}`,
    // which leaked the raw session token in a non-HttpOnly cookie. The new
    // token uses an independent random nonce, so the session token can never
    // be recovered from the csrf-token cookie.
    const sessionToken = generateRandomHex(32);
    const tokenHash = await hmacSha256Hex(sessionToken, SECRET);

    const csrf = await createCsrfToken(SECRET);
    const [nonce, hmac] = csrf.split('.');

    expect(nonce).not.toBe(sessionToken);
    expect(csrf).not.toContain(sessionToken);
    expect(hmac).not.toBe(tokenHash);
    expect(csrf).not.toContain(tokenHash);
  });

  it('rejects a token whose hmac is not HMAC(nonce)', async () => {
    const sessionToken = generateRandomHex(32);
    const wrongHmac = await hmacSha256Hex('not-the-nonce', SECRET);
    expect(await verifyCsrfToken(`${sessionToken}.${wrongHmac}`, SECRET)).toBe(false);
  });
});
