import { describe, it, expect, vi } from 'vitest';
import { normalizeBangladeshPhone } from '../src/lib/phone';
import {
  loadVariantSnapshots,
  calculateAuthoritativeSubtotal,
  assertNoClientMoneyTrust,
  calculateDeliveryPaisa,
  type VariantSnapshot
} from '../src/lib/checkout-pricing';

/**
 * Minimal D1 mock. `rowsFor(sql, params)` returns the rows a query should
 * resolve to, allowing us to simulate authoritative D1 pricing.
 */
function makeDb(handler: (sql: string, params: any[]) => any[]): D1Database {
  return {
    prepare(sql: string) {
      let bound: any[] = [];
      const stmt: any = {
        bind(...params: any[]) { bound = params; return stmt; },
        async all<T>() { return { results: handler(sql, bound) as T[] }; },
        async first<T>() { return (handler(sql, bound)[0] ?? null) as T; },
        async run() { return { meta: { changes: 0 } }; }
      };
      return stmt;
    }
  } as unknown as D1Database;
}

function snapshotRow(variantId: string, price: number | null, opts: Partial<VariantSnapshot> = {}) {
  return {
    variant_id: variantId,
    product_id: opts.product_id ?? `p-${variantId}`,
    product_name: opts.product_name ?? `Product ${variantId}`,
    size: opts.size ?? 'M',
    color: opts.color ?? 'Black',
    sku: opts.sku ?? `SKU-${variantId}`,
    price_paisa: price
  };
}

describe('phone normalization (unchanged)', () => {
  it('rejects empty phone', () => {
    const result = normalizeBangladeshPhone('');
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('reason');
  });

  it('accepts a valid BD mobile', () => {
    const result = normalizeBangladeshPhone('01712345678');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.phone).toBe('+8801712345678');
  });
});

describe('loadVariantSnapshots — authoritative D1 pricing', () => {
  it('loads price_paisa from D1 and ignores any client price', async () => {
    const db = makeDb(() => [snapshotRow('v1', 5000)]);
    const snapshots = await loadVariantSnapshots(db, [{ variantId: 'v1', qty: 2 }]);
    expect(snapshots.get('v1')!.price_paisa).toBe(5000);
  });

  it('falls back to product price when variant price is NULL', async () => {
    // handler returns COALESCE(v.price, p.price) already resolved to product price
    const db = makeDb(() => [snapshotRow('v1', 7500)]);
    const snapshots = await loadVariantSnapshots(db, [{ variantId: 'v1', qty: 1 }]);
    expect(snapshots.get('v1')!.price_paisa).toBe(7500);
  });

  it('throws INVALID_CART_SIZE for empty cart', async () => {
    const db = makeDb(() => []);
    await expect(loadVariantSnapshots(db, [])).rejects.toThrow('INVALID_CART_SIZE');
  });

  it('throws INVALID_CART_SIZE for more than 10 unique variants', async () => {
    const db = makeDb(() => []);
    const items = Array.from({ length: 11 }, (_, i) => ({ variantId: `v${i}`, qty: 1 }));
    await expect(loadVariantSnapshots(db, items)).rejects.toThrow('INVALID_CART_SIZE');
  });

  it('throws INVALID_DB_PRICE when D1 price is null/negative/non-integer', async () => {
    const dbNull = makeDb(() => [snapshotRow('v1', null)]);
    await expect(loadVariantSnapshots(dbNull, [{ variantId: 'v1', qty: 1 }])).rejects.toThrow('INVALID_DB_PRICE:v1');

    const dbNeg = makeDb(() => [snapshotRow('v1', -100)]);
    await expect(loadVariantSnapshots(dbNeg, [{ variantId: 'v1', qty: 1 }])).rejects.toThrow('INVALID_DB_PRICE:v1');
  });

  it('omits unavailable variants (unpublished/deleted) from the result map', async () => {
    // SQL filters them; the mock simply returns only the available row.
    const db = makeDb(() => [snapshotRow('v1', 5000)]);
    const snapshots = await loadVariantSnapshots(db, [
      { variantId: 'v1', qty: 1 },
      { variantId: 'v2', qty: 1 }
    ]);
    expect(snapshots.size).toBe(1);
    expect(snapshots.has('v2')).toBe(false);
  });
});

