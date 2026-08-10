import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { doReserve, doRelease, doConfirm, doDirectSale, doReverseDirectSale, doGetAvailability, doAdjustStock } from '../src/lib/do-client';

/**
 * N-2 Case A (VariantInventoryDO): object ID is `variant:{id}`. Verified
 * against the real object-ID string every do-client.ts helper resolves to
 * — not the mock's own internal state keying, so this actually exercises
 * the prefix, unlike a mock that happens to strip it back off.
 */
function fakeNamespace() {
  const idFromName = vi.fn((name: string) => name);
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, stock: 0, reserved: 0, sold: 0, available: 0 })));
  const get = vi.fn((name: string) => ({ fetch: fetchImpl }));
  return { idFromName, get, fetchImpl } as unknown as DurableObjectNamespace & { idFromName: any; get: any; fetchImpl: any };
}

describe('N-2 Case A: VariantInventoryDO object ID is variant:{id} at every do-client.ts call site', () => {
  it('doReserve', async () => {
    const ns = fakeNamespace();
    await doReserve({ VARIANT_INVENTORY_DO: ns, DB: {} as any }, 'v1', 1);
    expect((ns as any).idFromName).toHaveBeenCalledWith('variant:v1');
  });

  it('doRelease', async () => {
    const ns = fakeNamespace();
    await doRelease({ VARIANT_INVENTORY_DO: ns, DB: {} as any }, 'v1', 1);
    expect((ns as any).idFromName).toHaveBeenCalledWith('variant:v1');
  });

  it('doConfirm', async () => {
    const ns = fakeNamespace();
    await doConfirm({ VARIANT_INVENTORY_DO: ns, DB: {} as any }, 'v1', 1);
    expect((ns as any).idFromName).toHaveBeenCalledWith('variant:v1');
  });

  it('doDirectSale', async () => {
    const ns = fakeNamespace();
    await doDirectSale({ VARIANT_INVENTORY_DO: ns, DB: {} as any }, 'v1', 1);
    expect((ns as any).idFromName).toHaveBeenCalledWith('variant:v1');
  });

  it('doReverseDirectSale', async () => {
    const ns = fakeNamespace();
    await doReverseDirectSale({ VARIANT_INVENTORY_DO: ns, DB: {} as any }, 'v1', 1, 'inv1', 'reason');
    expect((ns as any).idFromName).toHaveBeenCalledWith('variant:v1');
  });

  it('doGetAvailability', async () => {
    const ns = fakeNamespace();
    await doGetAvailability({ VARIANT_INVENTORY_DO: ns, DB: {} as any }, 'v1');
    expect((ns as any).idFromName).toHaveBeenCalledWith('variant:v1');
  });

  it('doAdjustStock', async () => {
    const ns = fakeNamespace();
    (ns as any).fetchImpl.mockResolvedValue(new Response(JSON.stringify({ ok: true, previous_stock: 0, new_stock: 1, adjustment_id: 'a1' })));
    await doAdjustStock({ VARIANT_INVENTORY_DO: ns, DB: {} as any }, 'v1', 1, 'restock', 'staff1');
    expect((ns as any).idFromName).toHaveBeenCalledWith('variant:v1');
  });

  it('two different variant IDs never collide on the same object', async () => {
    const ns = fakeNamespace();
    await doGetAvailability({ VARIANT_INVENTORY_DO: ns, DB: {} as any }, 'v1');
    await doGetAvailability({ VARIANT_INVENTORY_DO: ns, DB: {} as any }, 'v2');
    const calls = (ns as any).idFromName.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toEqual(['variant:v1', 'variant:v2']);
  });

  it('ensureInitialized in the real DO class hydrates by the variantId in the request body, not the object-ID string — confirms no new DO code was needed', () => {
    const src = readFileSync(resolve('./src/do/variant-inventory-do.ts'), 'utf8');
    expect(src).toContain('await this.ensureInitialized(env, variantId);');
    expect(src).toContain('FROM inventory_items WHERE variant_id = ?1');
  });
});
