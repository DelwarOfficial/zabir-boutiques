import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { doPeek, doClaim, doComplete, doFail } from '../src/lib/do-client';

/**
 * N-2 Case C: IdempotencyDO object ID must be `idem:{scope}:{key}`, not a
 * raw client-supplied key — two different checkout sessions coincidentally
 * generating the same Idempotency-Key header must never collide on one
 * object.
 */
function fakeIdempotencyNamespace() {
  const idFromName = vi.fn((name: string) => name);
  const get = vi.fn((name: string) => ({
    fetch: vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
  }));
  return { idFromName, get } as unknown as DurableObjectNamespace;
}

describe('N-2 Case C: IdempotencyDO object ID includes the checkout-session scope', () => {
  it('doPeek resolves to idem:{scope}:{key}, not the raw key', async () => {
    const ns = fakeIdempotencyNamespace();
    const env = { IDEMPOTENCY_DO: ns };
    await doPeek(env, 'cart-session-abc', 'client-key-1');
    expect((ns.idFromName as any)).toHaveBeenCalledWith('idem:cart-session-abc:client-key-1');
  });

  it('doClaim resolves to idem:{scope}:{key}', async () => {
    const ns = fakeIdempotencyNamespace();
    const env = { IDEMPOTENCY_DO: ns };
    await doClaim(env, 'buy-now-session-xyz', 'client-key-1');
    expect((ns.idFromName as any)).toHaveBeenCalledWith('idem:buy-now-session-xyz:client-key-1');
  });

  it('doComplete and doFail also resolve to idem:{scope}:{key}', async () => {
    const ns = fakeIdempotencyNamespace();
    const env = { IDEMPOTENCY_DO: ns };
    await doComplete(env, 'scope-a', 'key-1', 'order-1', '{}');
    await doFail(env, 'scope-a', 'key-1');
    expect((ns.idFromName as any)).toHaveBeenCalledWith('idem:scope-a:key-1');
    expect((ns.idFromName as any)).toHaveBeenCalledTimes(2);
  });

  it('the SAME client key under two different scopes resolves to two DIFFERENT object IDs (no cross-session collision)', async () => {
    const ns = fakeIdempotencyNamespace();
    const env = { IDEMPOTENCY_DO: ns };
    await doClaim(env, 'session-victim', 'shared-idempotency-key');
    await doClaim(env, 'session-attacker', 'shared-idempotency-key');

    const calls = (ns.idFromName as any).mock.calls.map((c: unknown[]) => c[0]);
    expect(calls[0]).not.toBe(calls[1]);
    expect(calls).toEqual(['idem:session-victim:shared-idempotency-key', 'idem:session-attacker:shared-idempotency-key']);
  });

  it('checkout.ts passes the cart sessionId as scope at every doPeek/doClaim/doComplete/doFail call site', () => {
    const src = readFileSync(resolve('./src/pages/api/checkout.ts'), 'utf8');
    expect(src).toContain('doPeek(env, sessionId, idempotencyKey)');
    expect(src).toContain('doClaim(env, sessionId, idempotencyKey)');
    expect(src).not.toMatch(/doPeek\(env, idempotencyKey\)/);
    expect(src).not.toMatch(/doClaim\(env, idempotencyKey\)/);
  });

  it('buy-now/submit.ts passes the buy-now sessionId as scope at every call site', () => {
    const src = readFileSync(resolve('./src/pages/api/buy-now/submit.ts'), 'utf8');
    expect(src).toContain('doPeek(env, sessionId, idempotencyKey)');
    expect(src).toContain('doClaim(env, sessionId, idempotencyKey)');
    expect(src).not.toMatch(/doPeek\(env, idempotencyKey\)/);
    expect(src).not.toMatch(/doFail\(env, idempotencyKey\)/);
  });
});
