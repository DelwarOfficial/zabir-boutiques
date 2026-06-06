export type Paisa = number;

export function assertPaisa(value: number, label = "amount"): Paisa {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer paisa value`);
  }
  return value;
}

export function addPaisa(values: Paisa[]): Paisa {
  return values.reduce((sum, value) => assertPaisa(sum + value, "sum"), 0);
}

export function multiplyPaisa(value: Paisa, quantity: number): Paisa {
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("quantity must be a positive integer");
  return assertPaisa(value * quantity, "line total");
}

export function formatPaisa(paisa: Paisa): string {
  assertPaisa(paisa);
  const taka = Math.floor(paisa / 100);
  return `\u09f3${new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(taka)}`;
}

export type DiscountType = 'fixed' | 'percentage';

export function calculateCouponDiscount(
  subtotalPaisa: Paisa,
  discountType: DiscountType,
  discountAmountPaisa: number | null,
  discountPercent: number | null,
  maxDiscountPaisa: number | null
): Paisa {
  if (discountType === 'fixed') {
    return assertPaisa(discountAmountPaisa ?? 0, 'coupon_fixed_amount');
  }
  if (discountType === 'percentage' && discountPercent != null) {
    const raw = Math.floor(subtotalPaisa * discountPercent / 100);
    return maxDiscountPaisa != null ? Math.min(raw, maxDiscountPaisa) : raw;
  }
  return 0;
}

export async function applyCouponAtomic(
  db: D1Database,
  code: string,
  subtotalPaisa: Paisa,
  now: string
): Promise<{ ok: true; discountPaisa: Paisa } | { ok: false; reason: string }> {
  const coupon = await db.prepare(
    `SELECT id, discount_type, discount_amount_paisa, discount_percent,
            max_discount_paisa, min_order_paisa, usage_limit, used_count,
            starts_at, expires_at, is_active
     FROM coupons WHERE code = ?1`
  ).bind(code).first<any>();

  if (!coupon) return { ok: false, reason: 'COUPON_NOT_FOUND' };
  if (!coupon.is_active) return { ok: false, reason: 'COUPON_INACTIVE' };

  if (coupon.expires_at && coupon.expires_at < now) {
    return { ok: false, reason: 'COUPON_EXPIRED' };
  }
  if (coupon.starts_at && coupon.starts_at > now) {
    return { ok: false, reason: 'COUPON_NOT_YET_VALID' };
  }
  if (coupon.usage_limit != null && coupon.used_count >= coupon.usage_limit) {
    return { ok: false, reason: 'COUPON_EXHAUSTED' };
  }
  if (subtotalPaisa < (coupon.min_order_paisa ?? 0)) {
    return { ok: false, reason: 'COUPON_MIN_ORDER' };
  }

  const result = await db.prepare(
    `UPDATE coupons SET used_count = used_count + 1
     WHERE code = ?1 AND (usage_limit IS NULL OR used_count < usage_limit)`
  ).bind(code).run();

  if (result.meta.changes !== 1) return { ok: false, reason: 'COUPON_RACE_LOST' };

  return {
    ok: true,
    discountPaisa: calculateCouponDiscount(
      subtotalPaisa,
      coupon.discount_type,
      coupon.discount_amount_paisa,
      coupon.discount_percent,
      coupon.max_discount_paisa
    )
  };
}