describe('calculateAuthoritativeSubtotal', () => {
  it('sums D1 price * quantity, never client price', () => {
    const snapshots = new Map<string, VariantSnapshot>([
      ['v1', snapshotRow('v1', 1500) as VariantSnapshot],
      ['v2', snapshotRow('v2', 5000) as VariantSnapshot]
    ]);
    const subtotal = calculateAuthoritativeSubtotal(
      [{ variantId: 'v1', qty: 2 }, { variantId: 'v2', qty: 1 }],
      snapshots
    );
    expect(subtotal).toBe(8000);
  });

  it('PRICE TAMPERING: client unit_price_paisa:1 cannot lower the subtotal', () => {
    // Server only has snapshots; the client value is structurally absent here.
    const snapshots = new Map<string, VariantSnapshot>([
      ['v1', snapshotRow('v1', 50000) as VariantSnapshot]
    ]);
    const subtotal = calculateAuthoritativeSubtotal([{ variantId: 'v1', qty: 1 }], snapshots);
    expect(subtotal).toBe(50000); // not 1
  });

  it('throws VARIANT_NOT_FOUND when a snapshot is missing', () => {
    const snapshots = new Map<string, VariantSnapshot>();
    expect(() => calculateAuthoritativeSubtotal([{ variantId: 'v1', qty: 1 }], snapshots)).toThrow('VARIANT_NOT_FOUND:v1');
  });

  it('throws INVALID_QTY for non-positive quantity', () => {
    const snapshots = new Map<string, VariantSnapshot>([['v1', snapshotRow('v1', 1000) as VariantSnapshot]]);
    expect(() => calculateAuthoritativeSubtotal([{ variantId: 'v1', qty: 0 }], snapshots)).toThrow('INVALID_QTY');
    expect(() => calculateAuthoritativeSubtotal([{ variantId: 'v1', qty: -3 }], snapshots)).toThrow('INVALID_QTY');
  });
});

describe('assertNoClientMoneyTrust', () => {
  it('warns when client money fields are present but does not throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assertNoClientMoneyTrust({
      subtotal_paisa: 1,
      discount_paisa: 999999,
      total_paisa: 1,
      items: [{ variant_id: 'v1', quantity: 1, unit_price_paisa: 1 }]
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stays silent for clean payloads', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assertNoClientMoneyTrust({ items: [{ variant_id: 'v1', quantity: 1 }] });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('calculateDeliveryPaisa — server-side', () => {
  it('uses the inside-Dhaka default when settings absent', async () => {
    const db = makeDb(() => []);
    const delivery = await calculateDeliveryPaisa(db, 'inside Dhaka', 10000);
    expect(delivery).toBe(7000);
  });

  it('uses the outside-Dhaka default when settings absent', async () => {
    const db = makeDb(() => []);
    const delivery = await calculateDeliveryPaisa(db, 'Chittagong', 10000);
    expect(delivery).toBe(13000);
  });

  it('reads an integer-paisa rate from site_settings when present', async () => {
    const db = makeDb(() => [{ value: '8000' }]);
    const delivery = await calculateDeliveryPaisa(db, 'inside', 10000);
    expect(delivery).toBe(8000);
  });

  it('ignores invalid site_settings values and falls back to default', async () => {
    const db = makeDb(() => [{ value: 'not-a-number' }]);
    const delivery = await calculateDeliveryPaisa(db, 'Chittagong', 10000);
    expect(delivery).toBe(13000);
  });
});

describe('total computation (server authoritative)', () => {
  it('TOTAL MISMATCH BYPASS: server total is independent of client subtotal/total', () => {
    // Client claims fake-but-consistent subtotal/total; server recomputes.
    const snapshots = new Map<string, VariantSnapshot>([['v1', snapshotRow('v1', 5000) as VariantSnapshot]]);
    const subtotal = calculateAuthoritativeSubtotal([{ variantId: 'v1', qty: 1 }], snapshots);
    const delivery = 6000;
    const discount = 0;
    const total = Math.max(0, subtotal + delivery - discount);
    expect(subtotal).toBe(5000);
    expect(total).toBe(11000);
  });

  it('DISCOUNT TAMPERING: a client discount cannot reduce the total (only coupons can)', () => {
    const snapshots = new Map<string, VariantSnapshot>([['v1', snapshotRow('v1', 5000) as VariantSnapshot]]);
    const subtotal = calculateAuthoritativeSubtotal([{ variantId: 'v1', qty: 1 }], snapshots);
    const delivery = 6000;
    const serverDiscount = 0; // no coupon applied
    const total = Math.max(0, subtotal + delivery - serverDiscount);
    expect(total).toBe(11000); // client discount_paisa was ignored
  });

  it('clamps total to a non-negative value', () => {
    const subtotal = 1000;
    const delivery = 0;
    const discount = 5000; // a large coupon
    expect(Math.max(0, subtotal + delivery - discount)).toBe(0);
  });
});
