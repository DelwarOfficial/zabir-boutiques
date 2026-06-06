/**
 * Phone Normalization Tests [v6.8A]
 * Tests: 017, +880, 880, 10-digit 1XXXXXXXXX, malformed, foreign numbers.
 */
import { describe, it, expect } from 'vitest';
import { normalizeBangladeshPhone } from '../src/lib/phone';

describe('normalizeBangladeshPhone', () => {
  it('normalizes 11-digit 017XXXXXXXX', () => {
    const result = normalizeBangladeshPhone('01712345678');
    expect(result).toEqual({ ok: true, local: '01712345678', phone: '+8801712345678' });
  });

  it('normalizes +880 prefix', () => {
    const result = normalizeBangladeshPhone('+8801912345678');
    expect(result).toEqual({ ok: true, local: '01912345678', phone: '+8801912345678' });
  });

  it('normalizes 880 without plus', () => {
    const result = normalizeBangladeshPhone('8801812345678');
    expect(result).toEqual({ ok: true, local: '01812345678', phone: '+8801812345678' });
  });

  it('normalizes 10-digit starting with 1', () => {
    const result = normalizeBangladeshPhone('1312345678');
    expect(result).toEqual({ ok: true, local: '01312345678', phone: '+8801312345678' });
  });

  it('rejects operator prefix 012', () => {
    const result = normalizeBangladeshPhone('01212345678');
    expect(result).toEqual({ ok: false, reason: 'INVALID_BD_MOBILE' });
  });

  it('rejects too short', () => {
    const result = normalizeBangladeshPhone('0171234567');
    expect(result).toEqual({ ok: false, reason: 'INVALID_BD_MOBILE' });
  });

  it('rejects foreign numbers', () => {
    const result = normalizeBangladeshPhone('+14155551234');
    expect(result).toEqual({ ok: false, reason: 'INVALID_BD_MOBILE' });
  });

  it('strips non-digit characters', () => {
    const result = normalizeBangladeshPhone('017-1234-5678');
    expect(result).toEqual({ ok: true, local: '01712345678', phone: '+8801712345678' });
  });
});
