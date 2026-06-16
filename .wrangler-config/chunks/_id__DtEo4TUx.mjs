globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
const prerender = false;
async function GET(context) {
  const env = getEnv();
  const paymentId = context.params.id;
  if (!paymentId) {
    return Response.json({ error: "Missing payment ID" }, { status: 400 });
  }
  const payment = await env.DB.prepare(
    `SELECT id, order_id, invoice_id, status, amount_paisa, created_at, verified_at
     FROM payments WHERE id = ?1`
  ).bind(paymentId).first();
  if (!payment) {
    return Response.json({ error: "Payment not found" }, { status: 404 });
  }
  return Response.json({ payment });
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
