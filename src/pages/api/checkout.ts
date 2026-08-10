/**
 * POST /api/checkout — Guest Checkout [Master Plan §6.1]
 *
 * Server-authoritative pricing: client money fields are NEVER trusted.
 * Stock reservations serialize through VariantInventoryDO (G7).
 * Idempotency claims via IdempotencyDO before cart mutations (G4).
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../lib/env';
import { normalizeBangladeshPhone } from '../../lib/phone';
import { releaseReservedVariants, reserveVariants } from '../../lib/inventory';
import { insertReservedOrderWithRetry } from '../../lib/orders';
import { nowSql } from '../../lib/dates';
import { checkIdempotency, claimIdempotency, completeIdempotency, failIdempotency, recordOrderInProgress } from '../../lib/idempotency';
import { doClaim, doComplete, doFail, doPeek, resolveCartStub } from '../../lib/do-client';
import { assertPaisa, applyCouponAtomic, releaseCouponUsageAtomic, recordCouponClaim, type CouponClaim } from '../../lib/money';
import { getVatRatePercent, calculateVatPaisa as calculateVatPaisaCanonical, allocateVatByLargestRemainder } from '../../lib/vat';
import {
  assertNoClientMoneyTrust,
  loadVariantSnapshots,
  calculateAuthoritativeSubtotal,
  calculateDeliveryPaisa,
  parseCheckoutCart,
  resolveShippingZone,
  type CheckoutCartItem,
} from '../../lib/checkout-pricing';
import { checkFraudBD, decideFraudRisk } from '../../lib/fraud';
import { calculatePrepayment, PREPAYMENT_MESSAGE } from '../../lib/prepayment';
import { checkCodLimits, COD_LIMIT_MESSAGES } from '../../lib/cod-limits';
import { verifyTurnstile } from '../../lib/turnstile';
import { clientIp } from '../../lib/audit';
import { createPaymentCheckout } from '../../lib/integrations/payments';
import { safeLog } from '../../lib/pii-scrubber';
import { enqueueFraudAudit, enqueueOrderEmail } from '../../queues/consumers';

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

async function releaseClaim(env: ReturnType<typeof getEnv>, scope: string, idempotencyKey: string): Promise<void> {
  await failIdempotency(env.DB, idempotencyKey);
  await doFail(env, scope, idempotencyKey);
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

  // Master Plan §6.1 step 4: Load cart from CartDO (source of truth).
  // Guest checkout must have a CartDO session; Buy Now uses DirectCheckoutSessionDO instead.
  // K-18: session identity comes only from the cookie, never the request
  // body — a client-supplied session_id let a caller submit checkout
  // against a different cart session than the one the cookie ties them to
  // (same principle already applied to buy-now/submit.ts).
  let sessionId: string | null = null;
  {
    const raw = context.request.headers.get('cookie') ?? '';
    const match = raw.match(/(?:^|;\s*)zb_cart_sid=([^;]*)/);
    if (match) sessionId = decodeURIComponent(match[1]);
  }
  if (!sessionId || !env.CART_DO) {
    return Response.json({ ok: false, code: 'MISSING_CART_SESSION', message: 'Cart session is required. Please add items to your cart and try again.' }, { status: 400 });
  }
  const cartStub = await resolveCartStub(env.CART_DO, sessionId);
  const cartRes = await cartStub.fetch('https://do/get', { method: 'POST', body: '{}' });
  const cartData = (await cartRes.json().catch(() => null)) as { ok?: boolean; cart?: { items?: Array<{ variantId: string; quantity: number }> } } | null;
  if (!cartData?.ok || !cartData.cart?.items || cartData.cart.items.length === 0) {
    return Response.json({ ok: false, code: 'EMPTY_CART', message: 'Your cart is empty.' }, { status: 400 });
  }
  body.cart = cartData.cart.items.map((item) => ({
    variant_id: item.variantId,
    quantity: item.quantity,
  }));

  if (env.TURNSTILE_SECRET_KEY) {
    const token = typeof body.turnstile === 'string' ? body.turnstile : context.request.headers.get('CF-Turnstile-Token');
    if (!token) {
      return Response.json({ ok: false, code: 'TURNSTILE_REQUIRED', message: 'Bot check required.' }, { status: 403 });
    }
    const r = await verifyTurnstile(env, token, clientIp(context.request) ?? undefined);
    if (!r.ok) {
      return Response.json({ ok: false, code: 'TURNSTILE_FAILED', message: 'Bot check failed.' }, { status: 403 });
    }
  }

  // Master Plan §6.1 step 1: validate idempotency key and peek for replay/processing.
  const headerKey = context.request.headers.get('Idempotency-Key');
  const bodyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : null;
  idempotencyKey = (headerKey || bodyKey)?.trim() || null;
  if (!idempotencyKey) {
    return Response.json({ ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Please try again.' }, { status: 400 });
  }

  const peek = await doPeek(env, sessionId, idempotencyKey);
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
  let vatPaisa = 0;
  let totalPaisa: number;
  let advancePaisa = 0;
  let balancePaisa = 0;
  let snapshots: Awaited<ReturnType<typeof loadVariantSnapshots>>;
  let resolvedShippingZone: 'inside_dhaka' | 'outside_dhaka' = 'outside_dhaka';
  let createdOrderId: string | null = null;
  let createdOrderNumber: string | null = null;
  let orderPersisted = false;

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
    resolvedShippingZone = resolveShippingZone(addressInput, parsed.shippingZone);
    deliveryPaisa = await calculateDeliveryPaisa(env.DB, resolvedShippingZone, subtotalPaisa);
  } catch (err) {
    const code = err instanceof Error ? err.message : 'PRICING_ERROR';
    if (code.startsWith('INVALID_CART_SIZE')) {
      return Response.json({ ok: false, code: 'INVALID_CART', message: 'Cart is invalid.' }, { status: 400 });
    }
    safeLog.error('[checkout] Pricing error', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ ok: false, code: 'PRICING_ERROR', message: 'Could not price your cart. Please try again.' }, { status: 409 });
  }

  // Master Plan §6.1 step 6: atomic idempotency claim before mutations.
  const doClaimRes = await doClaim(env, sessionId, idempotencyKey);
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
        await releaseClaim(env, sessionId, idempotencyKey);
        claimHeld = false;
        return Response.json({ ok: false, code: couponResult.reason, message: 'Coupon could not be applied.' }, { status: 409 });
      }
      discountPaisa = assertPaisa(couponResult.discountPaisa, 'discount_paisa');
      couponClaim = couponResult.claim;
      await recordCouponClaim(env.DB, idempotencyKey, couponClaim);
      couponClaimed = true;
    }

    // F-06/§11.7: VAT is charged on the discounted consideration (subtotal
    // minus the coupon discount), not the pre-discount subtotal — otherwise
    // a discounted order is VAT-overcharged. discountPaisa is finalized
    // above before this call. Rate comes from D1 tax_rates, not
    // VAT_RATE_PERCENT (retired, §11.7 D-19).
    const vatRatePercent = await getVatRatePercent(env.DB, 'goods', now);
    vatPaisa = assertPaisa(calculateVatPaisaCanonical(Math.max(0, subtotalPaisa - discountPaisa), vatRatePercent), 'vat_paisa');
    totalPaisa = assertPaisa(Math.max(0, subtotalPaisa + deliveryPaisa + vatPaisa - discountPaisa), 'total_paisa');

    // Master Plan §12.1 step 9: COD threshold uses SUM(quantity), not line count
    const totalQuantity = items.reduce((sum, i) => sum + i.qty, 0);
    const prepayment = calculatePrepayment(totalQuantity, totalPaisa, paymentMethod);
    if (prepayment.required && paymentMethod === 'cod') {
      if (couponClaimed && couponClaim) {
        await releaseCouponUsageAtomic(env.DB, idempotencyKey, couponClaim);
        couponClaimed = false;
      }
      await releaseClaim(env, sessionId, idempotencyKey);
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

    // S-04: quantity threshold alone lets one high-value item ship COD, and
    // does not stop repeated COD orders from the same phone/address. Checked
    // for every COD attempt, not only ones the quantity rule already caught.
    if (paymentMethod === 'cod') {
      const codLimitResult = await checkCodLimits(env.DB, {
        totalPaisa,
        normalizedPhone: phoneResult.phone,
        normalizedAddress: addressInput.toLowerCase().trim(),
      });
      if (!codLimitResult.ok) {
        if (couponClaimed && couponClaim) {
          await releaseCouponUsageAtomic(env.DB, idempotencyKey, couponClaim);
          couponClaimed = false;
        }
        await releaseClaim(env, sessionId, idempotencyKey);
        claimHeld = false;
        return Response.json({
          ok: false,
          code: codLimitResult.reason,
          message: COD_LIMIT_MESSAGES[codLimitResult.reason],
          payment_method_required: 'partial_prepay',
        }, { status: 402 });
      }
    }

    advancePaisa = 0;
    balancePaisa = totalPaisa;
    if (paymentMethod === 'uddoktapay') {
      advancePaisa = totalPaisa;
      balancePaisa = 0;
    } else if (paymentMethod === 'partial_prepay') {
      const split = calculatePrepayment(totalQuantity, totalPaisa, paymentMethod);
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
      await releaseClaim(env, sessionId, idempotencyKey);
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
      await releaseClaim(env, sessionId, idempotencyKey);
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

    // §11.7 step 5: per-line VAT via largest-remainder so
    // SUM(order_items.vat_paisa) === orders.vat_paisa exactly (invariant),
    // not quantity-proportional rounding which can drift off the total.
    const itemIds = items.map(() => crypto.randomUUID());
    const vatAllocation = allocateVatByLargestRemainder(
      items.map((item, i) => ({
        id: itemIds[i],
        linePaisa: snapshots.get(item.variantId)!.price_paisa * item.qty,
      })),
      vatPaisa,
    );
    const orderItems = items.map((item, i) => ({
      itemId: itemIds[i],
      variantId: item.variantId,
      quantity: item.qty,
      unitPricePaisa: snapshots.get(item.variantId)!.price_paisa,
      vatPaisa: assertPaisa(vatAllocation.get(itemIds[i]) ?? 0, 'order_item_vat_paisa'),
      reservationId: item.reservationId,
    }));

    const { orderId, orderNumber } = await insertReservedOrderWithRetry(env.DB, {
      phone: phoneResult.phone,
      name: nameInput,
      address: addressInput,
      shipping_zone: resolvedShippingZone,
      note: parsed.note,
      subtotal_paisa: subtotalPaisa,
      delivery_paisa: deliveryPaisa,
      discount_paisa: discountPaisa,
      vat_paisa: vatPaisa,
      total_paisa: totalPaisa,
      advance_paisa: advancePaisa,
      balance_paisa: balancePaisa,
      payment_method: paymentMethod,
      fraud_decision: fraudDecision,
    }, orderItems, now);
    createdOrderId = orderId;
    createdOrderNumber = orderNumber;
    orderPersisted = true;

    await recordOrderInProgress(env.DB, idempotencyKey, orderId);

    let checkoutUrl: string | null = null;
    let paymentInvoiceId: string | null = null;
    if (advancePaisa > 0) {
      try {
        paymentInvoiceId = crypto.randomUUID();
        // K-13: the Origin header is caller-controlled (any non-browser
        // client can set it to anything) and was used verbatim to build the
        // post-payment redirect URL — an open redirect a provider would
        // happily send a paying customer to after checkout. Allowlist
        // against the configured site origin instead.
        const requestOrigin = context.request.headers.get('Origin') ?? '';
        const origin = requestOrigin === env.PUBLIC_SITE_URL ? requestOrigin : env.PUBLIC_SITE_URL;
        const checkout = await createPaymentCheckout(env, {
          invoiceId: paymentInvoiceId,
          amountPaisa: advancePaisa,
          customerName: nameInput,
          customerPhone: phoneResult.phone,
          orderId,
          type: paymentMethod === 'partial_prepay' ? 'partial_prepay' : 'full',
          redirectUrl: `${origin}/order-track`,
          cancelUrl: `${origin}/cart`,
        });
        if (checkout.ok && checkout.paymentUrl) {
          checkoutUrl = checkout.paymentUrl;
          await env.DB.prepare(
            `INSERT INTO payments (id, order_id, invoice_id, provider, amount_paisa, status, checkout_url, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?7)`
          ).bind(crypto.randomUUID(), orderId, paymentInvoiceId, checkout.provider, advancePaisa, checkout.paymentUrl, now).run();
        }
      } catch {
        safeLog.warn('[checkout] Payment checkout creation failed (non-fatal)', { orderId });
      }
    }

    // Update payment_status when payment was initiated
    if (paymentInvoiceId) {
      await env.DB.prepare(
        `UPDATE orders SET payment_status = 'pending', updated_at = ?2 WHERE id = ?1`
      ).bind(orderId, now).run();
    }

    const response = {
      ok: true,
      order_id: orderId,
      order_number: orderNumber,
      status: 'created',
      advance_paisa: advancePaisa,
      balance_paisa: balancePaisa,
      payment_method: paymentMethod,
      ...(checkoutUrl ? { checkout_url: checkoutUrl } : {}),
    };
    await completeIdempotency(env.DB, idempotencyKey, orderId, JSON.stringify(response));
    await doComplete(env, sessionId, idempotencyKey, orderId, JSON.stringify(response));
    claimHeld = false;

    // Mark cart_activity as converted (AUDIT-B-004/B-002)
    if (sessionId) {
      await env.DB.prepare(
        `UPDATE cart_activity SET converted_order_id = ?2, consent_status = 'allowed', updated_at = ?3 WHERE session_id = ?1`
      ).bind(sessionId, orderId, now).run().catch(() => {});
    }

    // Enqueue order confirmation email [Master_Prompt v7.0 §17.2]
    await enqueueOrderEmail(env, orderId, 'order_confirmed').catch((err) => safeLog.warn('[checkout] Failed to enqueue order email', { error: err instanceof Error ? err.message : String(err), orderId }));
    await enqueueFraudAudit(env, orderId, phoneResult.local, score === 50 ? 'fraud_check_review' : 'post_checkout_audit').catch((err) => safeLog.warn('[checkout] Failed to enqueue fraud audit', { error: err instanceof Error ? err.message : String(err), orderId }));

    return Response.json(response, { status: 201 });
  } catch (err) {
    if (orderPersisted && createdOrderId && createdOrderNumber) {
      const response = {
        ok: true,
        order_id: createdOrderId,
        order_number: createdOrderNumber,
        status: 'created',
        advance_paisa: advancePaisa,
        balance_paisa: balancePaisa,
        payment_method: paymentMethod,
      };
      await env.DB.prepare(
        `UPDATE orders SET advance_paisa = ?2, balance_paisa = ?3, updated_at = ?4 WHERE id = ?1`,
      ).bind(createdOrderId, advancePaisa, balancePaisa, now).run().catch(() => {});
      await completeIdempotency(env.DB, idempotencyKey, createdOrderId, JSON.stringify(response)).catch(() => {});
      await doComplete(env, sessionId, idempotencyKey, createdOrderId, JSON.stringify(response)).catch(() => {});
      safeLog.error('[checkout] Recovered after post-order failure', { error: err instanceof Error ? err.message : String(err), orderId: createdOrderId });
      return Response.json(response, { status: 201 });
    }
    if (couponClaimed && couponClaim) {
      await releaseCouponUsageAtomic(env.DB, idempotencyKey, couponClaim);
      couponClaimed = false;
    }
    if (stockReserved) {
      await releaseReservedVariants(env, items, now);
    }
    if (claimHeld) {
      await releaseClaim(env, sessionId, idempotencyKey);
    }
    safeLog.error('[checkout] Error', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ ok: false, code: 'CHECKOUT_FAILED', message: 'Internal checkout error.' }, { status: 500 });
  }
}
