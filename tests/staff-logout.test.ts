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

describe('AUTH-1: active staff shell logout calls the correct endpoint with CSRF', () => {
  // The logout handler moved out of Navbar.astro's inline script into the
  // bundled staff shell module. Asserting on the old file/syntax made these
  // tests fail on a refactor that preserved every security property — so they
  // now assert the properties themselves, wherever the handler lives.
  const layout = readFileSync(resolve('./src/layouts/StaffLayout.astro'), 'utf-8');
  const shell = readFileSync(resolve('./src/scripts/staff-shell.ts'), 'utf-8');

  it('posts to /api/staff/logout (not the broken /staff/logout path)', () => {
    expect(shell).toContain("fetch('/api/staff/logout'");
    // The page route would 404 and silently leave the session alive.
    expect(shell).not.toContain("fetch('/staff/logout'");
  });

  it('sends the X-CSRF-Token header', () => {
    expect(shell).toMatch(/'X-CSRF-Token':\s*getCsrf\(\)/);
  });

  it('reads the CSRF token server-side and injects it', () => {
    // Server reads the HttpOnly cookie and renders the value into the page,
    // which is what lets the cookie stay HttpOnly.
    expect(layout).toContain('readCsrfCookie(Astro.request)');
    expect(layout).toMatch(/<meta name="zb-csrf" content=\{csrfToken\}/);
  });

  it('the logout button the handler binds to actually exists in the navbar', () => {
    // The handler and the markup live in different files now, so a renamed id
    // would silently disable logout with no build or type error.
    const navbar = readFileSync(resolve('./src/components/staff/layout/Navbar.astro'), 'utf-8');
    expect(navbar).toContain('id="logout-btn"');
    expect(shell).toContain("getElementById('logout-btn')");
  });
});
