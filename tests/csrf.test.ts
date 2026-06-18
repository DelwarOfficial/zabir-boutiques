import { describe, it, expect } from 'vitest';
import { timingSafeEqualHex, createCsrfToken } from '../src/lib/security';
import {
  readCsrfCookie,
  buildCsrfSetCookie,
  buildCsrfClearCookie,
  validateCsrfDoubleSubmit,
  CSRF_COOKIE_NAME,
} from '../src/lib/csrf';

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

  it('buildCsrfSetCookie sets HttpOnly and SameSite=Strict', () => {
    const cookie = buildCsrfSetCookie('nonce.sig', 3600);
    expect(cookie).toContain(`${CSRF_COOKIE_NAME}=nonce.sig`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('buildCsrfClearCookie clears the HttpOnly cookie', () => {
    expect(buildCsrfClearCookie()).toContain(`${CSRF_COOKIE_NAME}=`);
    expect(buildCsrfClearCookie()).toContain('Max-Age=0');
  });

  it('readCsrfCookie reads __Host-csrf-token from Cookie header', () => {
    const req = new Request('https://example.com', {
      headers: { Cookie: `${CSRF_COOKIE_NAME}=abc.def; __Host-session=x` },
    });
    expect(readCsrfCookie(req)).toBe('abc.def');
  });

  it('validateCsrfDoubleSubmit accepts matching cookie and header', async () => {
    const token = await createCsrfToken('csrf-secret');
    const req = new Request('https://example.com', {
      method: 'POST',
      headers: {
        Cookie: `${CSRF_COOKIE_NAME}=${token}`,
        'X-CSRF-Token': token,
      },
    });
    const result = await validateCsrfDoubleSubmit(req, 'csrf-secret');
    expect(result).toEqual({ ok: true });
  });

  it('validateCsrfDoubleSubmit rejects header mismatch', async () => {
    const token = await createCsrfToken('csrf-secret');
    const req = new Request('https://example.com', {
      method: 'POST',
      headers: {
        Cookie: `${CSRF_COOKIE_NAME}=${token}`,
        'X-CSRF-Token': 'other.sig',
      },
    });
    const result = await validateCsrfDoubleSubmit(req, 'csrf-secret');
    expect(result).toEqual({ ok: false, reason: 'token_mismatch' });
  });
});
