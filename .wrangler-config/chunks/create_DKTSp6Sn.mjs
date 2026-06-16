globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
const prerender = false;
async function POST(context) {
  const env = getEnv();
  const now = nowSql();
  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const orderId = body.order_id;
  if (!orderId) return Response.json({ error: "Missing order_id" }, { status: 400 });
  const order = await env.DB.prepare(
    `SELECT id, total_paisa, advance_paisa, payment_method, payment_status FROM orders WHERE id = ?1`
  ).bind(orderId).first();
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  if (!["uddoktapay", "partial_prepay"].includes(order.payment_method)) {
    return Response.json({ error: "Order is not set for online payment" }, { status: 400 });
  }
  if (order.payment_status === "paid" || order.payment_status === "partially_paid") {
    return Response.json({ error: "Order is already paid" }, { status: 409 });
  }
  if (order.payment_status !== "created" && order.payment_status !== "pending") {
    return Response.json({ error: "Payment cannot be initiated for this order" }, { status: 409 });
  }
  const paymentAmountPaisa = order.payment_method === "partial_prepay" ? order.advance_paisa : order.total_paisa;
  const existing = await env.DB.prepare(
    `SELECT id, invoice_id, checkout_url, status FROM payments
     WHERE order_id = ?1 AND status IN ('created','pending','processing')
     ORDER BY created_at DESC LIMIT 1`
  ).bind(orderId).first();
  if (existing && existing.checkout_url) {
    return Response.json(
      { ok: true, payment_id: existing.id, checkout_url: existing.checkout_url, invoice_id: existing.invoice_id, reused: true },
      { status: 200 }
    );
  }
  const invoiceId = crypto.randomUUID();
  const checkoutRes = await fetch(`${env.UDDOKTAPAY_BASE_URL}/api/checkout`, {
    method: "POST",
    headers: {
      "RT-UDDOKTAPAY-API-KEY": env.UDDOKTAPAY_API_KEY,
      "accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      invoice_id: invoiceId,
      amount: (paymentAmountPaisa / 100).toFixed(2),
      currency: "BDT",
      customer_name: body.customer_name ?? "",
      customer_phone: body.customer_phone ?? "",
      // Bind the invoice to this order so the webhook can reconcile it.
      metadata: { order_id: orderId, type: order.payment_method === "partial_prepay" ? "partial_prepay" : "full" },
      redirect_url: `${body.redirect_url ?? env.PUBLIC_SITE_URL}/order-track`,
      cancel_url: `${body.cancel_url ?? env.PUBLIC_SITE_URL}/checkout`
    })
  });
  const checkoutData = await checkoutRes.json().catch(() => ({}));
  if (!checkoutRes.ok || !checkoutData?.payment_url) {
    console.error("[payments/create] provider error:", checkoutRes.status, JSON.stringify(checkoutData));
    return Response.json({ error: "Payment provider error" }, { status: 502 });
  }
  const paymentId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO payments (id, order_id, invoice_id, provider, amount_paisa, status, checkout_url, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'uddoktapay', ?4, 'pending', ?5, ?6, ?6)`
  ).bind(paymentId, orderId, invoiceId, paymentAmountPaisa, checkoutData.payment_url, now).run();
  await env.DB.prepare(
    `UPDATE orders SET payment_status = 'pending', updated_at = ?2 WHERE id = ?1`
  ).bind(orderId, now).run();
  return Response.json({ ok: true, payment_id: paymentId, checkout_url: checkoutData.payment_url, invoice_id: invoiceId }, { status: 201 });
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
