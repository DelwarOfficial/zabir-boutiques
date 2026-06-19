/**
 * POST /api/buy-now/submit — Submit Direct Order [Master Plan §10.7]
 *
 * Validates the Buy Now form and submits through the same secure checkout engine.
 * Must NOT implement a separate weak order creation path.
 */
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
  resolveShippingZone,
} from '../../../lib/checkout-pricing';
import { checkFraudBD, decideFraudRisk } from '../../../lib/fraud';
import { calculatePrepayment, PREPAYMENT_MESSAGE } from '../../../lib/prepayment';
import { createPaymentCheckout } from '../../../lib/integrations/payments';
import { verifyTurnstile } from '../../../lib/turnstile';
import { clientIp } from '../../../lib/audit';
import { safeLog } from '../../../lib/pii-scrubber';
import { enqueueFraudAudit, enqueueOrderEmail } from '../../../queues/consumers';

function calculateVatPaisa(subtotalPaisa: number, rawRate: unknown): number {
  const rate = Number(rawRate ?? 0);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return assertPaisa(Math.round((subtotalPaisa * rate) / 100), 'vat_paisa');
}

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
  const sessionBinding = {
    origin: context.request.headers.get('Origin') ?? new URL(context.request.url).origin,
    userAgent: context.request.headers.get('User-Agent') ?? '',
  };
  const sessionRes = await stub.fetch('https://do/get', { method: 'POST', body: JSON.stringify(sessionBinding) });
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
    }, { status: sessionData?.error === 'ORIGIN_MISMATCH' || sessionData?.error === 'USER_AGENT_MISMATCH' ? 403 : 410 });
  }

  const session = sessionData.session;

  // Validate customer form fields
  const nameInput = (body.name ?? '').toString().trim();
  const phoneInput = (body.phone ?? '').toString();
  const addressInput = (body.address ?? '').toString().trim();
  const shippingZoneHint = typeof body.shipping_zone === 'string' ? body.shipping_zone : 'inside_dhaka';
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
  const items: Array<{ variantId: string; qty: number; reservationId?: string }> = [
    { variantId: session.variantId, qty: session.quantity },
  ];

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
  let resolvedShippingZone: 'inside_dhaka' | 'outside_dhaka' = 'outside_dhaka';
  try {
    snapshots = await loadVariantSnapshots(env.DB, items);
    if (snapshots.size !== items.length) {
      return Response.json({ ok: false, code: 'VARIANT_UNAVAILABLE', message: 'Product unavailable.' }, { status: 409 });
    }
    subtotalPaisa = calculateAuthoritativeSubtotal(items, snapshots);
    resolvedShippingZone = resolveShippingZone(addressInput, shippingZoneHint);
    deliveryPaisa = await calculateDeliveryPaisa(env.DB, resolvedShippingZone, subtotalPaisa);
  } catch {
    return Response.json({ ok: false, code: 'PRICING_ERROR', message: 'Could not price your order.' }, { status: 409 });
  }

  const vatPaisa = calculateVatPaisa(subtotalPaisa, (env as unknown as { VAT_RATE_PERCENT?: string }).VAT_RATE_PERCENT);
  const totalPaisa = assertPaisa(Math.max(0, subtotalPaisa + deliveryPaisa + vatPaisa), 'total_paisa');

  // COD quantity rule [Master Plan §11.1 step 10]
  // Auto-upgrade to partial_prepay when COD is not allowed
  const totalQuantity = session.quantity;
  const paymentMethod2 = (paymentMethod: string): string => {
    const prepayment = calculatePrepayment(totalQuantity, totalPaisa, paymentMethod);
    if (prepayment.required && paymentMethod === 'cod') return 'partial_prepay';
    return paymentMethod;
  };
  const resolvedPaymentMethod = paymentMethod2(paymentMethod);

  let advancePaisa = 0;
  let balancePaisa = totalPaisa;
  if (resolvedPaymentMethod === 'uddoktapay') {
    advancePaisa = totalPaisa;
    balancePaisa = 0;
  } else if (resolvedPaymentMethod === 'partial_prepay') {
    const split = calculatePrepayment(totalQuantity, totalPaisa, resolvedPaymentMethod);
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
  let createdOrderId: string | null = null;
  let createdOrderNumber: string | null = null;
  let orderPersisted = false;

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
      vatPaisa: assertPaisa(Math.round((vatPaisa * item.qty) / totalQuantity), 'order_item_vat_paisa'),
      reservationId: item.reservationId,
    }));

    const { orderId, orderNumber } = await insertReservedOrderWithRetry(env.DB, {
      phone: phoneResult.phone,
      name: nameInput,
      address: addressInput,
      shipping_zone: resolvedShippingZone,
      note: typeof body.note === 'string' ? body.note : undefined,
      subtotal_paisa: subtotalPaisa,
      delivery_paisa: deliveryPaisa,
      discount_paisa: 0,
      vat_paisa: vatPaisa,
      total_paisa: totalPaisa,
      payment_method: paymentMethod,
      fraud_decision: fraudDecision,
    }, orderItems, now);
    createdOrderId = orderId;
    createdOrderNumber = orderNumber;
    orderPersisted = true;

    await recordOrderInProgress(env.DB, idempotencyKey, orderId);

    await env.DB.prepare(
      `UPDATE orders SET advance_paisa = ?2, balance_paisa = ?3, updated_at = ?4 WHERE id = ?1`,
    ).bind(orderId, advancePaisa, balancePaisa, now).run();

    // Clear the direct checkout session
    await stub.fetch('https://do/clear', { method: 'POST', body: JSON.stringify(sessionBinding) });

    // Create payment checkout URL for prepaid orders (AUDIT-B-014)
    let checkoutUrl: string | null = null;
    if (advancePaisa > 0) {
      try {
        const paymentInvoiceId = crypto.randomUUID();
        const checkout = await createPaymentCheckout(env, {
          invoiceId: paymentInvoiceId,
          amountPaisa: advancePaisa,
          customerName: nameInput,
          customerPhone: phoneResult.phone,
          orderId,
          type: resolvedPaymentMethod === 'partial_prepay' ? 'partial_prepay' : 'full',
          redirectUrl: `${context.request.headers.get('Origin') ?? env.PUBLIC_SITE_URL}/order-track`,
          cancelUrl: `${context.request.headers.get('Origin') ?? env.PUBLIC_SITE_URL}/buy-now/${sessionId}`,
        });
        if (checkout.ok && checkout.paymentUrl) {
          checkoutUrl = checkout.paymentUrl;
          await env.DB.prepare(
            `INSERT INTO payments (id, order_id, invoice_id, provider, amount_paisa, status, checkout_url, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?7)`
          ).bind(crypto.randomUUID(), orderId, paymentInvoiceId, checkout.provider, advancePaisa, checkout.paymentUrl, now).run();
          await env.DB.prepare(
            `UPDATE orders SET payment_status = 'pending', updated_at = ?2 WHERE id = ?1`
          ).bind(orderId, now).run();
        }
      } catch {
        safeLog.error('[buy-now/submit] payment checkout creation failed', { orderId });
      }
    }

    // Mark cart_activity as converted (AUDIT-B-004)
    await env.DB.prepare(
      `UPDATE cart_activity SET converted_order_id = ?2, consent_status = 'allowed', updated_at = ?3 WHERE session_id = ?1`
    ).bind(sessionId, orderId, now).run().catch(() => {});

    const response = {
      ok: true,
      order_id: orderId,
      order_number: orderNumber,
      status: 'created',
      advance_paisa: advancePaisa,
      balance_paisa: balancePaisa,
      payment_method: resolvedPaymentMethod,
      checkout_url: checkoutUrl,
    };
    await completeIdempotency(env.DB, idempotencyKey, orderId, JSON.stringify(response));
    await doComplete(env, idempotencyKey, orderId, JSON.stringify(response));

    // Enqueue order confirmation email
    await enqueueOrderEmail(env, orderId, 'order_confirmed').catch(() => {});
    await enqueueFraudAudit(env, orderId, phoneResult.local, score === 50 ? 'fraud_check_review' : 'post_checkout_audit').catch(() => {});

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
        payment_method: resolvedPaymentMethod,
      };
      await env.DB.prepare(
        `UPDATE orders SET advance_paisa = ?2, balance_paisa = ?3, updated_at = ?4 WHERE id = ?1`,
      ).bind(createdOrderId, advancePaisa, balancePaisa, now).run().catch(() => {});
      await stub.fetch('https://do/clear', { method: 'POST', body: JSON.stringify(sessionBinding) }).catch(() => {});
      await completeIdempotency(env.DB, idempotencyKey, createdOrderId, JSON.stringify(response)).catch(() => {});
      await doComplete(env, idempotencyKey, createdOrderId, JSON.stringify(response)).catch(() => {});
      safeLog.error('[buy-now/submit] Recovered after post-order failure', { error: err instanceof Error ? err.message : String(err), orderId: createdOrderId });
      return Response.json(response, { status: 201 });
    }
    if (stockReserved) {
      await releaseReservedVariants(env, items, now);
    }
    await failIdempotency(env.DB, idempotencyKey);
    await doFail(env, idempotencyKey);
    safeLog.error('[buy-now/submit] Error', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ ok: false, code: 'CHECKOUT_FAILED', message: 'Internal error.' }, { status: 500 });
  }
}
