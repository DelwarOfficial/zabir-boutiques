globalThis.process ??= {};
globalThis.process.env ??= {};
function assertPaisa(value, label = "amount") {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer paisa value`);
  }
  return value;
}
function addPaisa(values) {
  return values.reduce((sum, value) => assertPaisa(sum + value, "sum"), 0);
}
function multiplyPaisa(value, quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("quantity must be a positive integer");
  return assertPaisa(value * quantity, "line total");
}
function formatPaisa(paisa) {
  assertPaisa(paisa);
  const taka = Math.floor(paisa / 100);
  return `৳${new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(taka)}`;
}
function calculateCouponDiscount(subtotalPaisa, discountType, discountAmountPaisa, discountPercent, maxDiscountPaisa) {
  if (discountType === "fixed") {
    return assertPaisa(discountAmountPaisa ?? 0, "coupon_fixed_amount");
  }
  if (discountType === "percentage" && discountPercent != null) {
    const raw = Math.floor(subtotalPaisa * discountPercent / 100);
    return maxDiscountPaisa != null ? Math.min(raw, maxDiscountPaisa) : raw;
  }
  return 0;
}
async function applyCouponAtomic(db, code, subtotalPaisa, now) {
  const coupon = await db.prepare(
    `SELECT id, discount_type, discount_amount_paisa, discount_percent,
            max_discount_paisa, min_order_paisa, usage_limit, used_count,
            starts_at, expires_at, is_active
     FROM coupons WHERE code = ?1`
  ).bind(code).first();
  if (!coupon) return { ok: false, reason: "COUPON_NOT_FOUND" };
  if (!coupon.is_active) return { ok: false, reason: "COUPON_INACTIVE" };
  if (coupon.expires_at && coupon.expires_at < now) {
    return { ok: false, reason: "COUPON_EXPIRED" };
  }
  if (coupon.starts_at && coupon.starts_at > now) {
    return { ok: false, reason: "COUPON_NOT_YET_VALID" };
  }
  if (coupon.usage_limit != null && coupon.used_count >= coupon.usage_limit) {
    return { ok: false, reason: "COUPON_EXHAUSTED" };
  }
  if (subtotalPaisa < (coupon.min_order_paisa ?? 0)) {
    return { ok: false, reason: "COUPON_MIN_ORDER" };
  }
  const result = await db.prepare(
    `UPDATE coupons SET used_count = used_count + 1
     WHERE code = ?1 AND (usage_limit IS NULL OR used_count < usage_limit)`
  ).bind(code).run();
  if (result.meta.changes !== 1) return { ok: false, reason: "COUPON_RACE_LOST" };
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
async function releaseCouponUsageAtomic(db, idempotencyKey, claim) {
  if (!idempotencyKey || !claim?.claimToken) return false;
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
async function recordCouponClaim(db, idempotencyKey, claim) {
  if (!idempotencyKey || !claim?.claimToken) return;
  await db.prepare(
    `INSERT OR IGNORE INTO checkout_idempotency_coupon_claims (idempotency_key, claim_token, code, created_at)
     VALUES (?1, ?2, ?3, ?4)`
  ).bind(idempotencyKey, claim.claimToken, claim.code, (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 19)).run();
}
export {
  assertPaisa as a,
  applyCouponAtomic as b,
  releaseCouponUsageAtomic as c,
  addPaisa as d,
  formatPaisa as f,
  multiplyPaisa as m,
  recordCouponClaim as r
};
