import { describe, it, expect, vi } from 'vitest';
import { checkLoginRateLimit, resetLoginRateLimit, sha256Hex, LOGIN_RATE_LIMIT } from '../src/lib/login-rate-limit';
import { readFileSync } from 'node:fs';

function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
  } as unknown as KVNamespace & { store: Map<string, string> };
}

function makeContext(body: Record<string, unknown>, kv: KVNamespace, ip = '1.2.3.4') {
  const env = { DB: {}, SESSION: kv, SESSION_SECRET: 's', PASSWORD_PEPPER: 'p' } as any;
  const request = new Request('https://staff.example.com/api/staff/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
  return { request, env } as any;
}

describe('AUTH-3: login rate limiting logic', () => {
  it('allows up to max attempts per window then blocks with Retry-After', async () => {
    const kv = fakeKv();
    const max = LOGIN_RATE_LIMIT.perIp.max;
    for (let i = 0; i < max; i++) {
      expect((await checkLoginRateLimit(kv, 'ip', '1.2.3.4')).ok).toBe(true);
    }
    const blocked = await checkLoginRateLimit(kv, 'ip', '1.2.3.4');
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(LOGIN_RATE_LIMIT.perIp.windowSeconds);
  });

  it('fails open when no KV is bound', async () => {
    const r = await checkLoginRateLimit(undefined, 'ip', '1.2.3.4');
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(LOGIN_RATE_LIMIT.perIp.max);
  });

  it('resets the counter on success', async () => {
    const kv = fakeKv();
    await checkLoginRateLimit(kv, 'identifier', 'abc');
    await checkLoginRateLimit(kv, 'identifier', 'abc');
    await resetLoginRateLimit(kv, 'identifier', 'abc');
    const r = await checkLoginRateLimit(kv, 'identifier', 'abc');
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(LOGIN_RATE_LIMIT.perIdentifier.max - 1);
  });

  it('sha256Hex is deterministic and hex-encoded', async () => {
    const a = await sha256Hex('foo@bar.com');
    const b = await sha256Hex('foo@bar.com');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]+$/);
  });
});

describe('AUTH-3: login route enforces rate limits and prevents enumeration', () => {
  it('returns 429 when the per-IP limit is exceeded', async () => {
    const kv = fakeKv({ 'ratelimit:login:ip:1.2.3.4': String(LOGIN_RATE_LIMIT.perIp.max) });
    const { POST } = await import('../src/pages/api/staff/login');
    const res = await POST(makeContext({ identifier: 'a@b.com', password: 'pw' }, kv));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/Too many attempts/i);
  });

  it('wires rate-limit checks + reset and applies timing-equalization on unknown user', () => {
    const src = readFileSync('src/pages/api/staff/login.ts', 'utf-8');
    expect(src).toContain('checkLoginRateLimit(');
    expect(src).toContain('resetLoginRateLimit(');
    // Unknown-user path burns PBKDF2 to match the wrong-password timing
    // (kills the account-existence latency oracle).
    expect(src).toContain('hashPassword(password, generateRandomHex(16)');
    // Only a single generic error string is used for credential failures.
    const invalidCount = (src.match(/Invalid credentials/g) || []).length;
    expect(invalidCount).toBeGreaterThanOrEqual(2);
  });
});
