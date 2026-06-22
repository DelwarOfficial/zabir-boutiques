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
import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, assertSalesAccess, isOwnerTier, RbacError } from '../../../../lib/rbac';
import { normalizeBangladeshPhone } from '../../../../lib/phone';
import { reserveVariants, releaseReservedVariants, syncConfirmedReservationsDoState } from '../../../../lib/inventory';
import { insertReservedOrderWithRetry } from '../../../../lib/orders';
import { loadVariantSnapshots, calculateAuthoritativeSubtotal, calculateDeliveryPaisa, resolveShippingZone, type CheckoutCartItem } from '../../../../lib/checkout-pricing';
import { assertPaisa, applyCouponAtomic, releaseCouponUsageAtomic, recordCouponClaim, type CouponClaim } from '../../../../lib/money';
import { checkFraudBD, decideFraudRisk } from '../../../../lib/fraud';
import { calculatePrepayment } from '../../../../lib/prepayment';
import { nowSql } from '../../../../lib/dates';
import { writeAuditLog, clientIp, userAgent } from '../../../../lib/audit';
import { safeLog } from '../../../../lib/pii-scrubber';

type OrderChannel = 'in_store' | 'phone' | 'messenger' | 'whatsapp';
const VALID_CHANNELS: OrderChannel[] = ['in_store', 'phone', 'messenger', 'whatsapp'];

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();
  // Per-request idempotency key for coupon-claim lifecycle. The staff order
  // create endpoint does not have a client-supplied idempotency key, so we
  // mint a fresh one for this request to keep the coupon release idempotent
  // even if the worker retries mid-failure.
  const orderIdempotencyKey = `staff-orders-create:${crypto.randomUUID()}`;

  let user;
  try {
    user = await requireAuth(context);
    assertSalesAccess(user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let body: any = {};
  try {
    const contentType = context.request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await context.request.json();
    } else {
      const form = await context.request.formData();
      body = Object.fromEntries(form.entries());
    }
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
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
  let couponClaim: CouponClaim | null = null;
  let snapshots: Awaited<ReturnType<typeof loadVariantSnapshots>>;
  let resolvedShippingZone: 'inside_dhaka' | 'outside_dhaka' = 'outside_dhaka';
  let orderPersisted = false;

  try {
    snapshots = await loadVariantSnapshots(env.DB, items);
    const uniqueVariantIds = new Set(items.map((i) => i.variantId));
    if (snapshots.size !== uniqueVariantIds.size) {
      return Response.json({ ok: false, code: 'VARIANT_UNAVAILABLE', message: 'One item is no longer available.' }, { status: 409 });
    }
    subtotalPaisa = calculateAuthoritativeSubtotal(items, snapshots);
    resolvedShippingZone = resolveShippingZone(String(body.address ?? ''), typeof body.shipping_zone === 'string' ? body.shipping_zone : undefined);
    deliveryPaisa = isInStore ? 0 : await calculateDeliveryPaisa(env.DB, resolvedShippingZone, subtotalPaisa);
  } catch (err) {
    safeLog.error('[staff/orders/create] Pricing error', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ ok: false, code: 'PRICING_ERROR', message: 'Could not price the cart.' }, { status: 409 });
  }

  // Coupon (if provided)
  const couponCode = typeof body.coupon_code === 'string' ? body.coupon_code.trim() : '';
  if (couponCode) {
    if (!isOwnerTier(user.role)) {
      return Response.json({
        ok: false,
        code: 'COUPON_OWNER_ONLY',
        message: 'Staff-assisted orders cannot apply coupon codes.'
      }, { status: 403 });
    }
    const couponResult = await applyCouponAtomic(env.DB, couponCode, subtotalPaisa, now);
    if (!couponResult.ok) {
      return Response.json({ ok: false, code: couponResult.reason, message: 'Coupon could not be applied.' }, { status: 409 });
    }
    couponClaim = couponResult.claim;
    await recordCouponClaim(env.DB, orderIdempotencyKey, couponClaim);
    discountPaisa = assertPaisa(Math.min(couponResult.discountPaisa, subtotalPaisa + deliveryPaisa), 'discount_paisa');
  }

  const vatRate = Number((env as unknown as { VAT_RATE_PERCENT?: string }).VAT_RATE_PERCENT ?? 0);
  const vatPaisa = Number.isFinite(vatRate) && vatRate > 0
    ? assertPaisa(Math.round((subtotalPaisa * vatRate) / 100), 'vat_paisa')
    : 0;
  const totalPaisa = assertPaisa(Math.max(0, subtotalPaisa + deliveryPaisa + vatPaisa - discountPaisa), 'total_paisa');

  // Determine payment method and prepayment
  let paymentMethod: string = isInStore ? 'in_store' : (body.payment_method ?? 'cod');
  const totalQuantity = items.reduce((sum, item) => sum + item.qty, 0);
  const distinctItemCount = new Set(items.map((i) => i.variantId)).size;
  const prepayment = calculatePrepayment(distinctItemCount, totalPaisa, paymentMethod);
  // If prepayment is required but caller sent 'cod', upgrade to 'partial_prepay'
  if (prepayment.required && paymentMethod === 'cod') {
    paymentMethod = 'partial_prepay';
  }

  // FraudBD check (skip for in-store)
  let fraudDecision = 'approved';
  if (!isInStore) {
    const { score } = await checkFraudBD(phoneResult.local, env.FRAUDBD_API_KEY, 1500, 'https://fraudbd.com', env);
    fraudDecision = decideFraudRisk(score);
    if (fraudDecision === 'blocked') {
      if (couponClaim) await releaseCouponUsageAtomic(env.DB, orderIdempotencyKey, couponClaim);
      return Response.json({ ok: false, code: 'FRAUD_BLOCKED', message: 'This order has been flagged.' }, { status: 403 });
    }
  }

  // Reserve stock
  const reserveResult = await reserveVariants(env as unknown as Parameters<typeof reserveVariants>[0], items, now);
  if (!reserveResult.ok) {
    if (couponClaim) await releaseCouponUsageAtomic(env.DB, orderIdempotencyKey, couponClaim);
    const failedIndex = items.findIndex(i => i.variantId === reserveResult.failedVariantId);
    return Response.json({ ok: false, code: 'OUT_OF_STOCK', message: 'One item is out of stock.', failed_cart_index: failedIndex >= 0 ? failedIndex : -1 }, { status: 409 });
  }

  try {
    const orderItems = items.map((item) => ({
      variantId: item.variantId,
      quantity: item.qty,
      unitPricePaisa: snapshots.get(item.variantId)!.price_paisa,
      vatPaisa: assertPaisa(Math.round((vatPaisa * item.qty) / totalQuantity), 'order_item_vat_paisa'),
      reservationId: item.reservationId,
    }));

    // Determine order status
    const status = isInStore ? 'staff_confirmed' : (prepayment.required ? 'pending_payment' : 'pending_review');

    const customerName = (body.name ?? '').trim();
    if (!customerName) return Response.json({ ok: false, code: 'NAME_REQUIRED', message: 'Customer name is required.' }, { status: 400 });

    const { orderId, orderNumber } = await insertReservedOrderWithRetry(env.DB, {
      phone: phoneResult.phone,
      name: customerName,
      address: body.address ?? (isInStore ? 'In-store pickup' : ''),
      shipping_zone: isInStore ? undefined : resolvedShippingZone,
      note: body.note,
      subtotal_paisa: subtotalPaisa,
      delivery_paisa: deliveryPaisa,
      discount_paisa: discountPaisa,
      vat_paisa: vatPaisa,
      total_paisa: totalPaisa,
      payment_method: paymentMethod as 'cod' | 'uddoktapay' | 'partial_prepay' | 'in_store',
      fraud_decision: fraudDecision,
      status
    }, orderItems, now);
    orderPersisted = true;

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
          env.DB.prepare(`UPDATE stock_reservations SET status = 'confirmed', updated_at = ?2 WHERE id = ?1 AND status = 'active'`).bind(r.id, now)
        );
        await env.DB.batch([...deductStmts, ...confirmStmts], { atomic: true });
        await syncConfirmedReservationsDoState(
          env as unknown as Parameters<typeof syncConfirmedReservationsDoState>[0],
          reservations.results.map((r) => ({ variantId: r.variant_id, qty: r.quantity, reservationId: r.id })),
        );
      }

      // In-store orders are paid at the counter; mark payment_status='paid'
      // and record the verification timestamp so the order doesn't appear
      // as awaiting payment in the staff dashboard.
      await env.DB.prepare(
        `UPDATE orders SET payment_status = 'paid', updated_at = ?2 WHERE id = ?1`
      ).bind(orderId, now).run();
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
    if (!orderPersisted) {
      await releaseReservedVariants(env as unknown as Parameters<typeof releaseReservedVariants>[0], items, now);
      if (couponClaim) await releaseCouponUsageAtomic(env.DB, orderIdempotencyKey, couponClaim);
    }
    safeLog.error('[staff/orders/create] Error', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ ok: false, code: 'ORDER_FAILED', message: 'Internal error creating order.' }, { status: 500 });
  }
}
