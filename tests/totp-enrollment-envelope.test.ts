import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPendingTotpEnvelope, readPendingTotpEnvelope } from '../src/lib/otp-secrets';

const env = { SESSION_SECRET: 'test-session-secret-at-least-32-chars-long' };

describe('K-22: TOTP enrollment secret is never trusted from the client', () => {
  it('round-trips: setup envelope decrypts back to the same secret for the same staffId', async () => {
    const envelope = await createPendingTotpEnvelope('staff-1', 'JBSWY3DPEHPK3PXP', env);
    const secret = await readPendingTotpEnvelope('staff-1', envelope, env);
    expect(secret).toBe('JBSWY3DPEHPK3PXP');
  });

  it('rejects an envelope presented by a different staffId (attacker cannot bind their own secret to a stolen session)', async () => {
    const envelope = await createPendingTotpEnvelope('staff-1', 'JBSWY3DPEHPK3PXP', env);
    const secret = await readPendingTotpEnvelope('staff-2', envelope, env);
    expect(secret).toBeNull();
  });

  it('rejects a tampered envelope (AES-GCM auth tag fails)', async () => {
    const envelope = await createPendingTotpEnvelope('staff-1', 'JBSWY3DPEHPK3PXP', env);
    const bytes = Uint8Array.from(atob(envelope), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = btoa(String.fromCharCode(...bytes));
    const secret = await readPendingTotpEnvelope('staff-1', tampered, env);
    expect(secret).toBeNull();
  });

  it('rejects garbage input without throwing', async () => {
    const secret = await readPendingTotpEnvelope('staff-1', 'not-valid-base64!!!', env);
    expect(secret).toBeNull();
  });

  it('verify.ts no longer trusts a client-supplied secret field', () => {
    const src = readFileSync(resolve('./src/pages/api/staff/totp/verify.ts'), 'utf8');
    expect(src).not.toContain('body.secret');
    expect(src).toContain('readPendingTotpEnvelope(user.id, body.pending, env)');
    expect(src).toContain('storeStaffTotpSecret(env.DB, user.id, secret, env)');
  });

  it('setup.ts issues a pending envelope instead of returning a bare secret to trust later', () => {
    const src = readFileSync(resolve('./src/pages/api/staff/totp/setup.ts'), 'utf8');
    expect(src).toContain('createPendingTotpEnvelope(user.id, totp.secret, env)');
  });
});
