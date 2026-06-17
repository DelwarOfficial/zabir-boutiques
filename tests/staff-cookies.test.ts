import { describe, expect, it } from 'vitest';
import {
  appendStaffAuthCookies,
  isLocalHttpDev,
  readStaffCsrfCookie,
  readStaffSessionCookie,
  staffCsrfCookieName,
  staffSessionCookieName,
} from '../src/lib/staff-cookies';

describe('staff-cookies', () => {
  it('uses non-Secure bare names on local HTTP dev', () => {
    const request = new Request('http://localhost:4321/api/staff/login');
    expect(isLocalHttpDev(request)).toBe(true);
    expect(staffSessionCookieName(request)).toBe('session');
    expect(staffCsrfCookieName(request)).toBe('csrf-token');

    const headers = new Headers();
    appendStaffAuthCookies(headers, request, {
      sessionToken: 'abc',
      csrfToken: 'def',
      maxAge: 3600,
    });

    const cookies = headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('session=abc');
    expect(cookies[0]).not.toContain('Secure');
    expect(cookies[0]).not.toContain('__Host-');
    expect(cookies[1]).toContain('csrf-token=def');
    expect(cookies[1]).not.toContain('Secure');
  });

  it('uses __Host- Secure cookies in production', () => {
    const request = new Request('https://zabirboutiques.com/api/staff/login');
    expect(isLocalHttpDev(request)).toBe(false);
    expect(staffSessionCookieName(request)).toBe('__Host-session');
    expect(staffCsrfCookieName(request)).toBe('__Host-csrf-token');

    const headers = new Headers();
    appendStaffAuthCookies(headers, request, {
      sessionToken: 'abc',
      csrfToken: 'def',
      maxAge: 3600,
    });

    const cookies = headers.getSetCookie();
    expect(cookies[0]).toContain('__Host-session=abc');
    expect(cookies[0]).toContain('Secure');
    expect(cookies[1]).toContain('__Host-csrf-token=def');
    expect(cookies[1]).toContain('Secure');
  });

  it('reads the dev session cookie from the matching request host', () => {
    const request = new Request('http://localhost:4321/staff', {
      headers: { Cookie: 'session=token123; csrf-token=csrf456' },
    });
    expect(readStaffSessionCookie(request)).toBe('token123');
    expect(readStaffCsrfCookie(request)).toBe('csrf456');
  });
});