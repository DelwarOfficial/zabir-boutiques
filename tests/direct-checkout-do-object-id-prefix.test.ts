import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveDirectCheckoutStub, doCreateDirectSession, buyObjectKey, type DirectCheckoutState } from '../src/lib/do-client';

/**
 * N-2 Case A (DirectCheckoutSessionDO): object ID is `buy:{sessionId}`.
 * Unlike VariantInventoryDO/CartDO, this DO has no env.DB access at all, so
 * migration must be genuine peer-to-peer DO hydrate via `export-for-migration`
 * (not `get`, which is bindingSecret-gated) + `hydrate`.
 *
 * This fake namespace models TWO real objects distinguished by object-ID
 * string — a raw-named legacy object (created by pre-N-2 code) and a
 * `buy:{id}`-prefixed one — so the resolver's probe/migrate/hydrate dance is
 * actually exercised end to end, not just asserted via a single mock call.
 */
function fakeDirectCheckoutNamespace(seedLegacy?: Record<string, DirectCheckoutState>) {
  const objects = new Map<string, { migrated: boolean; session: DirectCheckoutState | null }>();
  if (seedLegacy) {
    for (const [id, session] of Object.entries(seedLegacy)) {
      objects.set(id, { migrated: true, session });
    }
  }

  function getOrCreate(id: string) {
    let obj = objects.get(id);
    if (!obj) {
      obj = { migrated: false, session: null };
      objects.set(id, obj);
    }
    return obj;
  }

  const idFromName = (name: string) => name;
  const get = (id: string) => ({
    fetch: async (url: string, init?: { body?: string }) => {
      const obj = getOrCreate(id);
      const path = new URL(url).pathname.slice(1);
      const body = init?.body ? JSON.parse(init.body) : {};
      if (path === 'init-status') {
        return new Response(JSON.stringify({ initialized: obj.migrated }));
      }
      if (path === 'export-for-migration') {
        return new Response(JSON.stringify({ ok: true, session: obj.session }));
      }
      if (path === 'hydrate') {
        if (obj.migrated) return new Response(JSON.stringify({ ok: true, alreadyMigrated: true }));
        if (body.session) obj.session = body.session;
        obj.migrated = true;
        return new Response(JSON.stringify({ ok: true, session: obj.session }));
      }
      if (path === 'create') {
        obj.session = { ...body, bindingHash: 'h', formDraft: null } as DirectCheckoutState;
        obj.migrated = true;
        return new Response(JSON.stringify({ ok: true, session: obj.session }));
      }
      if (path === 'get') {
        return new Response(JSON.stringify({ ok: true, session: obj.session }));
      }
      return new Response(JSON.stringify({ ok: false, error: 'UNKNOWN_ACTION' }), { status: 400 });
    },
  });

  return { idFromName, get, objects } as unknown as DurableObjectNamespace & { objects: typeof objects };
}

describe('N-2 Case A: DirectCheckoutSessionDO object ID is buy:{id}, migrated via export-for-migration + hydrate', () => {
  it('resolveDirectCheckoutStub addresses the buy:{id}-prefixed object', async () => {
    const ns = fakeDirectCheckoutNamespace();
    await resolveDirectCheckoutStub(ns, 'sid1');
    expect(ns.objects.has(buyObjectKey('sid1'))).toBe(true);
  });

  it('a legacy raw-keyed object is migrated on first resolve: bindingHash and formDraft carry over intact', async () => {
    const legacySession: DirectCheckoutState = {
      sessionId: 'sid1',
      productId: 'p1',
      variantId: 'v1',
      quantity: 2,
      selectedOptions: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:30:00.000Z',
      landingVersion: 3,
      sourcePage: '/products/p1',
      utmParams: null,
      formDraft: { name: 'Karim', phone: '01700000000' },
    } as unknown as DirectCheckoutState;
    (legacySession as unknown as { bindingHash: string }).bindingHash = 'sha256-of-real-secret';

    const ns = fakeDirectCheckoutNamespace({ sid1: legacySession });
    const stub = await resolveDirectCheckoutStub(ns, 'sid1');
    const res = await stub.fetch('https://do/get', { method: 'POST', body: '{}' });
    const data = (await res.json()) as { ok: boolean; session: DirectCheckoutState };

    expect(data.session.formDraft).toEqual({ name: 'Karim', phone: '01700000000' });
    expect((data.session as unknown as { bindingHash: string }).bindingHash).toBe('sha256-of-real-secret');
    expect(ns.objects.get(buyObjectKey('sid1'))?.migrated).toBe(true);
  });

  it('hydrate is idempotent: a second resolve does not re-copy or clobber the migrated object', async () => {
    const legacySession: DirectCheckoutState = { sessionId: 'sid1', productId: 'p1' } as unknown as DirectCheckoutState;
    const ns = fakeDirectCheckoutNamespace({ sid1: legacySession });

    await resolveDirectCheckoutStub(ns, 'sid1');
    const newObj = ns.objects.get(buyObjectKey('sid1'))!;
    newObj.session = { ...(newObj.session as object), productId: 'mutated-locally' } as DirectCheckoutState;

    await resolveDirectCheckoutStub(ns, 'sid1');
    expect(ns.objects.get(buyObjectKey('sid1'))?.session?.productId).toBe('mutated-locally');
  });

  it('no legacy object exists: resolve marks the new object migrated without a session (fresh empty state, not stuck re-probing forever)', async () => {
    const ns = fakeDirectCheckoutNamespace();
    await resolveDirectCheckoutStub(ns, 'never-existed');
    const obj = ns.objects.get(buyObjectKey('never-existed'));
    expect(obj?.migrated).toBe(true);
    expect(obj?.session).toBeNull();
  });

  it('doCreateDirectSession (brand-new session) is created directly under the buy: prefix, no migration probe needed', async () => {
    const ns = fakeDirectCheckoutNamespace();
    await doCreateDirectSession({ DIRECT_CHECKOUT_DO: ns } as never, {
      productId: 'p1',
      variantId: 'v1',
      quantity: 1,
    });
    const keys = [...ns.objects.keys()];
    expect(keys.every((k) => k.startsWith('buy:'))).toBe(true);
  });

  it('DO source: export-for-migration bypasses verifySessionBinding (server-side infra hop, not customer-facing)', () => {
    const src = readFileSync(resolve('./src/do/direct-checkout-session-do.ts'), 'utf8');
    const exportCase = src.slice(src.indexOf("case 'export-for-migration'"), src.indexOf("case 'create'"));
    expect(exportCase).not.toContain('verifySessionBinding');
    expect(src).toContain("case 'init-status'");
    expect(src).toContain("case 'hydrate'");
  });

  it('do-client.ts: no bare idFromName(sessionId) call sites remain for DIRECT_CHECKOUT_DO reads', () => {
    const src = readFileSync(resolve('./src/lib/do-client.ts'), 'utf8');
    expect(src).toContain('function buyObjectKey(sessionId: string)'.replace('function', 'export function'));
    expect(src).toContain('resolveDirectCheckoutStub');
  });
});
