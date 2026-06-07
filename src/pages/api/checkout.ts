/**
 * POST /api/checkout — Guest Checkout [v6.8B Security Patch]
 *
 * Server-authoritative pricing: client money fields (unit_price_paisa,
 * subtotal_paisa, discount_paisa, delivery_paisa, total_paisa) are NEVER
 * trusted. All prices come from D1 (source of truth).
 *
 * Flow: validate → normalize phone → assertNoClientMoneyTrust → load D1
 * snapshots → authoritative subtotal → server delivery → atomic coupon →
 * server total → FraudBD → reserveVariants() → create order (server values).
 */
export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../lib/env';
import { normalizeBangladeshPhone } from '../../lib/phone';
import { releaseReservedVariants, reserveVariants } from '../../lib/inventory';
import { insertReservedOrderWithRetry } from '../../lib/orders';
import { nowSql } from '../../lib/dates';
import { checkIdempotency, claimIdempotency, completeIdempotency, failIdempotency } from '../../lib/idempotency';
import { assertPaisa, applyCouponAtomic } from '../../lib/money';
import {
  assertNoClientMoneyTrust,
  loadVariantSnapshots,
  calculateAuthoritativeSubtotal,
  calculateDeliveryPaisa,
  type CheckoutCartItem
} from '../../lib/checkout-pricing';
import { checkFraudBD, decideFraudRisk } from '../../lib/fraud';
import { calculatePrepayment } from '../../lib/prepayment';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let body: any;
  let stockReserved = false;
  let items: CheckoutCartItem[] = [];

  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Client money fields are display-only; warn but never trust them.
  assertNoClientMoneyTrust(body ?? {});

  // 1. Validate idempotency key
  const idempotencyKey = context.request.headers.get('Idempotency-Key') || body.idempotency_key;
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return Response.json({ ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Please try again.' }, { status: 400 });
  }

  const existing = await checkIdempotency(env.DB, idempotencyKey);
  if (existing.exists) {
    if (existing.status === 'complete') {
      return Response.json(JSON.parse(existing.responseBody ?? '{}'), { status: 200 });
    }
    return Response.json({ ok: false, code: 'CHECKOUT_PROCESSING', message: 'Request is already processing.' }, { status: 409 });
  }

  // 2. Normalize phone
  const phoneResult = normalizeBangladeshPhone(body.phone ?? '');
  if (!phoneResult.ok) {
    return Response.json({ ok: false, code: 'INVALID_PHONE', message: 'Use a valid Bangladeshi mobile number.' }, { status: 400 });
  }

  // 3. Parse cart — variant id + quantity ONLY. Client prices are ignored.
  const rawItems: Array<{ variant_id?: string; variantId?: string; quantity?: number; qty?: number }> = body.items ?? [];
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return Response.json({ ok: false, code: 'EMPTY_CART', message: 'Cart is empty.' }, { status: 400 });
  }
  if (rawItems.length > 10) {
    return Response.json({ ok: false, code: 'CART_TOO_LARGE', message: 'Please place a smaller order.' }, { status: 400 });
  }

  items = rawItems.map((item) => ({
    variantId: item.variant_id ?? item.variantId ?? '',
    qty: item.quantity ?? item.qty ?? 0
  }));

  if (items.some((item) => !item.variantId)) {
    return Response.json({ ok: false, code: 'INVALID_CART', message: 'Cart contains an invalid item.' }, { status: 400 });
  }
  if (items.some((item) => !Number.isSafeInteger(item.qty) || item.qty < 1)) {
    return Response.json({ ok: false, code: 'INVALID_QUANTITY', message: 'Each item needs a valid quantity.' }, { status: 400 });
  }

  // 4. Load authoritative variant snapshots from D1 and compute pricing.
  let subtotalPaisa: number;
  let deliveryPaisa: number;
  let discountPaisa = 0;
  let totalPaisa: number;
  let snapshots: Awaited<ReturnType<typeof loadVariantSnapshots>>;

  try {
    snapshots = await loadVariantSnapshots(env.DB, items);

    const uniqueVariantIds = new Set(items.map((item) => item.variantId));
    if (snapshots.size !== uniqueVariantIds.size) {
      return Response.json({
        ok: false,
        code: 'VARIANT_UNAVAILABLE',
        message: 'One item is no longer available. Your cart has been updated.'
      }, { status: 409 });
    }

    subtotalPaisa = calculateAuthoritativeSubtotal(items, snapshots);
    deliveryPaisa = await calculateDeliveryPaisa(env.DB, body.shipping_zone, subtotalPaisa);
  } catch (err) {
    const code = err instanceof Error ? err.message : 'PRICING_ERROR';
    if (code.startsWith('INVALID_CART_SIZE')) {
      return Response.json({ ok: false, code: 'INVALID_CART', message: 'Cart is invalid.' }, { status: 400 });
    }
    console.error('[checkout] Pricing error:', err);
    return Response.json({ ok: false, code: 'PRICING_ERROR', message: 'Could not price your cart. Please try again.' }, { status: 409 });
  }

  // Claim idempotency only after the request is well-formed and priced.
  const claimed = await claimIdempotency(env.DB, idempotencyKey, now);
  if (!claimed) {
    return Response.json({ ok: false, code: 'DUPLICATE_CHECKOUT', message: 'Duplicate request.' }, { status: 409 });
  }

  try {
    // 5. Apply coupon atomically (only authoritative source of discount).
    const couponCode = typeof body.coupon_code === 'string' ? body.coupon_code.trim() : '';
    if (couponCode) {
      const couponResult = await applyCouponAtomic(env.DB, couponCode, subtotalPaisa, now);
      if (!couponResult.ok) {
        await failIdempotency(env.DB, idempotencyKey);
        return Response.json({ ok: false, code: couponResult.reason, message: 'Coupon could not be applied.' }, { status: 409 });
      }
      discountPaisa = assertPaisa(couponResult.discountPaisa, 'discount_paisa');
    }

    // 6. Server-computed total. discount never exceeds subtotal + delivery.
    totalPaisa = assertPaisa(Math.max(0, subtotalPaisa + deliveryPaisa - discountPaisa), 'total_paisa');

    // 6b. Prepayment rule: >2 distinct items with COD requires 50% advance.
    const paymentMethod = body.payment_method ?? 'cod';
    const prepayment = calculatePrepayment(items.length, totalPaisa, paymentMethod);

    // If prepayment is required, reject pure COD — client must use 'partial_prepay'
    if (prepayment.required && paymentMethod === 'cod') {
      await failIdempotency(env.DB, idempotencyKey);
      return Response.json({
        ok: false,
        code: 'PREPAYMENT_REQUIRED',
        message: prepayment.message,
        advance_paisa: prepayment.advancePaisa,
        balance_paisa: prepayment.balancePaisa
      }, { status: 402 });
    }

    // 7. FraudBD check (Check Courier Info API expects local 01XXXXXXXXX format)
    const { score } = await checkFraudBD(phoneResult.local, env.FRAUDBD_API_KEY);
    const fraudDecision = decideFraudRisk(score);

    if (fraudDecision === 'blocked') {
      await failIdempotency(env.DB, idempotencyKey);
      return Response.json({
        ok: false, code: 'FRAUD_BLOCKED',
        message: 'This order has been flagged. Please contact customer support.'
      }, { status: 403 });
    }

    // 8. Reserve stock (only inventory reservation path).
    const reserveResult = await reserveVariants(env.DB, items, now);
    if (!reserveResult.ok) {
      await failIdempotency(env.DB, idempotencyKey);
      return Response.json({
        ok: false,
        code: 'OUT_OF_STOCK',
        message: 'One item just went out of stock. Your cart has been updated.',
        failed_variant_id: reserveResult.failedVariantId,
        available_quantity: 0
      }, { status: 409 });
    }
    stockReserved = true;

    // 9. Create order — server values only. order_items store D1 price snapshot.
    const orderItems = items.map((item) => ({
      variantId: item.variantId,
      quantity: item.qty,
      unitPricePaisa: snapshots.get(item.variantId)!.price_paisa
    }));

    const { orderId, orderNumber } = await insertReservedOrderWithRetry(env.DB, {
      phone: phoneResult.phone,
      name: body.name,
      address: body.address,
      shipping_zone: body.shipping_zone,
      note: body.note,
      subtotal_paisa: subtotalPaisa,
      delivery_paisa: deliveryPaisa,
      discount_paisa: discountPaisa,
      total_paisa: totalPaisa,
      payment_method: body.payment_method ?? 'cod',
      fraud_decision: fraudDecision
    }, orderItems, now);

    const response = { ok: true, order_id: orderId, order_number: orderNumber, status: 'created' };
    await completeIdempotency(env.DB, idempotencyKey, orderId, JSON.stringify(response));

    return Response.json(response, { status: 201 });
  } catch (err) {
    if (stockReserved) {
      await releaseReservedVariants(env.DB, items, now);
    }
    await failIdempotency(env.DB, idempotencyKey);
    console.error('[checkout] Error:', err);
    return Response.json({ ok: false, code: 'CHECKOUT_FAILED', message: 'Internal checkout error.' }, { status: 500 });
  }
}
