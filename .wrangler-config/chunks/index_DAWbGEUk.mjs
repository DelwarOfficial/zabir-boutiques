globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, m as maybeRenderHead, b as addAttribute } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { r as renderScript } from "./script_CSzDbyjI.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { $ as $$PageHeader } from "./PageHeader_93CCipe8.mjs";
import { g as getCurrentStaffUser, f as can } from "./rbac_cfH-YcoZ.mjs";
import { g as getEnv } from "./env_BNqnkDbh.mjs";
const prerender = false;
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Index;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "products.manage")) return new Response("Forbidden", { status: 403 });
  const env = getEnv();
  const products = await env.DB.prepare(
    `SELECT p.id, p.name, p.slug, p.price_paisa, p.compare_price_paisa, p.status, p.is_featured, p.created_at,
          c.name as category_name,
          (SELECT COUNT(*) FROM product_variants WHERE product_id = p.id AND is_deleted = 0) as variant_count,
          (SELECT COALESCE(SUM(quantity), 0) FROM inventory_items ii JOIN product_variants pv ON pv.id = ii.variant_id WHERE pv.product_id = p.id) as total_stock
   FROM products p
   LEFT JOIN categories c ON c.id = p.category_id
   ORDER BY p.created_at DESC
   LIMIT 200`
  ).all();
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Products", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Products", "subtitle": `${products.results?.length || 0} products` })} ${maybeRenderHead()}<div class="overflow-x-auto border border-line rounded-lg mb-6"> <table class="w-full border-collapse text-sm"> <thead> <tr class="bg-surface-soft text-left"> <th class="px-3 py-2.5 font-semibold">Name</th> <th class="px-3 py-2.5 font-semibold">Category</th> <th class="px-3 py-2.5 font-semibold">Price</th> <th class="px-3 py-2.5 font-semibold">Compare</th> <th class="px-3 py-2.5 font-semibold text-center">Variants</th> <th class="px-3 py-2.5 font-semibold text-center">Stock</th> <th class="px-3 py-2.5 font-semibold">Status</th> <th class="px-3 py-2.5 font-semibold text-center">Featured</th> </tr> </thead> <tbody> ${products.results?.length ? products.results.map((p) => renderTemplate`<tr class="border-t border-line-soft"> <td class="px-3 py-2.5"> <a${addAttribute(`/staff/products/${p.id}`, "href")} class="text-brand no-underline font-semibold">${p.name}</a> </td> <td class="px-3 py-2.5 text-muted">${p.category_name || "—"}</td> <td class="px-3 py-2.5 font-semibold">৳${Math.floor(p.price_paisa / 100)}</td> <td class="px-3 py-2.5 text-muted">${p.compare_price_paisa ? `৳${Math.floor(p.compare_price_paisa / 100)}` : "—"}</td> <td class="px-3 py-2.5 text-center">${p.variant_count}</td> <td class="px-3 py-2.5 text-center"> <span${addAttribute(`font-semibold ${p.total_stock === 0 ? "text-red-600" : p.total_stock < 20 ? "text-amber-500" : "text-green-600"}`, "class")}>${p.total_stock}</span> </td> <td class="px-3 py-2.5"> <span${addAttribute(`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${p.status === "published" ? "bg-green-100 text-green-800" : p.status === "archived" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`, "class")}>${p.status}</span> </td> <td class="px-3 py-2.5 text-center">${p.is_featured ? "⭐" : "—"}</td> </tr>`) : renderTemplate`<tr><td colspan="8" class="px-4 py-8 text-center text-muted">No products found.</td></tr>`} </tbody> </table> </div> <div class="border border-line rounded-lg p-5 mt-2"> <h2 class="text-base font-semibold m-0 mb-4">AI Content Generator</h2> <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4"> <div> <label class="block text-xs text-ink-secondary mb-1">Product Name *</label> <input id="aiProductName" type="text" placeholder="e.g. Printed Cotton Kurti" class="w-full px-3 py-2 border border-line rounded-md text-sm bg-bg text-ink box-border"> </div> <div> <label class="block text-xs text-ink-secondary mb-1">Category</label> <input id="aiCategory" type="text" placeholder="e.g. Women's Fashion" class="w-full px-3 py-2 border border-line rounded-md text-sm bg-bg text-ink box-border"> </div> <div> <label class="block text-xs text-ink-secondary mb-1">Price (paisa)</label> <input id="aiPrice" type="number" placeholder="e.g. 129900" class="w-full px-3 py-2 border border-line rounded-md text-sm bg-bg text-ink box-border"> </div> <div> <label class="block text-xs text-ink-secondary mb-1">Key Features (comma-separated)</label> <input id="aiFeatures" type="text" placeholder="e.g. Soft fabric, Premium stitch" class="w-full px-3 py-2 border border-line rounded-md text-sm bg-bg text-ink box-border"> </div> </div> <button id="aiGenerateBtn" class="px-4 py-2 bg-brand text-white rounded-md text-sm font-semibold border-0 cursor-pointer disabled:opacity-50" onclick="generateContent()">Generate with AI</button> <div id="aiResult" class="hidden mt-4 border border-line rounded-lg p-4 bg-surface-soft text-sm whitespace-pre-wrap"></div> <div id="aiError" class="hidden mt-4 text-red-700 text-sm"></div> </div> ` })} ${renderScript($$result, "D:/Antigravity/zabir-boutiques/src/pages/staff/products/index.astro?astro&type=script&index=0&lang.ts")}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/products/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/products/index.astro";
const $$url = "/staff/products";
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
