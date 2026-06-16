globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { v as verifyUddoktaPayment, a as enqueuePaymentWebhook } from "./worker-entry_CjpE2ho_.mjs";
import { t as timingSafeEqualHex } from "./security_CY3I9xIU.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
const prerender = false;
async function POST(context) {
  const env = getEnv();
  const now = nowSql();
  const ipnKey = context.request.headers.get("RT-UDDOKTAPAY-API-KEY");
  if (!ipnKey || !timingSafeEqualHex(ipnKey, env.UDDOKTAPAY_API_KEY)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rawPayload = JSON.stringify(await context.request.json().catch(() => ({})));
  let body;
  try {
    body = JSON.parse(rawPayload);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const invoiceId = body.invoice_id;
  if (!invoiceId) return Response.json({ error: "Missing invoice_id" }, { status: 400 });
  const { status, amountPaisa, metadata, rawResponse } = await verifyUddoktaPayment(invoiceId, env.UDDOKTAPAY_API_KEY, env.UDDOKTAPAY_BASE_URL);
  if (status !== "paid") return Response.json({ received: true, status }, { status: 200 });
  if (env.PAYMENT_WEBHOOKS) {
    await enqueuePaymentWebhook(env, invoiceId);
    return Response.json({ received: true, status: "queued" }, { status: 200 });
  }
  const payment = await env.DB.prepare(
    `SELECT id, order_id, amount_paisa, status FROM payments WHERE invoice_id = ?1`
  ).bind(invoiceId).first();
  if (!payment) return Response.json({ error: "Payment not found" }, { status: 404 });
  if (amountPaisa === null || amountPaisa !== payment.amount_paisa) {
    const firstItem = await env.DB.prepare(
      `SELECT variant_id FROM order_items WHERE order_id = ?1 LIMIT 1`
    ).bind(payment.order_id).first();
    const alertVariantId = firstItem?.variant_id ?? "unknown";
    await env.DB.prepare(
      `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
       VALUES (?1, ?2, ?3, ?4)`
    ).bind(
      crypto.randomUUID(),
      alertVariantId,
      `payment_amount_mismatch invoice=${invoiceId} expected=${payment.amount_paisa} verified=${amountPaisa}. Manual review required.`,
      now
    ).run();
    return Response.json({ error: "Payment amount mismatch" }, { status: 409 });
  }
  if (metadata && typeof metadata.order_id === "string" && metadata.order_id !== payment.order_id) {
    return Response.json({ error: "Invoice does not belong to this order" }, { status: 409 });
  }
  const orderTotalPaisa = (await env.DB.prepare(`SELECT total_paisa FROM orders WHERE id = ?1`).bind(payment.order_id).first())?.total_paisa ?? Infinity;
  const isPartialPrepay = metadata?.type === "partial_prepay" || payment.amount_paisa < orderTotalPaisa;
  const eventResult = await env.DB.prepare(
    `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
     VALUES (?1, ?2, ?3, 'webhook', ?4, ?5, ?6)`
  ).bind(crypto.randomUUID(), payment.id, invoiceId, isPartialPrepay ? "partially_paid" : "paid", rawResponse, now).run();
  if (eventResult.meta.changes !== 1) return Response.json({ received: true, status: "duplicate" }, { status: 200 });
  const paidResult = await env.DB.prepare(
    `UPDATE payments SET status = 'paid', verified_at = ?2, updated_at = ?2
     WHERE id = ?1 AND status IN ('created','pending','processing')`
  ).bind(payment.id, now).run();
  if (paidResult.meta.changes !== 1) return Response.json({ error: "Payment already confirmed" }, { status: 409 });
  if (isPartialPrepay) {
    await env.DB.prepare(
      `UPDATE orders SET payment_status = 'partially_paid', updated_at = ?2 WHERE id = ?1`
    ).bind(payment.order_id, now).run();
    return Response.json({ received: true, status: "partially_paid" }, { status: 200 });
  }
  const reservations = await env.DB.prepare(
    `SELECT id, variant_id, quantity, status FROM stock_reservations
     WHERE order_id = ?1 AND status = 'active'`
  ).bind(payment.order_id).all();
  if (reservations.results && reservations.results.length > 0) {
    const deductStmts = reservations.results.map(
      (r) => env.DB.prepare(
        `UPDATE inventory_items
         SET reserved_quantity = reserved_quantity - ?1,
             quantity = quantity - ?1,
             updated_at = ?3
         WHERE variant_id = ?2 AND reserved_quantity >= ?1 AND quantity >= ?1`
      ).bind(r.quantity, r.variant_id, now)
    );
    const confirmStmts = reservations.results.map(
      (r) => env.DB.prepare(
        `UPDATE stock_reservations SET status = 'confirmed', updated_at = ?2 WHERE id = ?1`
      ).bind(r.id, now)
    );
    const orderStatusStmt = env.DB.prepare(
      `UPDATE orders SET payment_status = 'paid', status = 'payment_verified', updated_at = ?2 WHERE id = ?1`
    ).bind(payment.order_id, now);
    await env.DB.batch(
      [...deductStmts, ...confirmStmts, orderStatusStmt],
      { atomic: true }
    );
    const orderAfter = await env.DB.prepare(
      `SELECT status FROM orders WHERE id = ?1`
    ).bind(payment.order_id).first();
    if (orderAfter?.status === "payment_verified") {
      return Response.json({ received: true, status: "paid" }, { status: 200 });
    }
    await markPaidOverAllocated(env.DB, payment.order_id, payment.id, reservations.results, now);
    return Response.json({ received: true, status: "paid_over_allocated" }, { status: 200 });
  } else {
    const orderItems = await env.DB.prepare(
      `SELECT variant_id, quantity FROM order_items WHERE order_id = ?1`
    ).bind(payment.order_id).all();
    if (!orderItems.results || orderItems.results.length === 0) {
      return Response.json({ error: "No order items found" }, { status: 500 });
    }
    const atomicStmts = orderItems.results.map(
      (item) => env.DB.prepare(
        `UPDATE inventory_items
         SET quantity = quantity - ?1, updated_at = ?3
         WHERE variant_id = ?2 AND is_available = 1 AND (quantity - reserved_quantity) >= ?1`
      ).bind(item.quantity, item.variant_id, now)
    );
    const orderStatusStmt = env.DB.prepare(
      `UPDATE orders SET payment_status = 'paid', status = 'payment_verified', updated_at = ?2 WHERE id = ?1`
    ).bind(payment.order_id, now);
    await env.DB.batch(
      [...atomicStmts, orderStatusStmt],
      { atomic: true }
    );
    const orderAfter = await env.DB.prepare(
      `SELECT status FROM orders WHERE id = ?1`
    ).bind(payment.order_id).first();
    if (orderAfter?.status === "payment_verified") {
      return Response.json({ received: true, status: "paid" }, { status: 200 });
    }
    const fallbacks = orderItems.results.map(
      (item) => env.DB.prepare(
        `UPDATE inventory_items SET quantity = quantity - ?1, updated_at = ?3
         WHERE variant_id = ?2 AND is_available = 1 AND (quantity - reserved_quantity) >= ?1`
      ).bind(item.quantity, item.variant_id, now)
    );
    const fallbackResults = await env.DB.batch(fallbacks);
    const succeededItems = orderItems.results.filter((_, index) => fallbackResults[index]?.meta.changes === 1);
    const failedItems = orderItems.results.filter((_, index) => fallbackResults[index]?.meta.changes !== 1);
    if (succeededItems.length > 0) {
      const compensationApplied = await tryApplyCompensation(env.DB, payment.id, payment.order_id, succeededItems, now);
      if (!compensationApplied) {
        const rollbackStmts = succeededItems.map(
          (item) => env.DB.prepare(
            `UPDATE inventory_items SET quantity = quantity + ?1, updated_at = ?3 WHERE variant_id = ?2`
          ).bind(item.quantity, item.variant_id, now)
        );
        await env.DB.batch(rollbackStmts, { atomic: true });
      }
    }
    await env.DB.prepare(
      `UPDATE orders SET payment_status = 'paid', status = 'paid_over_allocated', updated_at = ?2 WHERE id = ?1`
    ).bind(payment.order_id, now).run();
    const failedVariant = failedItems[0]?.variant_id ?? orderItems.results[0].variant_id;
    await env.DB.prepare(
      `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
       VALUES (?1, ?2, 'paid_over_allocated for order. Sourcing/substitution/refund needed.', ?3)`
    ).bind(crypto.randomUUID(), failedVariant, now).run();
    return Response.json({ received: true, status: "paid_over_allocated" }, { status: 200 });
  }
}
async function markPaidOverAllocated(db, orderId, paymentId, reservations, now) {
  const reservationIds = reservations.map((r) => r.id);
  if (reservationIds.length === 0) return;
  const placeholders = reservationIds.map((_, i) => `?${i + 2}`).join(", ");
  await db.prepare(
    `UPDATE stock_reservations
     SET status = 'cancelled', updated_at = ?1
     WHERE order_id = ?1 AND status = 'active' AND id IN (${placeholders})`
  ).bind(now, orderId, ...reservationIds).run();
  await db.prepare(
    `UPDATE orders SET payment_status = 'paid', status = 'paid_over_allocated', updated_at = ?2 WHERE id = ?1`
  ).bind(orderId, now).run();
  const firstVariant = reservations[0]?.variant_id ?? "unknown";
  await db.prepare(
    `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
     VALUES (?1, ?2, 'paid_over_allocated for active reservation. Sourcing/substitution/refund needed.', ?3)`
  ).bind(crypto.randomUUID(), firstVariant, now).run();
  await db.prepare(
    `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
     VALUES (?1, ?2, ?3, 'compensation_applied', 'paid', 'paid_over_allocated', ?4)`
  ).bind(crypto.randomUUID(), paymentId, orderId, now).run();
}
async function tryApplyCompensation(db, paymentId, orderId, deductedItems, now) {
  const claim = await db.prepare(
    `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
     VALUES (?1, ?2, ?3, 'compensation_applied', 'paid', 'compensate', ?4)`
  ).bind(crypto.randomUUID(), paymentId, orderId, now).run();
  if (claim.meta.changes !== 1) return false;
  const compensateStmts = deductedItems.map(
    (item) => db.prepare(
      `UPDATE inventory_items SET quantity = quantity + ?1, updated_at = ?3 WHERE variant_id = ?2`
    ).bind(item.quantity, item.variant_id, now)
  );
  await db.batch(compensateStmts, { atomic: true });
  return true;
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
