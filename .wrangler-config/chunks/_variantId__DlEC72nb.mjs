globalThis.process ??= {};
globalThis.process.env ??= {};
import { env } from "cloudflare:workers";
const prerender = false;
async function GET(context) {
  const { params } = context;
  const env$1 = env;
  const variantId = params.variantId;
  if (!variantId || typeof variantId !== "string") {
    return Response.json({ error: "Invalid variant ID" }, { status: 400 });
  }
  const row = await env$1.DB.prepare(
    `SELECT (quantity - reserved_quantity) AS available
     FROM inventory_items
     WHERE variant_id = ?1 AND is_available = 1`
  ).bind(variantId).first();
  const available = Math.max(0, row?.available ?? 0);
  return new Response(JSON.stringify({ available, source: "d1-cdn-cached" }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=30, s-maxage=60"
    }
  });
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
