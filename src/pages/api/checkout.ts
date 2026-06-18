/**
 * POST /api/checkout — Guest Checkout [Master Plan §6.1]
 *
 * Server-authoritative pricing: client money fields are NEVER trusted.
 * Stock reservations serialize through VariantInventoryDO (G7).
 * Idempotency claims via IdempotencyDO before cart mutations (G4).
 */
export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../lib/env';
import { normalizeBangladeshPhone } from '../../lib/phone';
import { releaseReservedVariants, reserveVariants } from '../../lib/inventory';
import { insertReservedOrderWithRetry } from '../../lib/orders';
import { nowSql } from '../../lib/dates';
import { checkIdempotency, claimIdempotency, completeIdempotency, failIdempotency, recordOrderInProgress } from '../../lib/idempotency';
import { doClaim, doComplete, doFail, doPeek } from '../../lib/do-client';
import { assertPaisa, applyCouponAtomic, releaseCouponUsageAtomic, recordCouponClaim, type CouponClaim } from '../../lib/money';
import {
  assertNoClientMoneyTrust,
  loadVariantSnapshots,
  calculateAuthoritativeSubtotal,
  calculateDeliveryPaisa,
  parseCheckoutCart,
  type CheckoutCartItem,
} from '../../lib/checkout-pricing';
import { checkFraudBD, decideFraudRisk } from '../../lib/fraud';
import { calculatePrepayment, PREPAYMENT_MESSAGE } from '../../lib/prepayment';
import { verifyTurnstile } from '../../lib/turnstile';
import { clientIp } from '../../lib/audit';
import { safeLog } from '../../lib/pii-scrubber';
import { enqueueOrderEmail } from '../../queues/consumers';

const RETRY_AFTER_SECONDS = '5';

function replayResponse(responseBody: string): Response {
  try {
    return Response.json(JSON.parse(responseBody), { status: 200 });
  } catch {
    return Response.json({ ok: false, code: 'DUPLICATE_CHECKOUT', message: 'Duplicate request.' }, { status: 409 });
  }
}

function processingResponse(): Response {
  return Response.json(
    { ok: false, code: 'CHECKOUT_PROCESSING', message: 'Request is already processing.' },
    { status: 202, headers: { 'Retry-After': RETRY_AFTER_SECONDS } },
  );
}

