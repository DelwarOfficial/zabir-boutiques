import { describe, it, expect, vi } from 'vitest';

function fakeKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  } as unknown as KVNamespace;
}

vi.mock('../src/lib/env', () => ({ getEnv: (c: any) => c.locals.runtime.env }));
vi.mock('../src/lib/rbac', () => ({
  requireAuth: async () => ({ id: 'owner1', role: 'owner' }),
  assertOwnerOnly: () => {},
  isSuperAdmin: () => true, // skip step-up in this test, focus is rate limit
  RbacError: class extends Error { toResponse() { return new Response('', { status: 403 }); } },
}));
vi.mock('../src/lib/critical-auth', () => ({
  requireRecentStaffSession: async () => {},
  CriticalAuthError: class extends Error { toResponse() { return new Response('', { status: 403 }); } },
}));
vi.mock('../src/lib/audit', () => ({
  writeCriticalAuditLog: async () => {},
  clientIp: () => null,
  userAgent: () => null,
}));

import { POST } from '../src/pages/api/staff/fraud/override';

function ctx(env: any) {
  return {
    params: {},
    request: new Request('https://x/api/staff/fraud/override', {
      method: 'POST',
      body: JSON.stringify({ order_id: 'o1', decision: 'approved', reason: 'legitimate re-review after customer contact' }),
    }),
    locals: { runtime: { env } },
  } as unknown as import('astro').APIContext;
}

function makeDb() {
  let decision = 'blocked';
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: async () => (sql.includes('SELECT id, fraud_decision') ? { id: 'o1', fraud_decision: decision, status: 'pending_review' } : null),
        run: async () => { decision = 'approved'; return { meta: { changes: 1 } }; },
      })),
    })),
  };
}

describe('K-16: fraud override has a per-staff cooldown', () => {
  it('allows overrides up to the limit, then 429s', async () => {
    const kv = fakeKv();
    const env = { DB: makeDb(), SESSION: kv };

    for (let i = 0; i < 10; i++) {
      const res = await POST(ctx(env));
      expect(res.status).not.toBe(429);
    }
    const eleventh = await POST(ctx(env));
    expect(eleventh.status).toBe(429);
    const body = await eleventh.json();
    expect(body.code).toBe('RATE_LIMITED');
  });

  it('fails open (no throttle) when SESSION KV is not bound', async () => {
    const env = { DB: makeDb() };
    for (let i = 0; i < 15; i++) {
      const res = await POST(ctx(env));
      expect(res.status).not.toBe(429);
    }
  });
});
