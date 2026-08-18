import { describe, it, expect } from 'vitest';
import { appendStaffAuthCookies, clearStaffAuthCookies, readStaffCsrfCookie, staffCsrfCookieName } from '../src/lib/staff-cookies';
import { readFileSync } from 'node:fs';

function parseSetCookies(headers: Headers): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of headers.getSetCookie()) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    map.set(pair.slice(0, idx), c);
  }
  return map;
}

function prodReq() {
  return new Request('https://staff.example.com/');
}

describe('AUTH-2: CSRF cookie is HttpOnly (server-verified) while JS receives the token separately', () => {
  it('sets the CSRF cookie HttpOnly + SameSite=Strict', () => {
    const headers = new Headers();
    appendStaffAuthCookies(headers, prodReq(), { sessionToken: 's', csrfToken: 'tok', maxAge: 100 });
    const cookies = parseSetCookies(headers);
    const name = staffCsrfCookieName(prodReq());
    const csrf = cookies.get(name)!;
    expect(csrf).toBeTruthy();
    expect(csrf).toContain('HttpOnly');
    expect(csrf).toContain('SameSite=Strict');
  });

  it('clears the CSRF cookie with HttpOnly on logout', () => {
    const headers = new Headers();
    clearStaffAuthCookies(headers, prodReq());
    const cookies = parseSetCookies(headers);
    const name = staffCsrfCookieName(prodReq());
    const csrf = cookies.get(name)!;
    expect(csrf).toContain('HttpOnly');
    expect(csrf).toContain('Max-Age=0');
  });

  it('server can still read the HttpOnly CSRF cookie for double-submit verification', () => {
    const req = new Request('https://staff.example.com/', { headers: { Cookie: '__Host-csrf-token=tok' } });
    expect(readStaffCsrfCookie(req)).toBe('tok');
  });

  it('token is delivered to JS without the cookie ever being readable by script', () => {
    // Delivery moved from an inline `window.__ZB_CSRF__ = ...` in the layout
    // to a server-rendered <meta> tag that the bundled shell reads and
    // republishes. The security property is unchanged and the CSP is cleaner
    // (no inline script), so this asserts the property rather than the old
    // one-liner: the server renders the token, and no client code reads
    // document.cookie.
    const layout = readFileSync('src/layouts/StaffLayout.astro', 'utf-8');
    expect(layout).toMatch(/<meta name="zb-csrf" content=\{csrfToken\}/);

    const shell = readFileSync('src/scripts/staff-shell.ts', 'utf-8');
    expect(shell).toMatch(/meta\[name="zb-csrf"\]/);
    expect(shell).toContain('window.__ZB_CSRF__');

    const client = readFileSync('src/lib/csrf-client.ts', 'utf-8');
    expect(client).toContain('window.__ZB_CSRF__');
    // The whole point of the HttpOnly cookie is that script cannot read it.
    for (const [name, src] of Object.entries({ client, shell })) {
      expect(src, `${name} must not read document.cookie`).not.toMatch(/document\.cookie/);
    }
  });
});
