globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { n as normalizeBangladeshPhone } from "./phone_DlB2NzV4.mjs";
const prerender = false;
const phoneErrorMessage = "Invalid Bangladeshi mobile number. Enter 11 digits starting with 01X.";
async function POST(context) {
  const env = getEnv();
  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const phoneResult = normalizeBangladeshPhone(body.phone ?? "");
  if (!phoneResult.ok) {
    return Response.json({ error: phoneResult.reason === "EMPTY" ? "Missing phone" : phoneErrorMessage }, { status: 400 });
  }
  const orderNumber = body.order_number;
  if (!orderNumber || typeof orderNumber !== "string") {
    return Response.json({ error: "Missing order_number" }, { status: 400 });
  }
  const order = await env.DB.prepare(
    `SELECT order_number, status, payment_status, total_paisa, created_at, updated_at
     FROM orders
     WHERE order_number = ?1 AND phone = ?2`
  ).bind(orderNumber, phoneResult.phone).first();
  if (!order) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }
  return Response.json({ order });
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
