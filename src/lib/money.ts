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

export interface CouponClaim {
  code: string;
  claimToken: string;
}

export async function applyCouponAtomic(
  db: D1Database,
  code: string,
  subtotalPaisa: Paisa,
  now: string
): Promise<{ ok: true; discountPaisa: Paisa; claim: CouponClaim } | { ok: false; reason: string }> {
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
    ),
    claim: { code, claimToken: crypto.randomUUID() }
  };
}

/**
 * Release a previously claimed coupon usage, idempotently tied to the
 * original claim token. Returns true if a decrement was applied, false
 * if the claim was already released (or never recorded).
 *
 * The claim token is stored in the checkout_idempotency row by the caller
 * (see `recordCouponClaim`); on release we delete that row and decrement
 * the coupon only when the row existed. This means a double release path
 * (release on fraud-block, then release again in the catch block) can
 * only decrement the coupon once.
 */
export async function releaseCouponUsageAtomic(
  db: D1Database,
  idempotencyKey: string,
  claim: CouponClaim
): Promise<boolean> {
  if (!idempotencyKey || !claim?.claimToken) return false;
  // Only release if the claim row still exists; delete it to prevent re-release.
  const result = await db.prepare(
    `DELETE FROM checkout_idempotency_coupon_claims
     WHERE idempotency_key = ?1 AND claim_token = ?2`
  ).bind(idempotencyKey, claim.claimToken).run();
  if (result.meta.changes !== 1) return false;
  await db.prepare(
    `UPDATE coupons
     SET used_count = used_count - 1
     WHERE code = ?1 AND used_count > 0`
  ).bind(claim.code).run();
  return true;
}

/**
 * Record a coupon claim in the idempotency system so that
 * `releaseCouponUsageAtomic` can verify and atomically remove it.
 */
export async function recordCouponClaim(
  db: D1Database,
  idempotencyKey: string,
  claim: CouponClaim
): Promise<void> {
  if (!idempotencyKey || !claim?.claimToken) return;
  await db.prepare(
    `INSERT OR IGNORE INTO checkout_idempotency_coupon_claims (idempotency_key, claim_token, code, created_at)
     VALUES (?1, ?2, ?3, ?4)`
  ).bind(idempotencyKey, claim.claimToken, claim.code, new Date().toISOString().replace('T', ' ').slice(0, 19)).run();
}
