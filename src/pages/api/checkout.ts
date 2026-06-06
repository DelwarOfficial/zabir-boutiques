/**
 * POST /api/checkout — Guest Checkout [v6.8A]
 * Rate limit, idempotency, D1 atomic reservation.
 * Flow: validate → normalize phone → fraud check → reserveVariants() → create order
 */
export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../lib/env';
import { normalizeBangladeshPhone } from '../../lib/phone';
import { releaseReservedVariants, reserveVariants } from '../../lib/inventory';
import { insertReservedOrderWithRetry } from '../../lib/orders';
import { nowSql } from '../../lib/dates';
import { checkIdempotency, claimIdempotency, completeIdempotency, failIdempotency } from '../../lib/idempotency';
import { addPaisa, assertPaisa, multiplyPaisa } from '../../lib/money';
import { checkFraudBD, decideFraudRisk } from '../../lib/fraud';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let body: any;
  let stockReserved = false;

  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
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
    return Response.json({ ok: false, code: 'CHECKOUT_PROCESSING', message: 'Request is already processing.' }, { status: 409 });
  }

  // 2. Normalize phone
  const phoneResult = normalizeBangladeshPhone(body.phone ?? '');
  if (!phoneResult.ok) {
    return Response.json({ ok: false, code: 'INVALID_PHONE', message: 'Use a valid Bangladeshi mobile number.' }, { status: 400 });
  }

  // 3. Validate cart (max 10 line items)
  const rawItems: Array<{ variant_id?: string; variantId?: string; quantity?: number; qty?: number; unit_price_paisa?: number }> = body.items ?? [];
  if (!rawItems.length) return Response.json({ ok: false, code: 'EMPTY_CART', message: 'Cart is empty.' }, { status: 400 });
  if (rawItems.length > 10) return Response.json({ ok: false, code: 'CART_TOO_LARGE', message: 'Please place a smaller order.' }, { status: 400 });

  const subtotalPaisa = addPaisa(rawItems.map((item) => multiplyPaisa(assertPaisa(item.unit_price_paisa ?? 0, 'unit_price_paisa'), item.quantity ?? item.qty ?? 0)));
  const deliveryPaisa = assertPaisa(body.delivery_paisa ?? 0, 'delivery_paisa');
  const discountPaisa = assertPaisa(body.discount_paisa ?? 0, 'discount_paisa');
  const totalPaisa = assertPaisa(subtotalPaisa + deliveryPaisa - discountPaisa, 'total_paisa');

  if (subtotalPaisa !== body.subtotal_paisa || totalPaisa !== body.total_paisa) {
    return Response.json({ ok: false, code: 'TOTAL_MISMATCH', message: 'Cart totals changed. Please review and place the order again.' }, { status: 409 });
  }

  const items = rawItems.map((item) => ({
    variantId: item.variant_id ?? item.variantId ?? '',
    qty: item.quantity ?? item.qty ?? 0
  }));
  const orderItems = rawItems.map((item) => ({
    variantId: item.variant_id ?? item.variantId ?? '',
    quantity: item.quantity ?? item.qty ?? 0,
    unitPricePaisa: assertPaisa(item.unit_price_paisa ?? 0, 'unit_price_paisa')
  }));

  // Claim idempotency
  const claimed = await claimIdempotency(env.DB, idempotencyKey, now);
  if (!claimed) {
    return Response.json({ ok: false, code: 'DUPLICATE_CHECKOUT', message: 'Duplicate request.' }, { status: 409 });
  }

  try {
    // 6. FraudBD check
    const { score } = await checkFraudBD(phoneResult.phone, env.FRAUDBD_API_KEY);
    const fraudDecision = decideFraudRisk(score);

    if (fraudDecision === 'blocked') {
      await failIdempotency(env.DB, idempotencyKey);
      return Response.json({
        ok: false, code: 'FRAUD_BLOCKED',
        message: 'This order has been flagged. Please contact customer support.'
      }, { status: 403 });
    }

    // 7. Reserve stock
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

    // 8. Create order (only after reservation success)
    const { orderId, orderNumber } = await insertReservedOrderWithRetry(env.DB, {
      phone: phoneResult.phone,
      name: body.name,
      address: body.address,
      shipping_zone: body.shipping_zone,
      note: body.note,
      subtotal_paisa: body.subtotal_paisa,
      delivery_paisa: body.delivery_paisa,
      discount_paisa: body.discount_paisa ?? 0,
      total_paisa: body.total_paisa,
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
