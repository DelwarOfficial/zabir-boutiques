/**
 * POST /api/staff/orders/create — Staff Order Creation [Staff Operations v2]
 *
 * Handles:
 * - In-store orders (walk-in customers, auto-confirmed, no fraud/payment)
 * - Phone/messenger/whatsapp orders (same checkout pipeline as guest)
 *
 * RBAC: Sales_Tier (super_admin, owner, manager, salesman)
 * CSRF: Required (non-GET staff mutation)
 */
export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, assertSalesAccess, RbacError } from '../../../../lib/rbac';
import { normalizeBangladeshPhone } from '../../../../lib/phone';
import { reserveVariants, releaseReservedVariants } from '../../../../lib/inventory';
import { insertReservedOrderWithRetry } from '../../../../lib/orders';
import { loadVariantSnapshots, calculateAuthoritativeSubtotal, calculateDeliveryPaisa, type CheckoutCartItem } from '../../../../lib/checkout-pricing';
import { assertPaisa, applyCouponAtomic, releaseCouponUsageAtomic } from '../../../../lib/money';
import { checkFraudBD, decideFraudRisk } from '../../../../lib/fraud';
import { calculatePrepayment } from '../../../../lib/prepayment';
import { nowSql } from '../../../../lib/dates';
import { writeAuditLog, clientIp, userAgent } from '../../../../lib/audit';

