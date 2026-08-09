import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('K-29: attacker-facing secret/hash/signature comparisons are constant-time', () => {
  it('csrf.ts double-submit compare uses timingSafeEqualHex, not ===', () => {
    const src = readFileSync(resolve('./src/lib/csrf.ts'), 'utf8');
    expect(src).not.toContain('cookieToken !== headerToken');
    expect(src).toContain('timingSafeEqualHex(cookieToken, headerToken)');
  });

  it('phone-verification.ts OTP hash compare uses timingSafeEqualHex, not ===', () => {
    const src = readFileSync(resolve('./src/lib/phone-verification.ts'), 'utf8');
    expect(src).not.toContain('codeHash === row.code_hash');
    expect(src).toContain('timingSafeEqualHex(codeHash, row.code_hash)');
  });

  it('phone-verification.ts token signature compare uses timingSafeEqualHex, not !==', () => {
    const src = readFileSync(resolve('./src/lib/phone-verification.ts'), 'utf8');
    expect(src).not.toContain('expectedSig !== signature');
    expect(src).toContain('timingSafeEqualHex(expectedSig, signature)');
  });

  it('login.ts legacy password-hash compare uses timingSafeEqualHex, not !==', () => {
    const src = readFileSync(resolve('./src/pages/api/staff/login.ts'), 'utf8');
    expect(src).not.toContain('staff.password_hash !== legacyHash');
    expect(src).toContain('timingSafeEqualHex(staff.password_hash, legacyHash)');
  });

  it('step-up.ts legacy password-hash compare uses timingSafeEqualHex, not ===', () => {
    const src = readFileSync(resolve('./src/pages/api/staff/step-up.ts'), 'utf8');
    expect(src).not.toContain('staff.password_hash === legacyHash');
    expect(src).toContain('timingSafeEqualHex(staff.password_hash, legacyHash)');
  });
});
