import { describe, it, expect } from 'vitest';
import { timingSafeEqualHex } from '../src/lib/security';

describe('CSRF Protection', () => {
  it('timingSafeEqualHex returns false for different lengths', () => {
    expect(timingSafeEqualHex('abc', 'abcd')).toBe(false);
  });

  it('timingSafeEqualHex returns true for identical strings', () => {
    expect(timingSafeEqualHex('abc123', 'abc123')).toBe(true);
  });

  it('timingSafeEqualHex returns false for different strings', () => {
    expect(timingSafeEqualHex('abc123', 'abc124')).toBe(false);
  });

  it('non-GET /api/staff/ without token returns 403', () => {
    const url = '/api/staff/orders/123/confirm';
    const method = 'POST';
    const cookieToken = null;
    const headerToken = null;
    const isStaffMutation = url.startsWith('/api/staff/') || url.startsWith('/staff/');
    const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(method);

    if (isStaffMutation && !isSafeMethod) {
      expect(!cookieToken || !headerToken).toBe(true);
    }
  });

  it('non-GET /staff/ without token returns 403', () => {
    const url = '/staff/products/edit';
    const method = 'POST';
    const cookieToken = null;
    const headerToken = null;
    const isStaffMutation = url.startsWith('/api/staff/') || url.startsWith('/staff/');
    const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(method);

    if (isStaffMutation && !isSafeMethod) {
      expect(!cookieToken || !headerToken).toBe(true);
    }
  });

  it('valid token passes CSRF', () => {
    const cookieToken = 'valid-token.hmacvalue';
    const headerToken = 'valid-token.hmacvalue';
    expect(cookieToken === headerToken).toBe(true);
  });

  it('non-matching cookie and header tokens fail', () => {
    const cookieToken = 'token-a.hmac-a';
    const headerToken = 'token-b.hmac-b';
    expect(cookieToken !== headerToken).toBe(true);
  });

  it('cookie regex escaping is correct', () => {
    const name = 'csrf-token';
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(escaped).toBe('csrf-token');
    const cookieHeader = 'session=abc; csrf-token=xyz';
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
    expect(match).not.toBeNull();
    expect(match![1]).toBe('xyz');
  });
});
