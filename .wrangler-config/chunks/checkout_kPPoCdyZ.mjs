globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { n as normalizeBangladeshPhone } from "./phone_DlB2NzV4.mjs";
import { c as clientIp, d as reserveVariants, r as releaseReservedVariants } from "./worker-entry_CjpE2ho_.mjs";
import { d as assertNoClientMoneyTrust, l as loadVariantSnapshots, c as calculateAuthoritativeSubtotal, a as calculateDeliveryPaisa, b as calculatePrepayment, i as insertReservedOrderWithRetry } from "./prepayment_DI60rxz8.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
import { b as applyCouponAtomic, a as assertPaisa, r as recordCouponClaim, c as releaseCouponUsageAtomic } from "./money_DWLDQpFs.mjs";
import { checkFraudBD, decideFraudRisk } from "./fraud_BFITCOJK.mjs";
import { v as verifyTurnstile } from "./turnstile_DZLnxhOe.mjs";
async function checkIdempotency(db, key) {
  const row = await db.prepare(
    `SELECT status, response_body, order_id, expires_at FROM checkout_idempotency WHERE idempotency_key = ?1`
  ).bind(key).first();
  if (!row) return { exists: false };
  const now = nowSql();
  if (row.expires_at < now) return { exists: false };
  return { exists: true, status: row.status, responseBody: row.response_body, orderId: row.order_id };
}
async function claimIdempotency(db, key, now) {
  const expiresAt = nowSql(new Date(Date.now() + 30 * 60 * 1e3));
  try {
    await db.prepare(
      `INSERT INTO checkout_idempotency (idempotency_key, status, created_at, expires_at)
       VALUES (?1, 'processing', ?2, ?3)`
    ).bind(key, now, expiresAt).run();
    return true;
  } catch {
    return false;
  }
}
async function recordOrderInProgress(db, key, orderId) {
  await db.prepare(
    `UPDATE checkout_idempotency SET order_id = ?2 WHERE idempotency_key = ?1`
  ).bind(key, orderId).run();
}
async function completeIdempotency(db, key, orderId, responseBody) {
  await db.prepare(
    `UPDATE checkout_idempotency SET status = 'complete', order_id = ?2, response_body = ?3
     WHERE idempotency_key = ?1`
  ).bind(key, orderId, responseBody).run();
}
async function failIdempotency(db, key) {
  await db.prepare(
    `UPDATE checkout_idempotency SET status = 'failed' WHERE idempotency_key = ?1`
  ).bind(key).run();
}
const prerender = false;
async function POST(context) {
  const env = getEnv();
  const now = nowSql();
  let body;
  let stockReserved = false;
  let couponClaimed = false;
  let couponClaim = null;
  let items = [];
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  assertNoClientMoneyTrust(body ?? {});
  if (env.TURNSTILE_SECRET_KEY) {
    const token = typeof body.turnstile === "string" ? body.turnstile : context.request.headers.get("CF-Turnstile-Token");
    if (token) {
      const r = await verifyTurnstile(env, token, clientIp(context.request) ?? void 0);
      if (!r.ok) {
        return Response.json({ ok: false, code: "TURNSTILE_FAILED", message: "Bot check failed." }, { status: 403 });
      }
    }
  }
  const idempotencyKey = context.request.headers.get("Idempotency-Key") || body.idempotency_key;
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    return Response.json({ ok: false, code: "MISSING_IDEMPOTENCY_KEY", message: "Please try again." }, { status: 400 });
  }
  const existing = await checkIdempotency(env.DB, idempotencyKey);
  if (existing.exists) {
    if (existing.status === "complete") {
      return Response.json(JSON.parse(existing.responseBody ?? "{}"), { status: 200 });
    }
    if (existing.status === "processing" && existing.orderId) {
      const order = await env.DB.prepare(
        `SELECT id AS order_id, order_number, status, advance_paisa, balance_paisa
         FROM orders WHERE id = ?1`
      ).bind(existing.orderId).first();
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
    return Response.json({ ok: false, code: "CHECKOUT_PROCESSING", message: "Request is already processing." }, { status: 409 });
  }
  const phoneResult = normalizeBangladeshPhone(body.phone ?? "");
  if (!phoneResult.ok) {
    return Response.json({ ok: false, code: "INVALID_PHONE", message: "Use a valid Bangladeshi mobile number." }, { status: 400 });
  }
  const rawItems = body.items ?? [];
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return Response.json({ ok: false, code: "EMPTY_CART", message: "Cart is empty." }, { status: 400 });
  }
  if (rawItems.length > 10) {
    return Response.json({ ok: false, code: "CART_TOO_LARGE", message: "Please place a smaller order." }, { status: 400 });
  }
  items = rawItems.map((item) => ({
    variantId: item.variant_id ?? item.variantId ?? "",
    qty: item.quantity ?? item.qty ?? 0
  }));
  if (items.some((item) => !item.variantId)) {
    return Response.json({ ok: false, code: "INVALID_CART", message: "Cart contains an invalid item." }, { status: 400 });
  }
  if (items.some((item) => !Number.isSafeInteger(item.qty) || item.qty < 1)) {
    return Response.json({ ok: false, code: "INVALID_QUANTITY", message: "Each item needs a valid quantity." }, { status: 400 });
  }
  let subtotalPaisa;
  let deliveryPaisa;
  let discountPaisa = 0;
  let totalPaisa;
  let snapshots;
  try {
    snapshots = await loadVariantSnapshots(env.DB, items);
    const uniqueVariantIds = new Set(items.map((item) => item.variantId));
    if (snapshots.size !== uniqueVariantIds.size) {
      return Response.json({
        ok: false,
        code: "VARIANT_UNAVAILABLE",
        message: "One item is no longer available. Your cart has been updated."
      }, { status: 409 });
    }
    subtotalPaisa = calculateAuthoritativeSubtotal(items, snapshots);
    deliveryPaisa = await calculateDeliveryPaisa(env.DB, body.shipping_zone, subtotalPaisa);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PRICING_ERROR";
    if (code.startsWith("INVALID_CART_SIZE")) {
      return Response.json({ ok: false, code: "INVALID_CART", message: "Cart is invalid." }, { status: 400 });
    }
    console.error("[checkout] Pricing error:", err);
    return Response.json({ ok: false, code: "PRICING_ERROR", message: "Could not price your cart. Please try again." }, { status: 409 });
  }
  const claimed = await claimIdempotency(env.DB, idempotencyKey, now);
  if (!claimed) {
    return Response.json({ ok: false, code: "DUPLICATE_CHECKOUT", message: "Duplicate request." }, { status: 409 });
  }
  try {
    const couponCode = typeof body.coupon_code === "string" ? body.coupon_code.trim() : "";
    if (couponCode) {
      const couponResult = await applyCouponAtomic(env.DB, couponCode, subtotalPaisa, now);
      if (!couponResult.ok) {
        await failIdempotency(env.DB, idempotencyKey);
        return Response.json({ ok: false, code: couponResult.reason, message: "Coupon could not be applied." }, { status: 409 });
      }
      discountPaisa = assertPaisa(couponResult.discountPaisa, "discount_paisa");
      couponClaim = couponResult.claim;
      await recordCouponClaim(env.DB, idempotencyKey, couponClaim);
      couponClaimed = true;
    }
    totalPaisa = assertPaisa(Math.max(0, subtotalPaisa + deliveryPaisa - discountPaisa), "total_paisa");
    let paymentMethod = body.payment_method ?? "cod";
    let prepayment = calculatePrepayment(items.length, totalPaisa, paymentMethod);
    if (prepayment.required && paymentMethod === "cod") {
      paymentMethod = "partial_prepay";
      prepayment = calculatePrepayment(items.length, totalPaisa, paymentMethod);
    }
    let advancePaisa = 0;
    let balancePaisa = totalPaisa;
    if (paymentMethod === "uddoktapay") {
      advancePaisa = totalPaisa;
      balancePaisa = 0;
    } else if (paymentMethod === "partial_prepay") {
      advancePaisa = prepayment.advancePaisa;
      balancePaisa = prepayment.balancePaisa;
    }
    const { score } = await checkFraudBD(phoneResult.local, env.FRAUDBD_API_KEY);
    const fraudDecision = decideFraudRisk(score);
    if (fraudDecision === "blocked") {
      if (couponClaimed && couponClaim) {
        await releaseCouponUsageAtomic(env.DB, idempotencyKey, couponClaim);
        couponClaimed = false;
      }
      await failIdempotency(env.DB, idempotencyKey);
      return Response.json({
        ok: false,
        code: "FRAUD_BLOCKED",
        message: "This order has been flagged. Please contact customer support."
      }, { status: 403 });
    }
    const reserveResult = await reserveVariants(env, items, now);
    if (!reserveResult.ok) {
      if (couponClaimed && couponClaim) {
        await releaseCouponUsageAtomic(env.DB, idempotencyKey, couponClaim);
        couponClaimed = false;
      }
      await failIdempotency(env.DB, idempotencyKey);
      const failedIndex = items.findIndex((i) => i.variantId === reserveResult.failedVariantId);
      return Response.json({
        ok: false,
        code: "OUT_OF_STOCK",
        message: "One item just went out of stock. Your cart has been updated.",
        failed_cart_index: failedIndex >= 0 ? failedIndex : -1,
        available_quantity: 0
      }, { status: 409 });
    }
    stockReserved = true;
    const orderItems = items.map((item) => ({
      variantId: item.variantId,
      quantity: item.qty,
      unitPricePaisa: snapshots.get(item.variantId).price_paisa
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
    await recordOrderInProgress(env.DB, idempotencyKey, orderId);
    await env.DB.prepare(
      `UPDATE orders SET advance_paisa = ?2, balance_paisa = ?3, updated_at = ?4 WHERE id = ?1`
    ).bind(orderId, advancePaisa, balancePaisa, now).run();
    const response = {
      ok: true,
      order_id: orderId,
      order_number: orderNumber,
      status: "created",
      advance_paisa: advancePaisa,
      balance_paisa: balancePaisa
    };
    await completeIdempotency(env.DB, idempotencyKey, orderId, JSON.stringify(response));
    return Response.json(response, { status: 201 });
  } catch (err) {
    if (couponClaimed && couponClaim) {
      await releaseCouponUsageAtomic(env.DB, idempotencyKey, couponClaim);
      couponClaimed = false;
    }
    if (stockReserved) {
      await releaseReservedVariants(env, items, now);
    }
    await failIdempotency(env.DB, idempotencyKey);
    console.error("[checkout] Error:", err);
    return Response.json({ ok: false, code: "CHECKOUT_FAILED", message: "Internal checkout error." }, { status: 500 });
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
