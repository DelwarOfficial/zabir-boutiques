import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { calculateCouponDiscount, type DiscountType } from '../../../lib/money';
import { checkCouponRateLimit, recordCouponFailure, clearCouponFailures } from '../../../lib/coupon-rate-limit';
import { clientIp } from '../../../lib/audit';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const body = (await context.request.json().catch(() => ({}))) as {
    code?: string;
    subtotalPaisa?: number;
  };

  const { code, subtotalPaisa } = body;
  if (!code || typeof subtotalPaisa !== 'number') {
    return Response.json({ ok: false, code: 'INVALID_REQUEST', message: 'Missing coupon code or subtotal.' }, { status: 400 });
  }

  // K-10/N-22: this preview endpoint had zero rate limiting, letting a
  // client brute-force enumerate valid coupon codes at unlimited speed.
  // coupon-rate-limit.ts already existed for exactly this (5/min, 30-min
  // lockout after 5 failures) but had no callers. Rate-limit key is the
  // guest cart session cookie when present, otherwise client IP — either
  // way it's per-client, not global.
  const raw = context.request.headers.get('cookie') ?? '';
  const cartSidMatch = raw.match(/(?:^|;\s*)zb_cart_sid=([^;]*)/);
  const rateLimitKey = cartSidMatch ? decodeURIComponent(cartSidMatch[1]) : `ip:${clientIp(context.request) ?? 'unknown'}`;

  const rateLimit = await checkCouponRateLimit(env.DB, rateLimitKey);
  if (!rateLimit.allowed) {
    return Response.json(
      { ok: false, code: 'RATE_LIMITED', message: 'Too many coupon attempts. Please try again later.' },
      { status: 429 },
    );
  }

  // Format UTC now text matching D1 text dates: YYYY-MM-DD HH:MM:SS
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  try {
    const coupon = await env.DB.prepare(
      `SELECT id, discount_type, discount_amount_paisa, discount_percent,
              max_discount_paisa, min_order_paisa, usage_limit, used_count,
              starts_at, expires_at, is_active
       FROM coupons WHERE code = ?1`
    ).bind(code).first<any>();

    if (!coupon) {
      await recordCouponFailure(env.DB, rateLimitKey, 'COUPON_NOT_FOUND');
      return Response.json({ ok: false, code: 'COUPON_NOT_FOUND', message: 'Coupon code is invalid.' }, { status: 404 });
    }
    if (!coupon.is_active) {
      return Response.json({ ok: false, code: 'COUPON_INACTIVE', message: 'This coupon is inactive.' }, { status: 400 });
    }
    if (coupon.expires_at && coupon.expires_at < now) {
      return Response.json({ ok: false, code: 'COUPON_EXPIRED', message: 'This coupon has expired.' }, { status: 400 });
    }
    if (coupon.starts_at && coupon.starts_at > now) {
      return Response.json({ ok: false, code: 'COUPON_NOT_YET_VALID', message: 'This coupon is not yet active.' }, { status: 400 });
    }
    if (coupon.usage_limit != null && coupon.used_count >= coupon.usage_limit) {
      return Response.json({ ok: false, code: 'COUPON_EXHAUSTED', message: 'This coupon has been fully used.' }, { status: 400 });
    }
    if (subtotalPaisa < (coupon.min_order_paisa ?? 0)) {
      return Response.json({ ok: false, code: 'COUPON_MIN_ORDER', message: `Minimum order of ৳${Math.floor((coupon.min_order_paisa ?? 0) / 100)} is required.` }, { status: 400 });
    }

    const discountPaisa = calculateCouponDiscount(
      subtotalPaisa,
      coupon.discount_type as DiscountType,
      coupon.discount_amount_paisa,
      coupon.discount_percent,
      coupon.max_discount_paisa
    );

    await clearCouponFailures(env.DB, rateLimitKey);
    return Response.json({
      ok: true,
      code,
      discountPaisa,
      discountType: coupon.discount_type,
      discountAmountPaisa: coupon.discount_amount_paisa,
      discountPercent: coupon.discount_percent,
    });
  } catch (err) {
    return Response.json({ ok: false, code: 'DATABASE_ERROR', message: 'Internal server error while verifying coupon.' }, { status: 500 });
  }
}
