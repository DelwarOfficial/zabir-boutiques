import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * N-21: staff login returns a generic 'Invalid credentials' for every
 * rejection path (correct — no enumeration signal). But nothing recorded WHY
 * server-side, so a rotated PASSWORD_PEPPER, a deactivated row, and a plain
 * wrong password were indistinguishable to an operator. Separately, both
 * TURNSTILE_SECRET_KEY and RESEND_API_KEY fail open in total silence: the
 * Turnstile block is skipped entirely when the secret is unset, and the
 * Resend client returns status 'queued' (which reads like success) when the
 * API key is unset, so password-reset emails vanished without a trace.
 */
const LOGIN = readFileSync(resolve('./src/pages/api/staff/login.ts'), 'utf8');
const RESEND = readFileSync(resolve('./src/lib/integrations/email/resend/client.ts'), 'utf8');

describe('N-21: authentication failures are diagnosable server-side without leaking to the client', () => {
  it('every login rejection path logs a distinct machine-readable reason', () => {
    for (const reason of [
      'no_active_account_for_identifier',
      'password_hash_mismatch',
      'legacy_password_hash_mismatch',
    ]) {
      expect(LOGIN, `missing rejection reason: ${reason}`).toContain(reason);
    }
  });

  it('the client-facing response stays generic on every one of those paths', () => {
    // Whatever we log, the body must remain identical across rejection paths.
    const genericResponses = LOGIN.match(/error:\s*'Invalid credentials'/g) ?? [];
    expect(genericResponses.length).toBeGreaterThanOrEqual(3);
    expect(LOGIN).not.toMatch(/error:\s*'(No such user|Wrong password|Account disabled)'/i);
  });

  it('the identifier is hashed before logging — never written in the clear', () => {
    const helper = LOGIN.slice(LOGIN.indexOf('async function logLoginRejection'), LOGIN.indexOf('export async function POST'));
    expect(helper).toContain('hmacSha256Hex(identifier');
    expect(helper).toContain('identifierRef');
    // The raw identifier must not be handed to the logger directly.
    expect(helper).not.toMatch(/safeLog\.\w+\([^)]*\bidentifier\b\s*[,}]/);
  });

  it('the password, its hash and its salt are never passed to a logger', () => {
    const logCalls = LOGIN.match(/safeLog\.\w+\([^;]*\);/gs) ?? [];
    expect(logCalls.length).toBeGreaterThan(0);
    for (const call of logCalls) {
      expect(call, `log call leaks a credential: ${call}`).not.toMatch(/\bpassword\b(?!_hash_mismatch|_salt\b.*hint)/);
      expect(call).not.toContain('password_hash');
      expect(call).not.toContain('PASSWORD_PEPPER');
      expect(call).not.toContain('SESSION_SECRET');
    }
  });

  it('a missing TURNSTILE_SECRET_KEY is reported loudly instead of failing open silently', () => {
    expect(LOGIN).toContain('TURNSTILE_SECRET_KEY is not configured');
    // And the guard itself must still be the thing that gates verification —
    // the warning must not have replaced the check.
    expect(LOGIN).toContain('if (env.TURNSTILE_SECRET_KEY && !step2Verified)');
  });

  it('a missing RESEND_API_KEY is logged as a delivery failure, not swallowed behind status "queued"', () => {
    expect(RESEND).toContain('RESEND_API_KEY is not configured');
    expect(RESEND).toContain("safeLog.error('[email]");
    // The recipient address is PII and must not ride along in the log line.
    const block = RESEND.slice(RESEND.indexOf('if (!this.env.RESEND_API_KEY)'), RESEND.indexOf('const requestId'));
    expect(block).not.toContain('request.to');
  });
});
