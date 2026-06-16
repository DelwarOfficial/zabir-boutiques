globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, m as maybeRenderHead, b as addAttribute } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { r as renderScript } from "./script_CSzDbyjI.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { g as getCurrentStaffUser, f as can } from "./rbac_cfH-YcoZ.mjs";
import { g as getEnv } from "./env_BNqnkDbh.mjs";
const prerender = false;
const $$New = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$New;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "orders.create")) return new Response("Forbidden", { status: 403 });
  const env = getEnv();
  const variants = await env.DB.prepare(
    `SELECT pv.id, pv.sku, pv.size, pv.price_paisa, p.name as product_name, p.id as product_id,
          ii.quantity, ii.reserved_quantity, (ii.quantity - ii.reserved_quantity) as available
   FROM product_variants pv
   JOIN products p ON p.id = pv.product_id
   JOIN inventory_items ii ON ii.variant_id = pv.id
   WHERE pv.is_deleted = 0 AND p.status = 'published' AND ii.quantity > ii.reserved_quantity
   ORDER BY p.name`
  ).all();
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Create Order", "user": user }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<h1 class="m-0 mb-4 text-xl font-bold">Create Order</h1> <div class="grid grid-cols-1 lg:grid-cols-2 gap-4"> <div class="bg-surface border border-line rounded-lg p-4"> <h2 class="text-xs font-semibold uppercase tracking-wider text-muted m-0 mb-4">Customer Details</h2> <form action="/api/staff/orders/create" method="post" class="flex flex-col gap-3"> <input type="text" name="name" placeholder="Customer name" required class="control"> <input type="tel" name="phone" placeholder="Phone (e.g. 01712345678)" required class="control" pattern="[0-9+\s\-]{10,15}" title="Bangladeshi mobile: 01XXXXXXXXX or +8801XXXXXXXXX"> <textarea name="address" placeholder="Delivery address" required class="control min-h-[60px]"></textarea> <select name="channel" class="control"> <option value="phone">Phone Order</option> <option value="whatsapp">WhatsApp</option> <option value="messenger">Messenger</option> <option value="in_store">In-Store</option> </select> <button type="submit" class="mt-1 py-2.5 bg-brand text-white rounded-lg font-semibold text-sm border-0 cursor-pointer">Submit Order</button> </form> </div> <div class="bg-surface border border-line rounded-lg p-4"> <h2 class="text-xs font-semibold uppercase tracking-wider text-muted m-0 mb-4">Available Variants (select + set qty)</h2> <form id="variants-form" class="max-h-[380px] overflow-y-auto"> <table class="w-full border-collapse text-xs"> <thead><tr class="border-b border-line text-left"> <th class="px-2 py-1.5">Product</th> <th class="px-2 py-1.5">Size</th> <th class="px-2 py-1.5">Price</th> <th class="px-2 py-1.5">Qty</th> </tr></thead> <tbody> ${variants.results?.map((v) => renderTemplate`<tr class="border-b border-line-soft"> <td class="px-2 py-1.5">${v.product_name}</td> <td class="px-2 py-1.5 text-muted">${v.size || "—"}</td> <td class="px-2 py-1.5">৳${Math.floor(v.price_paisa / 100)}</td> <td class="px-2 py-1.5"> <input type="number" class="variant-qty w-14 px-1.5 py-1 border border-line rounded text-xs text-center bg-bg"${addAttribute(v.id, "data-variant-id")} min="0"${addAttribute(v.available, "max")} value="0"> </td> </tr>`)} </tbody> </table> </form> <p class="text-[10px] text-muted mt-2 m-0">Set quantities above. They will be included when you submit the order on the left.</p> </div> </div> ${renderScript($$result2, "D:/Antigravity/zabir-boutiques/src/pages/staff/sales/new.astro?astro&type=script&index=0&lang.ts")} ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/sales/new.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/sales/new.astro";
const $$url = "/staff/sales/new";
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $$New,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
