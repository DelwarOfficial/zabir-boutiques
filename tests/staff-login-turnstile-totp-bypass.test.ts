import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('K-19: staff login Turnstile can no longer be skipped via totp_code presence', () => {
  const src = readFileSync(resolve('./src/pages/api/staff/login.ts'), 'utf8');

  it('the old vulnerable guard is gone', () => {
    expect(src).not.toContain('if (env.TURNSTILE_SECRET_KEY && !body.totp_code)');
  });

  it('Turnstile is required whenever TURNSTILE_SECRET_KEY is set and no valid step2Token is present', () => {
    expect(src).toContain('if (env.TURNSTILE_SECRET_KEY && !step2Verified)');
  });

  it('step2Token verification checks identifier binding, HMAC signature, and expiry', () => {
    const block = src.slice(src.indexOf('let step2Verified'), src.indexOf('if (env.TURNSTILE_SECRET_KEY && !step2Verified)'));
    expect(block).toContain('expectedIdHash');
    expect(block).toContain('expectedSig');
    expect(block).toContain('Number(expiresStr) > Date.now()');
  });

  it('totp_required response issues a fresh step2_token', () => {
    expect(src).toContain("error: 'TOTP code required', totp_required: true, step2_token: step2Token");
  });
});

describe('K-19: staff login page resends the step2 token on the TOTP submit, not a fresh Turnstile solve', () => {
  const src = readFileSync(resolve('./src/pages/staff/login.astro'), 'utf8');

  it('stores step2_token from the totp_required response', () => {
    expect(src).toContain("step2Token = body.step2_token || ''");
  });

  it('sends step2_token on the TOTP submit request', () => {
    expect(src).toContain('totp_code: code, step2_token: step2Token');
  });
});