type OrderChannel = 'in_store' | 'phone' | 'messenger' | 'whatsapp';
const VALID_CHANNELS: OrderChannel[] = ['in_store', 'phone', 'messenger', 'whatsapp'];

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let user;
  try {
    user = await requireAuth(context);
    assertSalesAccess(user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let body: any;
  try { body = await context.request.json(); } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate channel
  const channel = body.channel as string;
  if (!channel || !VALID_CHANNELS.includes(channel as OrderChannel)) {
    return Response.json({ ok: false, code: 'INVALID_CHANNEL', message: 'Specify order channel: in_store, phone, messenger, or whatsapp.' }, { status: 400 });
  }

  const isInStore = channel === 'in_store';

  // Validate phone
  const phoneResult = normalizeBangladeshPhone(body.phone ?? '');
  if (!phoneResult.ok) {
    return Response.json({ ok: false, code: 'INVALID_PHONE', message: 'Use a valid Bangladeshi mobile number.' }, { status: 400 });
  }

  // Validate cart
  const rawItems: Array<{ variant_id?: string; variantId?: string; quantity?: number; qty?: number }> = body.items ?? [];
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return Response.json({ ok: false, code: 'EMPTY_CART', message: 'Cart is empty.' }, { status: 400 });
  }
  if (rawItems.length > 10) {
    return Response.json({ ok: false, code: 'CART_TOO_LARGE', message: 'Maximum 10 line items.' }, { status: 400 });
  }

  const items: CheckoutCartItem[] = rawItems.map((item) => ({
    variantId: item.variant_id ?? item.variantId ?? '',
    qty: item.quantity ?? item.qty ?? 0
  }));

  if (items.some((item) => !item.variantId || !Number.isSafeInteger(item.qty) || item.qty < 1)) {
    return Response.json({ ok: false, code: 'INVALID_CART', message: 'Cart contains invalid items.' }, { status: 400 });
  }

  // Load pricing from D1
  let subtotalPaisa: number;
  let deliveryPaisa: number;
  let discountPaisa = 0;
  let claimedCouponCode = '';
  let snapshots: Awaited<ReturnType<typeof loadVariantSnapshots>>;

  try {
    snapshots = await loadVariantSnapshots(env.DB, items);
    const uniqueVariantIds = new Set(items.map((i) => i.variantId));
    if (snapshots.size !== uniqueVariantIds.size) {
      return Response.json({ ok: false, code: 'VARIANT_UNAVAILABLE', message: 'One item is no longer available.' }, { status: 409 });
    }
    subtotalPaisa = calculateAuthoritativeSubtotal(items, snapshots);
    deliveryPaisa = isInStore ? 0 : await calculateDeliveryPaisa(env.DB, body.shipping_zone, subtotalPaisa);
  } catch (err) {
    console.error('[staff/orders/create] Pricing error:', err);
    return Response.json({ ok: false, code: 'PRICING_ERROR', message: 'Could not price the cart.' }, { status: 409 });
  }

  // Coupon (if provided)
  const couponCode = typeof body.coupon_code === 'string' ? body.coupon_code.trim() : '';
  if (couponCode) {
    const couponResult = await applyCouponAtomic(env.DB, couponCode, subtotalPaisa, now);
    if (!couponResult.ok) {
      return Response.json({ ok: false, code: couponResult.reason, message: 'Coupon could not be applied.' }, { status: 409 });
    }
    claimedCouponCode = couponCode;
    discountPaisa = assertPaisa(Math.min(couponResult.discountPaisa, subtotalPaisa + deliveryPaisa), 'discount_paisa');
  }

  const totalPaisa = assertPaisa(Math.max(0, subtotalPaisa + deliveryPaisa - discountPaisa), 'total_paisa');

  // Determine payment method and prepayment
  let paymentMethod: string = isInStore ? 'in_store' : (body.payment_method ?? 'cod');
  const prepayment = calculatePrepayment(items.length, totalPaisa, paymentMethod);
  // If prepayment is required but caller sent 'cod', upgrade to 'partial_prepay'
  if (prepayment.required && paymentMethod === 'cod') {
    paymentMethod = 'partial_prepay';
  }

  // FraudBD check (skip for in-store)
  let fraudDecision = 'approved';
  if (!isInStore) {
    const { score } = await checkFraudBD(phoneResult.local, env.FRAUDBD_API_KEY);
    fraudDecision = decideFraudRisk(score);
    if (fraudDecision === 'blocked') {
      if (claimedCouponCode) await releaseCouponUsageAtomic(env.DB, claimedCouponCode);
      return Response.json({ ok: false, code: 'FRAUD_BLOCKED', message: 'This order has been flagged.' }, { status: 403 });
    }
  }

  // Reserve stock
  const reserveResult = await reserveVariants(env.DB, items, now);
  if (!reserveResult.ok) {
    if (claimedCouponCode) await releaseCouponUsageAtomic(env.DB, claimedCouponCode);
    return Response.json({ ok: false, code: 'OUT_OF_STOCK', message: 'One item is out of stock.', failed_variant_id: reserveResult.failedVariantId }, { status: 409 });
  }

  try {
    const orderItems = items.map((item) => ({
      variantId: item.variantId,
      quantity: item.qty,
      unitPricePaisa: snapshots.get(item.variantId)!.price_paisa
    }));

    // Determine order status
    const status = isInStore ? 'staff_confirmed' : (prepayment.required ? 'pending_payment' : 'pending_review');

    const { orderId, orderNumber } = await insertReservedOrderWithRetry(env.DB, {
      phone: phoneResult.phone,
      name: body.name ?? '',
      address: body.address ?? (isInStore ? 'In-store pickup' : ''),
      shipping_zone: body.shipping_zone,
      note: body.note,
      subtotal_paisa: subtotalPaisa,
      delivery_paisa: deliveryPaisa,
      discount_paisa: discountPaisa,
      total_paisa: totalPaisa,
      payment_method: paymentMethod as 'cod' | 'uddoktapay' | 'partial_prepay' | 'in_store',
      fraud_decision: fraudDecision,
      status
    }, orderItems, now);

    // Set extra columns via UPDATE (since insertReservedOrderWithRetry doesn't support them natively)
    await env.DB.prepare(
      `UPDATE orders SET created_by = ?2, order_channel = ?3, advance_paisa = ?4, balance_paisa = ?5 WHERE id = ?1`
    ).bind(orderId, user.id, channel, prepayment.advancePaisa, prepayment.balancePaisa).run();

    // For in-store: immediately confirm reservations (deduct stock)
    if (isInStore) {
      const reservations = await env.DB.prepare(
        `SELECT id, variant_id, quantity FROM stock_reservations WHERE order_id = ?1 AND status = 'active'`
      ).bind(orderId).all<{ id: string; variant_id: string; quantity: number }>();

      if (reservations.results && reservations.results.length > 0) {
        const deductStmts = reservations.results.map(r =>
          env.DB.prepare(
            `UPDATE inventory_items SET reserved_quantity = reserved_quantity - ?1, quantity = quantity - ?1, updated_at = ?3
             WHERE variant_id = ?2 AND reserved_quantity >= ?1 AND quantity >= ?1`
          ).bind(r.quantity, r.variant_id, now)
        );
        const confirmStmts = reservations.results.map(r =>
          env.DB.prepare(`UPDATE stock_reservations SET status = 'confirmed', updated_at = ?2 WHERE id = ?1`).bind(r.id, now)
        );
        await env.DB.batch([...deductStmts, ...confirmStmts]);
      }
    }

    // Audit log
    await writeAuditLog(env.DB, {
      actorStaffId: user.id,
      actorRole: user.role,
      action: isInStore ? 'orders.create_instore' : 'orders.create_phone',
      entityType: 'order',
      entityId: orderId,
      metadata: { channel, order_number: orderNumber, phone: phoneResult.phone, prepayment_required: prepayment.required },
      ipAddress: clientIp(context.request),
      userAgent: userAgent(context.request)
    });

    return Response.json({
      ok: true,
      order_id: orderId,
      order_number: orderNumber,
      status,
      prepayment: prepayment.required ? { advance_paisa: prepayment.advancePaisa, balance_paisa: prepayment.balancePaisa, message: prepayment.message } : null
    }, { status: 201 });
  } catch (err) {
    await releaseReservedVariants(env.DB, items, now);
    if (claimedCouponCode) await releaseCouponUsageAtomic(env.DB, claimedCouponCode);
    console.error('[staff/orders/create] Error:', err);
    return Response.json({ ok: false, code: 'ORDER_FAILED', message: 'Internal error creating order.' }, { status: 500 });
  }
}
