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
import { checkIdempotency, claimIdempotency, completeIdempotency, failIdempotency, recordOrderInProgress } from '../../lib/idempotency';
import { assertPaisa, applyCouponAtomic, releaseCouponUsageAtomic, recordCouponClaim, type CouponClaim } from '../../lib/money';
import {
  assertNoClientMoneyTrust,
  loadVariantSnapshots,
  calculateAuthoritativeSubtotal,
  calculateDeliveryPaisa,
  type CheckoutCartItem
} from '../../lib/checkout-pricing';
import { checkFraudBD, decideFraudRisk } from '../../lib/fraud';
import { calculatePrepayment } from '../../lib/prepayment';
import { verifyTurnstile } from '../../lib/turnstile';
import { clientIp } from '../../lib/audit';
import { safeLog } from '../../lib/pii-scrubber';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let body: any;
  let stockReserved = false;
  let couponClaimed = false;
  let couponClaim: CouponClaim | null = null;
  let items: CheckoutCartItem[] = [];

  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Client money fields are display-only; warn but never trust them.
  assertNoClientMoneyTrust(body ?? {}, env, {
    ip: clientIp(context.request),
    now,
  });

  // 0. Turnstile bot protection (Master_Prompt v7.0 §9.3)
  if (env.TURNSTILE_SECRET_KEY) {
    const token = typeof body.turnstile === "string" ? body.turnstile : context.request.headers.get("CF-Turnstile-Token");
    if (token) {
      const r = await verifyTurnstile(env, token, clientIp(context.request) ?? undefined);
      if (!r.ok) {
        return Response.json({ ok: false, code: "TURNSTILE_FAILED", message: "Bot check failed." }, { status: 403 });
      }
    }
  }

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
    if (existing.status === 'processing' && existing.orderId) {
      // Worker crash recovery: the order was created in a previous invocation.
      // Re-fetch its public-facing fields so the client can proceed without a
      // duplicate order. Inventory has already been reserved.
      const order = await env.DB.prepare(
        `SELECT id AS order_id, order_number, status, advance_paisa, balance_paisa
         FROM orders WHERE id = ?1`
      ).bind(existing.orderId).first<{
        order_id: string; order_number: string; status: string;
        advance_paisa: number; balance_paisa: number;
      }>();
      if (order) {
        return Response.json({
          ok: true,
          order_id: order.order_id,
          order_number: order.order_number,
          status: order.status,
          advance_paisa: order.advance_paisa,
          balance_paisa: order.balance_paisa,
          recovered: true
        }, { status: 200 });
      }
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
    safeLog.error('[checkout] Pricing error', { error: err instanceof Error ? err.message : String(err) });
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
      couponClaim = couponResult.claim;
      // Persist the claim token so the release path is idempotent across retries.
      await recordCouponClaim(env.DB, idempotencyKey, couponClaim);
      couponClaimed = true;
    }

    // 6. Server-computed total. discount never exceeds subtotal + delivery.
    totalPaisa = assertPaisa(Math.max(0, subtotalPaisa + deliveryPaisa - discountPaisa), 'total_paisa');

    // 6b. Prepayment rule: >2 distinct items with COD requires 50% advance.
    // The business rule is server-enforced: if a client submits `cod` for
    // a >2-item cart, the server silently upgrades to `partial_prepay` so
    // the order can be placed. A 402 was a UX trap that forced the client
    // to retry; the server already has all the data it needs to do the
    // upgrade.
    let paymentMethod = (body.payment_method ?? 'cod') as 'cod' | 'uddoktapay' | 'partial_prepay' | 'in_store';
    let prepayment = calculatePrepayment(items.length, totalPaisa, paymentMethod);
    if (prepayment.required && paymentMethod === 'cod') {
      paymentMethod = 'partial_prepay';
      prepayment = calculatePrepayment(items.length, totalPaisa, paymentMethod);
    }

    // Determine advance/balance tracking values
    let advancePaisa = 0;
    let balancePaisa = totalPaisa;
    if (paymentMethod === 'uddoktapay') {
      advancePaisa = totalPaisa;
      balancePaisa = 0;
    } else if (paymentMethod === 'partial_prepay') {
      advancePaisa = prepayment.advancePaisa;
      balancePaisa = prepayment.balancePaisa;
    }

    // 7. FraudBD check (Check Courier Info API expects local 01XXXXXXXXX format)
    const { score } = await checkFraudBD(phoneResult.local, env.FRAUDBD_API_KEY);
    const fraudDecision = decideFraudRisk(score);

    if (fraudDecision === 'blocked') {
      if (couponClaimed && couponClaim) {
        await releaseCouponUsageAtomic(env.DB, idempotencyKey, couponClaim);
        couponClaimed = false;
      }
      await failIdempotency(env.DB, idempotencyKey);
      return Response.json({
        ok: false, code: 'FRAUD_BLOCKED',
        message: 'This order has been flagged. Please contact customer support.'
      }, { status: 403 });
    }

    // 8. Reserve stock (only inventory reservation path).
    const reserveResult = await reserveVariants(env as unknown as Parameters<typeof reserveVariants>[0], items, now);
    if (!reserveResult.ok) {
      if (couponClaimed && couponClaim) {
        await releaseCouponUsageAtomic(env.DB, idempotencyKey, couponClaim);
        couponClaimed = false;
      }
      await failIdempotency(env.DB, idempotencyKey);
      // Use a cart index rather than echoing the raw variant_id back to the
      // client (defense against variant-id enumeration probing).
      const failedIndex = items.findIndex(i => i.variantId === reserveResult.failedVariantId);
      return Response.json({
        ok: false,
        code: 'OUT_OF_STOCK',
        message: 'One item just went out of stock. Your cart has been updated.',
        failed_cart_index: failedIndex >= 0 ? failedIndex : -1,
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
      payment_method: paymentMethod,
      fraud_decision: fraudDecision
    }, orderItems, now);

    // Persist order_id into the processing idempotency row immediately so a
    // crash between this point and the 200 response can still be recovered
    // by the next retry.
    await recordOrderInProgress(env.DB, idempotencyKey, orderId);

    // Store advance/balance tracking
    await env.DB.prepare(
      `UPDATE orders SET advance_paisa = ?2, balance_paisa = ?3, updated_at = ?4 WHERE id = ?1`
    ).bind(orderId, advancePaisa, balancePaisa, now).run();

    const response = {
      ok: true, order_id: orderId, order_number: orderNumber, status: 'created',
      advance_paisa: advancePaisa, balance_paisa: balancePaisa
    };
    await completeIdempotency(env.DB, idempotencyKey, orderId, JSON.stringify(response));

    return Response.json(response, { status: 201 });
  } catch (err) {
    if (couponClaimed && couponClaim) {
      await releaseCouponUsageAtomic(env.DB, idempotencyKey, couponClaim);
      couponClaimed = false;
    }
    if (stockReserved) {
      await releaseReservedVariants(env as unknown as Parameters<typeof releaseReservedVariants>[0], items, now);
    }
    await failIdempotency(env.DB, idempotencyKey);
    safeLog.error('[checkout] Error', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ ok: false, code: 'CHECKOUT_FAILED', message: 'Internal checkout error.' }, { status: 500 });
  }
}
