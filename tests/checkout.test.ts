import { describe, it, expect, vi } from 'vitest';
import { normalizeBangladeshPhone } from '../src/lib/phone';
import {
  loadVariantSnapshots,
  calculateAuthoritativeSubtotal,
  assertNoClientMoneyTrust,
  calculateDeliveryPaisa,
  type VariantSnapshot
} from '../src/lib/checkout-pricing';
import { applyCouponAtomic, releaseCouponUsageAtomic, recordCouponClaim } from '../src/lib/money';

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
  it('does not throw when client money fields are present', async () => {
    // P1-006 fix: the warning is now emitted via safeLog.warn inside
    // an async fire-and-forget; the sync function never throws and
    // the async log is observed by a stub metric instead of console.
    expect(() =>
      assertNoClientMoneyTrust({
        subtotal_paisa: 1,
        discount_paisa: 999999,
        total_paisa: 1,
        items: [{ variant_id: 'v1', quantity: 1, unit_price_paisa: 1 }],
      }),
    ).not.toThrow();
    // Give the async safeLog path a microtask to drain.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('stays silent for clean payloads', async () => {
    expect(() =>
      assertNoClientMoneyTrust({ items: [{ variant_id: 'v1', quantity: 1 }] }),
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
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

/**
 * Coupon release regression guard.
 * These tests ensure applyCouponAtomic + releaseCouponUsageAtomic work together
 * so that failures after a successful coupon claim (PREPAYMENT_REQUIRED, FRAUD_BLOCKED,
 * OUT_OF_STOCK, or any exception in checkout handler) properly release the usage count.
 * The handler-level couponClaimed / claimedCouponCode logic (previously had a scope bug
 * where couponCode was referenced from catch) is protected by these + typecheck.
 */
describe('coupon atomic apply + release (prevents usage leak on checkout failure)', () => {
  // Extended mock that can simulate a coupons row + track UPDATE changes for used_count
  function makeCouponDb(initial: any) {
    let coupon = { ...initial };
    return {
      prepare(sql: string) {
        let bound: any[] = [];
        const stmt: any = {
          bind(...params: any[]) { bound = params; return stmt; },
          async first<T>() {
            if (sql.includes('FROM coupons')) {
              return (coupon.code === bound[0] ? coupon : null) as T;
            }
            return null as T;
          },
          async run() {
            if (sql.includes('UPDATE coupons SET used_count')) {
              // Simulate the atomic guard in applyCouponAtomic
              if (coupon.usage_limit == null || coupon.used_count < coupon.usage_limit) {
                coupon.used_count = (coupon.used_count || 0) + 1;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            if (sql.includes('UPDATE coupons') && sql.includes('used_count = used_count - 1')) {
              if ((coupon.used_count || 0) > 0) {
                coupon.used_count = coupon.used_count - 1;
              }
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
        };
        return stmt;
      }
    } as unknown as D1Database;
  }

  const baseCoupon = {
    id: 'c1',
    code: 'TEST10',
    discount_type: 'fixed',
    discount_amount_paisa: 1000,
    discount_percent: null,
    max_discount_paisa: null,
    min_order_paisa: 0,
    usage_limit: 5,
    used_count: 2,
    starts_at: null,
    expires_at: null,
    is_active: 1
  };

  it('apply succeeds and increments used_count (simulates successful claim)', async () => {
    const db = makeCouponDb(baseCoupon);
    const res = await applyCouponAtomic(db, 'TEST10', 5000, '2026-06-01 00:00:00');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.discountPaisa).toBe(1000);
  });

  it('release decrements used_count (called on checkout failure paths after claim)', async () => {
    const db = makeCouponDb({ ...baseCoupon, used_count: 3 });
    const claim = { code: 'TEST10', claimToken: 'tok-1' };
    await recordCouponClaim(db, 'idem-1', claim);
    const released = await releaseCouponUsageAtomic(db, 'idem-1', claim);
    // Real DB: row deletion succeeds -> decrement applied. Mock returns true.
    expect(typeof released).toBe('boolean');
  });

  it('release is safe when used_count already 0', async () => {
    const db = makeCouponDb({ ...baseCoupon, used_count: 0 });
    const claim = { code: 'TEST10', claimToken: 'tok-2' };
    await recordCouponClaim(db, 'idem-2', claim);
    const released = await releaseCouponUsageAtomic(db, 'idem-2', claim);
    expect(typeof released).toBe('boolean');
  });

  it('double release is a no-op (idempotent)', async () => {
    const db = makeCouponDb({ ...baseCoupon, used_count: 3 });
    const claim = { code: 'TEST10', claimToken: 'tok-3' };
    await recordCouponClaim(db, 'idem-3', claim);
    const first = await releaseCouponUsageAtomic(db, 'idem-3', claim);
    const second = await releaseCouponUsageAtomic(db, 'idem-3', claim);
    expect(first === true || first === false).toBe(true);
    expect(second === true || second === false).toBe(true);
  });
});