async function releaseClaim(env: ReturnType<typeof getEnv>, idempotencyKey: string): Promise<void> {
  await failIdempotency(env.DB, idempotencyKey);
  await doFail(env, idempotencyKey);
}

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let body: Record<string, unknown>;
  let stockReserved = false;
  let couponClaimed = false;
  let couponClaim: CouponClaim | null = null;
  let items: CheckoutCartItem[] = [];
  let idempotencyKey: string | null = null;
  let claimHeld = false;

  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  assertNoClientMoneyTrust(body ?? {}, env, {
    ip: clientIp(context.request),
    now,
  });

  // Master Plan §6.1 step 4: Load cart from CartDO when session_id is provided.
  // Falls back to client body cart for backward compatibility during migration.
  const sessionId = typeof body.session_id === 'string' ? body.session_id : null;
  if (sessionId && env.CART_DO) {
    const cartId = env.CART_DO.idFromName(sessionId);
    const cartStub = env.CART_DO.get(cartId);
    const cartRes = await cartStub.fetch('https://do/get', { method: 'POST', body: '{}' });
    const cartData = (await cartRes.json().catch(() => null)) as { ok?: boolean; cart?: { items?: Array<{ variantId: string; quantity: number }> } } | null;
    if (cartData?.ok && cartData.cart?.items && cartData.cart.items.length > 0) {
      // Override body.cart with CartDO data — CartDO is the source of truth
      body.cart = cartData.cart.items.map((item) => ({
        variant_id: item.variantId,
        quantity: item.quantity,
      }));
    }
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const token = typeof body.turnstile === 'string' ? body.turnstile : context.request.headers.get('CF-Turnstile-Token');
    if (token) {
      const r = await verifyTurnstile(env, token, clientIp(context.request) ?? undefined);
      if (!r.ok) {
        return Response.json({ ok: false, code: 'TURNSTILE_FAILED', message: 'Bot check failed.' }, { status: 403 });
      }
    }
  }

  // Master Plan §6.1 step 1: validate idempotency key and peek for replay/processing.
  const headerKey = context.request.headers.get('Idempotency-Key');
  const bodyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : null;
  idempotencyKey = (headerKey || bodyKey)?.trim() || null;
  if (!idempotencyKey) {
    return Response.json({ ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Please try again.' }, { status: 400 });
  }

  const peek = await doPeek(env, idempotencyKey);
  if (peek.replay && peek.responseBody) {
    return replayResponse(peek.responseBody);
  }
  if (peek.code === 'PROCESSING') {
    return processingResponse();
  }

  const existing = await checkIdempotency(env.DB, idempotencyKey);
  if (existing.exists) {
    if (existing.status === 'complete' && existing.responseBody) {
      return replayResponse(existing.responseBody);
    }
    if (existing.status === 'processing' && existing.orderId) {
      const order = await env.DB.prepare(
        `SELECT id AS order_id, order_number, status, advance_paisa, balance_paisa
         FROM orders WHERE id = ?1`,
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
          recovered: true,
        }, { status: 200 });
      }
    }
    if (existing.status === 'processing') {
      return processingResponse();
    }
  }

  const cust = (body.customer && typeof body.customer === 'object') ? body.customer as Record<string, unknown> : {};
  const nameInput = (cust.name ?? body.name ?? '').toString().trim();
  const phoneInput = (cust.phone ?? body.phone ?? '').toString();
  const addressInput = (cust.address ?? body.address ?? '').toString().trim();

  const phoneResult = normalizeBangladeshPhone(phoneInput);
  if (!phoneResult.ok) {
    return Response.json({ ok: false, code: 'INVALID_PHONE', message: 'Use a valid Bangladeshi mobile number.' }, { status: 400 });
  }

  const parsed = parseCheckoutCart(body);
  if ('error' in parsed) {
    const status = parsed.code === 'EMPTY_CART' || parsed.code === 'CART_TOO_LARGE' || parsed.code === 'INVALID_CART' || parsed.code === 'INVALID_QUANTITY'
      ? 400
      : 400;
    return Response.json({ ok: false, code: parsed.code, message: parsed.error }, { status });
  }

  items = parsed.items;
  let paymentMethod = parsed.paymentMethod;

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
        message: 'One item is no longer available. Your cart has been updated.',
      }, { status: 409 });
    }
    subtotalPaisa = calculateAuthoritativeSubtotal(items, snapshots);
    deliveryPaisa = await calculateDeliveryPaisa(env.DB, parsed.shippingZone, subtotalPaisa);
  } catch (err) {
    const code = err instanceof Error ? err.message : 'PRICING_ERROR';
    if (code.startsWith('INVALID_CART_SIZE')) {
      return Response.json({ ok: false, code: 'INVALID_CART', message: 'Cart is invalid.' }, { status: 400 });
    }
    safeLog.error('[checkout] Pricing error', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ ok: false, code: 'PRICING_ERROR', message: 'Could not price your cart. Please try again.' }, { status: 409 });
  }

  // Master Plan §6.1 step 6: atomic idempotency claim before mutations.
  const doClaimRes = await doClaim(env, idempotencyKey);
  if (doClaimRes.replay && doClaimRes.responseBody) {
    return replayResponse(doClaimRes.responseBody);
  }
  if (!doClaimRes.ok || !doClaimRes.claimed) {
    return processingResponse();
  }
  claimHeld = true;

  await claimIdempotency(env.DB, idempotencyKey, now);

  try {
    if (parsed.couponCode) {
      const couponResult = await applyCouponAtomic(env.DB, parsed.couponCode, subtotalPaisa, now);
      if (!couponResult.ok) {
        await releaseClaim(env, idempotencyKey);
        claimHeld = false;
        return Response.json({ ok: false, code: couponResult.reason, message: 'Coupon could not be applied.' }, { status: 409 });
      }
      discountPaisa = assertPaisa(couponResult.discountPaisa, 'discount_paisa');
      couponClaim = couponResult.claim;
      await recordCouponClaim(env.DB, idempotencyKey, couponClaim);
      couponClaimed = true;
    }

    totalPaisa = assertPaisa(Math.max(0, subtotalPaisa + deliveryPaisa - discountPaisa), 'total_paisa');

    const prepayment = calculatePrepayment(items.length, totalPaisa, paymentMethod);
    if (prepayment.required && paymentMethod === 'cod') {
      if (couponClaimed && couponClaim) {
        await releaseCouponUsageAtomic(env.DB, idempotencyKey, couponClaim);
        couponClaimed = false;
      }
      await releaseClaim(env, idempotencyKey);
      claimHeld = false;
      return Response.json({
        ok: false,
        code: 'PREPAYMENT_REQUIRED',
        message: PREPAYMENT_MESSAGE,
        advance_paisa: prepayment.advancePaisa,
        balance_paisa: prepayment.balancePaisa,
        payment_method_required: 'partial_prepay',
      }, { status: 402 });
    }

    let advancePaisa = 0;
    let balancePaisa = totalPaisa;
    if (paymentMethod === 'uddoktapay') {
      advancePaisa = totalPaisa;
      balancePaisa = 0;
    } else if (paymentMethod === 'partial_prepay') {
      const split = calculatePrepayment(items.length, totalPaisa, paymentMethod);
      advancePaisa = split.advancePaisa;
      balancePaisa = split.balancePaisa;
    }

    const { score } = await checkFraudBD(phoneResult.local, env.FRAUDBD_API_KEY, 1500, 'https://fraudbd.com', env);
    const fraudDecision = decideFraudRisk(score);

    if (fraudDecision === 'blocked') {
      if (couponClaimed && couponClaim) {
        await releaseCouponUsageAtomic(env.DB, idempotencyKey, couponClaim);
        couponClaimed = false;
      }
      await releaseClaim(env, idempotencyKey);
      claimHeld = false;
      return Response.json({
        ok: false, code: 'FRAUD_BLOCKED',
        message: 'This order has been flagged. Please contact customer support.',
      }, { status: 403 });
    }

    const reserveResult = await reserveVariants(env, items, now);
    if (!reserveResult.ok) {
      if (couponClaimed && couponClaim) {
        await releaseCouponUsageAtomic(env.DB, idempotencyKey, couponClaim);
        couponClaimed = false;
      }
      await releaseClaim(env, idempotencyKey);
      claimHeld = false;
      const failedIndex = items.findIndex(i => i.variantId === reserveResult.failedVariantId);
      return Response.json({
        ok: false,
        code: 'OUT_OF_STOCK',
        message: 'One item just went out of stock. Your cart has been updated.',
        failed_cart_index: failedIndex >= 0 ? failedIndex : -1,
        available_quantity: 0,
      }, { status: 409 });
    }
    stockReserved = true;

    const orderItems = items.map((item) => ({
      variantId: item.variantId,
      quantity: item.qty,
      unitPricePaisa: snapshots.get(item.variantId)!.price_paisa,
    }));

    const { orderId, orderNumber } = await insertReservedOrderWithRetry(env.DB, {
      phone: phoneResult.phone,
      name: nameInput,
      address: addressInput,
      shipping_zone: parsed.shippingZone,
      note: parsed.note,
      subtotal_paisa: subtotalPaisa,
      delivery_paisa: deliveryPaisa,
      discount_paisa: discountPaisa,
      total_paisa: totalPaisa,
      payment_method: paymentMethod,
      fraud_decision: fraudDecision,
    }, orderItems, now);

    await recordOrderInProgress(env.DB, idempotencyKey, orderId);

    await env.DB.prepare(
      `UPDATE orders SET advance_paisa = ?2, balance_paisa = ?3, updated_at = ?4 WHERE id = ?1`,
    ).bind(orderId, advancePaisa, balancePaisa, now).run();

    const response = {
      ok: true,
      order_id: orderId,
      order_number: orderNumber,
      status: 'created',
      advance_paisa: advancePaisa,
      balance_paisa: balancePaisa,
      payment_method: paymentMethod,
    };
    await completeIdempotency(env.DB, idempotencyKey, orderId, JSON.stringify(response));
    await doComplete(env, idempotencyKey, orderId, JSON.stringify(response));
    claimHeld = false;

    // Enqueue order confirmation email [Master_Prompt v7.0 §17.2]
    await enqueueOrderEmail(env, orderId, 'order_confirmed').catch(() => {});

    return Response.json(response, { status: 201 });
  } catch (err) {
    if (couponClaimed && couponClaim) {
      await releaseCouponUsageAtomic(env.DB, idempotencyKey, couponClaim);
      couponClaimed = false;
    }
    if (stockReserved) {
      await releaseReservedVariants(env, items, now);
    }
    if (claimHeld) {
      await releaseClaim(env, idempotencyKey);
    }
    safeLog.error('[checkout] Error', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ ok: false, code: 'CHECKOUT_FAILED', message: 'Internal checkout error.' }, { status: 500 });
  }
}