import { describe, it, expect } from 'vitest';
import { generateTotpSecret, verifyTotpCode } from '../src/lib/totp';

/** Minimal standalone HOTP (RFC 4226) so the test can compute a real,
 * currently-valid code independent of totp.ts's internals — proves
 * verifyTotpCode against a genuine code, not just garbage input. */
function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes = new Uint8Array(Math.floor(cleaned.length * 5 / 8));
  let bits = 0, value = 0, index = 0;
  for (const char of cleaned) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) { bytes[index++] = (value >>> (bits - 8)) & 0xff; bits -= 8; }
  }
  return bytes;
}

async function hotpAt(secret: string, counter: number): Promise<string> {
  const keyBytes = base32Decode(secret);
  const key = await crypto.subtle.importKey('raw', keyBytes.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, buffer));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, '0');
}

describe('K-28: TOTP replay protection via last_used_counter', () => {
  it('verifyTotpCode accepts a genuine current code and reports its counter', async () => {
    const { secret } = generateTotpSecret('owner@zabir.local');
    const timeStep = Math.floor(Date.now() / 1000 / 30);
    const code = await hotpAt(secret, timeStep);

    const result = await verifyTotpCode(secret, code);
    expect(result.valid).toBe(true);
    expect(result.counter).toBe(timeStep);
  });

  it('the SAME code is rejected once minCounter is set to its own (already-used) step', async () => {
    const { secret } = generateTotpSecret('owner@zabir.local');
    const timeStep = Math.floor(Date.now() / 1000 / 30);
    const code = await hotpAt(secret, timeStep);

    const first = await verifyTotpCode(secret, code);
    expect(first.valid).toBe(true);

    // Simulate persisting first.counter as last_used_counter, then replaying.
    const replay = await verifyTotpCode(secret, code, first.counter ?? undefined);
    expect(replay.valid).toBe(false);
  });

  it('a DIFFERENT valid code for a later step still works after a replay was rejected', async () => {
    const { secret } = generateTotpSecret('owner@zabir.local');
    const timeStep = Math.floor(Date.now() / 1000 / 30);
    const usedCode = await hotpAt(secret, timeStep);
    const first = await verifyTotpCode(secret, usedCode);

    const nextStepCode = await hotpAt(secret, timeStep + 1);
    const next = await verifyTotpCode(secret, nextStepCode, first.counter ?? undefined);
    expect(next.valid).toBe(true);
  });

  it('login.ts persists the matched counter and passes lastUsedCounter into verifyTotpCode', () => {
    const src = require('node:fs').readFileSync(require('node:path').resolve('./src/pages/api/staff/login.ts'), 'utf8');
    expect(src).toContain('loadLastUsedTotpCounter(env.DB, staff.id)');
    expect(src).toContain('verifyTotpCode(totpSecret, totpCode, lastUsedCounter ?? undefined)');
    expect(src).toContain('recordUsedTotpCounter(env.DB, staff.id, totpCounter, now)');
  });
});
