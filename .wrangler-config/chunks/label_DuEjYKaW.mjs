globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { r as requireAuth, a as requirePermission, R as RbacError } from "./rbac_cfH-YcoZ.mjs";
const prerender = false;
async function GET(context) {
  const env = getEnv();
  const orderId = context.params.id;
  if (!orderId) return Response.json({ error: "Missing order ID" }, { status: 400 });
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "orders.view");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }
  const order = await env.DB.prepare(
    `SELECT order_number, name, phone, address, payment_method, total_paisa,
            advance_paisa, balance_paisa, status, payment_status
     FROM orders WHERE id = ?1`
  ).bind(orderId).first();
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  let paymentLabel = "COD";
  if (order.payment_method === "in_store") paymentLabel = "PAID (In-Store)";
  else if (order.payment_method === "uddoktapay" && order.payment_status === "paid") paymentLabel = "PAID (Online)";
  else if (order.advance_paisa > 0 && order.balance_paisa > 0) paymentLabel = `PARTIALLY PAID (৳${Math.floor(order.advance_paisa / 100)} paid, ৳${Math.floor(order.balance_paisa / 100)} COD)`;
  else if (order.payment_method === "uddoktapay") paymentLabel = "PENDING PAYMENT";
  const totalTaka = `৳${Math.floor(order.total_paisa / 100)}`;
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Label - ${escapeHtml(order.order_number)}</title>
<style>
  @page { size: 210mm 99mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; }
  .label {
    width: 210mm; height: 99mm;
    padding: 6mm 8mm;
    border: 1px dashed #999;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 3mm;
  }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #333; padding-bottom: 3mm; }
  .brand { font-weight: 900; font-size: 14pt; }
  .order-num { font-size: 12pt; font-weight: 700; font-family: monospace; }
  .body { display: grid; grid-template-columns: 1fr auto; gap: 5mm; }
  .customer { font-size: 13pt; }
  .customer .name { font-weight: 900; font-size: 16pt; margin-bottom: 2mm; }
  .customer .phone { font-size: 14pt; font-weight: 700; margin-bottom: 2mm; }
  .customer .address { font-size: 11pt; line-height: 1.4; color: #333; }
  .payment-box { text-align: right; }
  .payment-box .total { font-size: 16pt; font-weight: 900; }
  .payment-box .status { font-size: 10pt; font-weight: 700; margin-top: 2mm; padding: 1mm 3mm; border: 1px solid #333; display: inline-block; }
  .footer { border-top: 1px solid #999; padding-top: 2mm; font-size: 9pt; color: #666; text-align: center; }
  @media print { body { margin: 0; } .label { border: none; } }
</style>
</head>
<body>
<div class="label">
  <div class="header">
    <span class="brand">ZABIR BOUTIQUES</span>
    <span class="order-num">${escapeHtml(order.order_number)}</span>
  </div>
  <div class="body">
    <div class="customer">
      <div class="name">${escapeHtml(order.name)}</div>
      <div class="phone">${escapeHtml(order.phone)}</div>
      <div class="address">${escapeHtml(order.address)}</div>
    </div>
    <div class="payment-box">
      <div class="total">${escapeHtml(totalTaka)}</div>
      <div class="status">${escapeHtml(paymentLabel)}</div>
    </div>
  </div>
  <div class="footer">Zabir Boutiques — Wari, Dhaka — +880 1985-516000</div>
</div>
<script>window.print();<\/script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="label-${order.order_number}.html"`
    }
  });
}
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  GET,
  prerender
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
