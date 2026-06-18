/**
 * POST /api/buy-now/submit — Submit Direct Order [Master Plan §10.7]
 *
 * Validates the Buy Now form and submits through the same secure checkout engine.
 * Must NOT implement a separate weak order creation path.
 */
export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { normalizeBangladeshPhone } from '../../../lib/phone';
import { releaseReservedVariants, reserveVariants } from '../../../lib/inventory';
import { insertReservedOrderWithRetry } from '../../../lib/orders';
import { nowSql } from '../../../lib/dates';
import { checkIdempotency, claimIdempotency, completeIdempotency, failIdempotency, recordOrderInProgress } from '../../../lib/idempotency';
import { doClaim, doComplete, doFail, doPeek } from '../../../lib/do-client';
import { assertPaisa } from '../../../lib/money';
import {
  loadVariantSnapshots,
  calculateAuthoritativeSubtotal,
  calculateDeliveryPaisa,
} from '../../../lib/checkout-pricing';
import { checkFraudBD, decideFraudRisk } from '../../../lib/fraud';
import { calculatePrepayment, PREPAYMENT_MESSAGE } from '../../../lib/prepayment';
import { verifyTurnstile } from '../../../lib/turnstile';
import { clientIp } from '../../../lib/audit';
import { safeLog } from '../../../lib/pii-scrubber';
import { enqueueOrderEmail } from '../../../queues/consumers';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // Extract session_id from body
  const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
  if (!sessionId) {
    return Response.json({ ok: false, code: 'MISSING_SESSION', message: 'Session ID required.' }, { status: 400 });
  }

  // Load session from DirectCheckoutSessionDO
  if (!env.DIRECT_CHECKOUT_DO) {
    return Response.json({ ok: false, code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }

  const id = env.DIRECT_CHECKOUT_DO.idFromName(sessionId);
  const stub = env.DIRECT_CHECKOUT_DO.get(id);
  const sessionRes = await stub.fetch('https://do/get', { method: 'POST', body: '{}' });
  const sessionData = (await sessionRes.json().catch(() => null)) as {
    ok?: boolean;
    session?: { productId: string; variantId: string; quantity: number; expiresAt: string };
    error?: string;
  } | null;

  if (!sessionData?.ok || !sessionData.session) {
    return Response.json({
      ok: false,
      code: sessionData?.error === 'SESSION_EXPIRED' ? 'SESSION_EXPIRED' : 'SESSION_NOT_FOUND',
      message: 'Session expired or invalid. Please try again.',
    }, { status: 410 });
  }

  const session = sessionData.session;

  // Validate customer form fields
  const nameInput = (body.name ?? '').toString().trim();
  const phoneInput = (body.phone ?? '').toString();
  const addressInput = (body.address ?? '').toString().trim();
  const shippingZone = typeof body.shipping_zone === 'string' ? body.shipping_zone : 'inside_dhaka';
  const paymentMethodRaw = typeof body.payment_method === 'string' ? body.payment_method : 'cod';
  const paymentMethod = (paymentMethodRaw === 'uddoktapay' || paymentMethodRaw === 'partial_prepay')
    ? paymentMethodRaw
    : 'cod';

  if (!nameInput || nameInput.length < 2) {
    return Response.json({ ok: false, code: 'INVALID_NAME', message: 'Name is required.' }, { status: 400 });
  }

  const phoneResult = normalizeBangladeshPhone(phoneInput);
  if (!phoneResult.ok) {
    return Response.json({ ok: false, code: 'INVALID_PHONE', message: 'Valid Bangladeshi phone required.' }, { status: 400 });
  }

  if (!addressInput || addressInput.length < 8) {
    return Response.json({ ok: false, code: 'INVALID_ADDRESS', message: 'Delivery address is required.' }, { status: 400 });
  }

  // Build cart items from session
  const items = [{ variantId: session.variantId, qty: session.quantity }];

  // Idempotency
  const headerKey = context.request.headers.get('Idempotency-Key');
  const bodyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : null;
  const idempotencyKey = (headerKey || bodyKey)?.trim() || null;
  if (!idempotencyKey) {
    return Response.json({ ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Please try again.' }, { status: 400 });
  }

  // Turnstile
  if (env.TURNSTILE_SECRET_KEY) {
    const token = typeof body.turnstile === 'string' ? body.turnstile : context.request.headers.get('CF-Turnstile-Token');
    if (token) {
      const r = await verifyTurnstile(env, token, clientIp(context.request) ?? undefined);
      if (!r.ok) {
        return Response.json({ ok: false, code: 'TURNSTILE_FAILED', message: 'Bot check failed.' }, { status: 403 });
      }
    }
  }

  // Peek idempotency
  const peek = await doPeek(env, idempotencyKey);
  if (peek.replay && peek.responseBody) {
    try { return Response.json(JSON.parse(peek.responseBody), { status: 200 }); } catch {
      return Response.json({ ok: false, code: 'DUPLICATE' }, { status: 409 });
    }
  }
  if (peek.code === 'PROCESSING') {
    return Response.json({ ok: false, code: 'CHECKOUT_PROCESSING' }, { status: 202 });
  }

  const existing = await checkIdempotency(env.DB, idempotencyKey);
  if (existing.exists && existing.status === 'complete' && existing.responseBody) {
    try { return Response.json(JSON.parse(existing.responseBody), { status: 200 }); } catch {
      return Response.json({ ok: false, code: 'DUPLICATE' }, { status: 409 });
    }
  }

  // Authoritative pricing
  let snapshots, subtotalPaisa, deliveryPaisa;
  try {
    snapshots = await loadVariantSnapshots(env.DB, items);
    if (snapshots.size !== items.length) {
      return Response.json({ ok: false, code: 'VARIANT_UNAVAILABLE', message: 'Product unavailable.' }, { status: 409 });
    }
    subtotalPaisa = calculateAuthoritativeSubtotal(items, snapshots);
    deliveryPaisa = await calculateDeliveryPaisa(env.DB, shippingZone, subtotalPaisa);
  } catch {
    return Response.json({ ok: false, code: 'PRICING_ERROR', message: 'Could not price your order.' }, { status: 409 });
  }

  const totalPaisa = assertPaisa(Math.max(0, subtotalPaisa + deliveryPaisa), 'total_paisa');

  // COD quantity rule [Master Plan §11.1 step 10]
  const totalQuantity = session.quantity;
  const prepayment = calculatePrepayment(totalQuantity, totalPaisa, paymentMethod);
  if (prepayment.required && paymentMethod === 'cod') {
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
    const split = calculatePrepayment(totalQuantity, totalPaisa, paymentMethod);
    advancePaisa = split.advancePaisa;
    balancePaisa = split.balancePaisa;
  }

  // Claim idempotency
  const doClaimRes = await doClaim(env, idempotencyKey);
  if (doClaimRes.replay && doClaimRes.responseBody) {
    try { return Response.json(JSON.parse(doClaimRes.responseBody), { status: 200 }); } catch {
      return Response.json({ ok: false, code: 'DUPLICATE' }, { status: 409 });
    }
  }
  if (!doClaimRes.ok || !doClaimRes.claimed) {
    return Response.json({ ok: false, code: 'CHECKOUT_PROCESSING' }, { status: 202 });
  }

  await claimIdempotency(env.DB, idempotencyKey, now);

  let stockReserved = false;

  try {
    // Fraud check [Master Plan §11.1 step 12]
    const { score } = await checkFraudBD(phoneResult.local, env.FRAUDBD_API_KEY, 1500, 'https://fraudbd.com', env);
    const fraudDecision = decideFraudRisk(score);

    if (fraudDecision === 'blocked') {
      await failIdempotency(env.DB, idempotencyKey);
      await doFail(env, idempotencyKey);
      return Response.json({
        ok: false, code: 'FRAUD_BLOCKED',
        message: 'This order has been flagged. Please contact customer support.',
      }, { status: 403 });
    }

    // Reserve stock [Master Plan §11.1 step 14]
    const reserveResult = await reserveVariants(env, items, now);
    if (!reserveResult.ok) {
      await failIdempotency(env.DB, idempotencyKey);
      await doFail(env, idempotencyKey);
      return Response.json({
        ok: false, code: 'OUT_OF_STOCK',
        message: 'This item just went out of stock.',
      }, { status: 409 });
    }
    stockReserved = true;

    // Create order [Master Plan §11.1 step 16]
    const orderItems = items.map((item) => ({
      variantId: item.variantId,
      quantity: item.qty,
      unitPricePaisa: snapshots.get(item.variantId)!.price_paisa,
    }));

    const { orderId, orderNumber } = await insertReservedOrderWithRetry(env.DB, {
      phone: phoneResult.phone,
      name: nameInput,
      address: addressInput,
      shipping_zone: shippingZone,
      note: typeof body.note === 'string' ? body.note : undefined,
      subtotal_paisa: subtotalPaisa,
      delivery_paisa: deliveryPaisa,
      discount_paisa: 0,
      total_paisa: totalPaisa,
      payment_method: paymentMethod,
      fraud_decision: fraudDecision,
    }, orderItems, now);

    await recordOrderInProgress(env.DB, idempotencyKey, orderId);

    await env.DB.prepare(
      `UPDATE orders SET advance_paisa = ?2, balance_paisa = ?3, updated_at = ?4 WHERE id = ?1`,
    ).bind(orderId, advancePaisa, balancePaisa, now).run();

    // Clear the direct checkout session
    await stub.fetch('https://do/clear', { method: 'POST', body: '{}' });

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

    // Enqueue order confirmation email
    await enqueueOrderEmail(env, orderId, 'order_confirmed').catch(() => {});

    return Response.json(response, { status: 201 });
  } catch (err) {
    if (stockReserved) {
      await releaseReservedVariants(env, items, now);
    }
    await failIdempotency(env.DB, idempotencyKey);
    await doFail(env, idempotencyKey);
    safeLog.error('[buy-now/submit] Error', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ ok: false, code: 'CHECKOUT_FAILED', message: 'Internal error.' }, { status: 500 });
  }
}
