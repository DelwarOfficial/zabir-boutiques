import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateCsrfDoubleSubmit } from '../src/lib/csrf';
import { createCsrfToken } from '../src/lib/security';

const SECRET = 'test-csrf-secret';

function reqWith(cookieToken: string | null, headerToken: string | null): Request {
  const headers = new Headers();
  if (cookieToken) headers.set('Cookie', `csrf-token=${cookieToken}; __Host-csrf-token=${cookieToken}`);
  if (headerToken) headers.set('X-CSRF-Token', headerToken);
  return new Request('https://staff.zabirboutiques.com/api/staff/logout', { method: 'POST', headers });
}

describe('AUTH-1: staff logout CSRF enforcement (the protection the route relies on)', () => {
  it('rejects logout without CSRF header', async () => {
    const token = await createCsrfToken(SECRET);
    const res = await validateCsrfDoubleSubmit(reqWith(token, null), SECRET);
    expect(res.ok).toBe(false);
  });

  it('rejects logout with mismatched cookie/header', async () => {
    const token = await createCsrfToken(SECRET);
    const res = await validateCsrfDoubleSubmit(reqWith(token, 'forged'), SECRET);
    expect(res.ok).toBe(false);
  });

  it('accepts logout with matching cookie + header and valid signature', async () => {
    const token = await createCsrfToken(SECRET);
    const res = await validateCsrfDoubleSubmit(reqWith(token, token), SECRET);
    expect(res.ok).toBe(true);
  });

  it('rejects a token with an invalid signature', async () => {
    const res = await validateCsrfDoubleSubmit(reqWith('deadbeef.notahmac', 'deadbeef.notahmac'), SECRET);
    expect(res.ok).toBe(false);
  });
});

describe('AUTH-1: StaffShell logout calls the correct endpoint with CSRF', () => {
  const source = readFileSync(resolve('./src/layouts/StaffShell.astro'), 'utf-8');

  it('posts to /api/staff/logout (not the broken /staff/logout path)', () => {
    expect(source).toContain("fetch('/api/staff/logout'");
    expect(source).not.toContain("fetch('/staff/logout'");
  });

  it('sends the X-CSRF-Token header', () => {
    expect(source).toContain("'X-CSRF-Token': csrfToken");
  });

  it('reads the CSRF token server-side and injects it', () => {
    expect(source).toContain('readCsrfCookie(Astro.request)');
    expect(source).toContain('define:vars={{ csrfToken }}');
  });
});
