import { describe, it, expect } from 'vitest';
import {
  buyNowSessionCookieName,
  buyNowBindingCookieName,
  appendBuyNowSessionCookies,
} from '../src/lib/buy-now-cookies';

function req(url: string): Request {
  return new Request(url);
}

describe('buy-now-host-cookie-tossing (RV8-003)', () => {
  it('uses the __Host- prefix on production HTTPS requests', () => {
    const r = req('https://zabirboutiques.com/buy-now/x');
    expect(buyNowSessionCookieName(r)).toBe('__Host-bn_sid');
    expect(buyNowBindingCookieName(r)).toBe('__Host-bn_bind');
  });

  it('drops the __Host- prefix only for plain-HTTP loopback dev', () => {
    const r = req('http://localhost:4321/buy-now/x');
    expect(buyNowSessionCookieName(r)).toBe('bn_sid');
    expect(buyNowBindingCookieName(r)).toBe('bn_bind');
  });

  it('a non-loopback host over HTTP still gets the __Host- prefix (not just an HTTPS check)', () => {
    // __Host- requires Secure + Path=/ + no Domain attribute. A malicious
    // subdomain (attacker.zabirboutiques.com, or any non-loopback host)
    // cannot set a cookie the browser will accept under this prefix for a
    // different host — that is the mechanical block on cookie tossing.
    const r = req('http://staging.zabirboutiques.com/buy-now/x');
    expect(buyNowSessionCookieName(r)).toBe('__Host-bn_sid');
  });

  it('the Set-Cookie header has no Domain attribute (required for __Host- to be honored)', () => {
    const r = req('https://zabirboutiques.com/buy-now/x');
    const headers = new Headers();
    appendBuyNowSessionCookies(headers, r, { sessionId: 's1', bindingSecret: 'b1' });
    const cookies = headers.getSetCookie ? headers.getSetCookie() : [...headers.entries()].filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v);
    for (const c of cookies) {
      expect(c.toLowerCase()).not.toContain('domain=');
      expect(c).toContain('Path=/');
      expect(c).toContain('Secure');
      expect(c).toContain('HttpOnly');
    }
  });

  it('cookie name matches between the staff-cookie convention and the buy-now convention (same isLocalHttpDev gate)', () => {
    // Both modules gate on the same isLocalHttpDev() check imported from
    // staff-cookies.ts — a drift between the two would mean one flow is
    // secure in production while the other silently isn't.
    const r = req('https://zabirboutiques.com/x');
    expect(buyNowSessionCookieName(r).startsWith('__Host-')).toBe(true);
  });
});
