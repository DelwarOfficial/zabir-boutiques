globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { r as requireAuth, d as assertSalesAccess, R as RbacError, i as isOwnerTier } from "./rbac_cfH-YcoZ.mjs";
import { n as normalizeBangladeshPhone } from "./phone_DlB2NzV4.mjs";
import { d as reserveVariants, w as writeAuditLog, u as userAgent, c as clientIp, r as releaseReservedVariants } from "./worker-entry_CjpE2ho_.mjs";
import { l as loadVariantSnapshots, c as calculateAuthoritativeSubtotal, a as calculateDeliveryPaisa, b as calculatePrepayment, i as insertReservedOrderWithRetry } from "./prepayment_DI60rxz8.mjs";
import { b as applyCouponAtomic, r as recordCouponClaim, a as assertPaisa, c as releaseCouponUsageAtomic } from "./money_DWLDQpFs.mjs";
import { checkFraudBD, decideFraudRisk } from "./fraud_BFITCOJK.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
const prerender = false;
const VALID_CHANNELS = ["in_store", "phone", "messenger", "whatsapp"];
async function POST(context) {
  const env = getEnv();
  const now = nowSql();
  const orderIdempotencyKey = `staff-orders-create:${crypto.randomUUID()}`;
  let user;
  try {
    user = await requireAuth(context);
    assertSalesAccess(user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }
  let body = {};
  try {
    const contentType = context.request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await context.request.json();
    } else {
      const form = await context.request.formData();
      body = Object.fromEntries(form.entries());
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const channel = body.channel;
  if (!channel || !VALID_CHANNELS.includes(channel)) {
    return Response.json({ ok: false, code: "INVALID_CHANNEL", message: "Specify order channel: in_store, phone, messenger, or whatsapp." }, { status: 400 });
  }
  const isInStore = channel === "in_store";
  const phoneResult = normalizeBangladeshPhone(body.phone ?? "");
  if (!phoneResult.ok) {
    return Response.json({ ok: false, code: "INVALID_PHONE", message: "Use a valid Bangladeshi mobile number." }, { status: 400 });
  }
  const rawItems = body.items ?? [];
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return Response.json({ ok: false, code: "EMPTY_CART", message: "Cart is empty." }, { status: 400 });
  }
  if (rawItems.length > 10) {
    return Response.json({ ok: false, code: "CART_TOO_LARGE", message: "Maximum 10 line items." }, { status: 400 });
  }
  const items = rawItems.map((item) => ({
    variantId: item.variant_id ?? item.variantId ?? "",
    qty: item.quantity ?? item.qty ?? 0
  }));
  if (items.some((item) => !item.variantId || !Number.isSafeInteger(item.qty) || item.qty < 1)) {
    return Response.json({ ok: false, code: "INVALID_CART", message: "Cart contains invalid items." }, { status: 400 });
  }
  let subtotalPaisa;
  let deliveryPaisa;
  let discountPaisa = 0;
  let couponClaim = null;
  let snapshots;
  try {
    snapshots = await loadVariantSnapshots(env.DB, items);
    const uniqueVariantIds = new Set(items.map((i) => i.variantId));
    if (snapshots.size !== uniqueVariantIds.size) {
      return Response.json({ ok: false, code: "VARIANT_UNAVAILABLE", message: "One item is no longer available." }, { status: 409 });
    }
    subtotalPaisa = calculateAuthoritativeSubtotal(items, snapshots);
    deliveryPaisa = isInStore ? 0 : await calculateDeliveryPaisa(env.DB, body.shipping_zone, subtotalPaisa);
  } catch (err) {
    console.error("[staff/orders/create] Pricing error:", err);
    return Response.json({ ok: false, code: "PRICING_ERROR", message: "Could not price the cart." }, { status: 409 });
  }
  const couponCode = typeof body.coupon_code === "string" ? body.coupon_code.trim() : "";
  if (couponCode) {
    if (!isOwnerTier(user.role)) {
      return Response.json({
        ok: false,
        code: "COUPON_OWNER_ONLY",
        message: "Staff-assisted orders cannot apply coupon codes."
      }, { status: 403 });
    }
    const couponResult = await applyCouponAtomic(env.DB, couponCode, subtotalPaisa, now);
    if (!couponResult.ok) {
      return Response.json({ ok: false, code: couponResult.reason, message: "Coupon could not be applied." }, { status: 409 });
    }
    couponClaim = couponResult.claim;
    await recordCouponClaim(env.DB, orderIdempotencyKey, couponClaim);
    discountPaisa = assertPaisa(Math.min(couponResult.discountPaisa, subtotalPaisa + deliveryPaisa), "discount_paisa");
  }
  const totalPaisa = assertPaisa(Math.max(0, subtotalPaisa + deliveryPaisa - discountPaisa), "total_paisa");
  let paymentMethod = isInStore ? "in_store" : body.payment_method ?? "cod";
  const prepayment = calculatePrepayment(items.length, totalPaisa, paymentMethod);
  if (prepayment.required && paymentMethod === "cod") {
    paymentMethod = "partial_prepay";
  }
  let fraudDecision = "approved";
  if (!isInStore) {
    const { score } = await checkFraudBD(phoneResult.local, env.FRAUDBD_API_KEY);
    fraudDecision = decideFraudRisk(score);
    if (fraudDecision === "blocked") {
      if (couponClaim) await releaseCouponUsageAtomic(env.DB, orderIdempotencyKey, couponClaim);
      return Response.json({ ok: false, code: "FRAUD_BLOCKED", message: "This order has been flagged." }, { status: 403 });
    }
  }
  const reserveResult = await reserveVariants(env, items, now);
  if (!reserveResult.ok) {
    if (couponClaim) await releaseCouponUsageAtomic(env.DB, orderIdempotencyKey, couponClaim);
    const failedIndex = items.findIndex((i) => i.variantId === reserveResult.failedVariantId);
    return Response.json({ ok: false, code: "OUT_OF_STOCK", message: "One item is out of stock.", failed_cart_index: failedIndex >= 0 ? failedIndex : -1 }, { status: 409 });
  }
  try {
    const orderItems = items.map((item) => ({
      variantId: item.variantId,
      quantity: item.qty,
      unitPricePaisa: snapshots.get(item.variantId).price_paisa
    }));
    const status = isInStore ? "staff_confirmed" : prepayment.required ? "pending_payment" : "pending_review";
    const { orderId, orderNumber } = await insertReservedOrderWithRetry(env.DB, {
      phone: phoneResult.phone,
      name: body.name ?? "",
      address: body.address ?? (isInStore ? "In-store pickup" : ""),
      shipping_zone: body.shipping_zone,
      note: body.note,
      subtotal_paisa: subtotalPaisa,
      delivery_paisa: deliveryPaisa,
      discount_paisa: discountPaisa,
      total_paisa: totalPaisa,
      payment_method: paymentMethod,
      fraud_decision: fraudDecision,
      status
    }, orderItems, now);
    await env.DB.prepare(
      `UPDATE orders SET created_by = ?2, order_channel = ?3, advance_paisa = ?4, balance_paisa = ?5 WHERE id = ?1`
    ).bind(orderId, user.id, channel, prepayment.advancePaisa, prepayment.balancePaisa).run();
    if (isInStore) {
      const reservations = await env.DB.prepare(
        `SELECT id, variant_id, quantity FROM stock_reservations WHERE order_id = ?1 AND status = 'active'`
      ).bind(orderId).all();
      if (reservations.results && reservations.results.length > 0) {
        const deductStmts = reservations.results.map(
          (r) => env.DB.prepare(
            `UPDATE inventory_items SET reserved_quantity = reserved_quantity - ?1, quantity = quantity - ?1, updated_at = ?3
             WHERE variant_id = ?2 AND reserved_quantity >= ?1 AND quantity >= ?1`
          ).bind(r.quantity, r.variant_id, now)
        );
        const confirmStmts = reservations.results.map(
          (r) => env.DB.prepare(`UPDATE stock_reservations SET status = 'confirmed', updated_at = ?2 WHERE id = ?1`).bind(r.id, now)
        );
        await env.DB.batch([...deductStmts, ...confirmStmts], { atomic: true });
      }
      await env.DB.prepare(
        `UPDATE orders SET payment_status = 'paid', updated_at = ?2 WHERE id = ?1`
      ).bind(orderId, now).run();
    }
    await writeAuditLog(env.DB, {
      actorStaffId: user.id,
      actorRole: user.role,
      action: isInStore ? "orders.create_instore" : "orders.create_phone",
      entityType: "order",
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
    await releaseReservedVariants(env, items, now);
    if (couponClaim) await releaseCouponUsageAtomic(env.DB, orderIdempotencyKey, couponClaim);
    console.error("[staff/orders/create] Error:", err);
    return Response.json({ ok: false, code: "ORDER_FAILED", message: "Internal error creating order." }, { status: 500 });
  }
}
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  POST,
  prerender
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
