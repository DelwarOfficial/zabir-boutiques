globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, F as Fragment, m as maybeRenderHead, b as addAttribute } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { $ as $$PageHeader } from "./PageHeader_93CCipe8.mjs";
import { g as getCurrentStaffUser, f as can } from "./rbac_cfH-YcoZ.mjs";
import { g as getEnv } from "./env_BNqnkDbh.mjs";
const prerender = false;
const $$id = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$id;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "products.manage")) return new Response("Forbidden", { status: 403 });
  const env = getEnv();
  const { id } = Astro2.params;
  if (!id) return new Response("Missing product ID", { status: 400 });
  const product = await env.DB.prepare(
    `SELECT p.*, c.name as category_name
   FROM products p
   LEFT JOIN categories c ON c.id = p.category_id
   WHERE p.id = ?`
  ).bind(id).first();
  if (!product) return new Response("Product not found", { status: 404 });
  const variants = await env.DB.prepare(
    `SELECT pv.id, pv.sku, pv.size, pv.color, pv.price_paisa, pv.is_deleted,
          ii.quantity, ii.reserved_quantity, (ii.quantity - ii.reserved_quantity) as available
   FROM product_variants pv
   LEFT JOIN inventory_items ii ON ii.variant_id = pv.id
   WHERE pv.product_id = ?
   ORDER BY pv.is_deleted ASC, pv.size ASC`
  ).bind(id).all();
  const images = await env.DB.prepare(
    `SELECT id, r2_key, is_compressed, sort_order, created_at
   FROM product_images WHERE product_id = ? ORDER BY sort_order ASC LIMIT 20`
  ).bind(id).all();
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": product.name, "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": product.name, "subtitle": `${product.category_name || "Uncategorized"} · ${product.status}` }, { "actions": async ($$result3) => renderTemplate`${renderComponent($$result3, "Fragment", Fragment, { "slot": "actions" }, { "default": async ($$result4) => renderTemplate` ${maybeRenderHead()}<span${addAttribute(`px-2 py-1 rounded text-[10px] font-semibold ${product.status === "published" ? "bg-green-100 text-green-800" : product.status === "archived" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`, "class")}>${product.status}</span> ` })}` })} <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6"> <div class="lg:col-span-2 bg-surface border border-line rounded-lg p-4"> <h2 class="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Product Info</h2> <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm"> <span class="text-muted">Name</span><span class="font-medium">${product.name}</span> <span class="text-muted">Slug</span><span class="font-mono text-xs">${product.slug}</span> <span class="text-muted">Price</span><span class="font-semibold">৳${Math.floor(product.price_paisa / 100)}</span> ${product.compare_price_paisa && renderTemplate`${renderComponent($$result2, "Fragment", Fragment, {}, { "default": async ($$result3) => renderTemplate`<span class="text-muted">Compare</span><span class="line-through text-muted">৳${Math.floor(product.compare_price_paisa / 100)}</span>` })}`} <span class="text-muted">Featured</span><span>${product.is_featured ? "⭐ Yes" : "No"}</span> <span class="text-muted">Created</span><span class="text-xs text-muted">${product.created_at}</span> </div> ${product.description && renderTemplate`<p class="mt-3 text-sm text-ink-secondary">${product.description}</p>`} </div> <div class="bg-surface border border-line rounded-lg p-4"> <h2 class="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Images (${images.results?.length || 0})</h2> ${images.results?.length ? renderTemplate`<div class="space-y-2 text-xs"> ${images.results.map((img) => renderTemplate`<div class="flex justify-between items-center p-2 bg-surface-soft rounded"> <span class="font-mono truncate max-w-[150px]"${addAttribute(img.r2_key, "title")}>${img.r2_key.split("/").pop()}</span> <span${addAttribute(`px-1.5 py-0.5 rounded text-[9px] ${img.is_compressed ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`, "class")}>${img.is_compressed ? "Compressed" : "Original"}</span> </div>`)} </div>` : renderTemplate`<p class="text-muted text-sm">No images uploaded.</p>`} </div> </div> <div class="bg-surface border border-line rounded-lg p-4"> <h2 class="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Variants & Inventory</h2> ${variants.results?.length ? renderTemplate`<div class="overflow-x-auto"> <table class="w-full border-collapse text-sm"> <thead><tr class="bg-surface-soft text-left"> <th class="px-3 py-2 font-semibold">SKU</th> <th class="px-3 py-2 font-semibold">Size</th> <th class="px-3 py-2 font-semibold">Color</th> <th class="px-3 py-2 font-semibold text-right">Price</th> <th class="px-3 py-2 font-semibold text-center">Stock</th> <th class="px-3 py-2 font-semibold text-center">Reserved</th> <th class="px-3 py-2 font-semibold text-center">Available</th> <th class="px-3 py-2 font-semibold text-center">Status</th> </tr></thead> <tbody> ${variants.results.map((v) => renderTemplate`<tr${addAttribute(`border-t border-line-soft ${v.is_deleted ? "opacity-50" : ""}`, "class")}> <td class="px-3 py-2 font-mono text-xs">${v.sku || "—"}</td> <td class="px-3 py-2">${v.size || "—"}</td> <td class="px-3 py-2">${v.color || "—"}</td> <td class="px-3 py-2 text-right font-medium">৳${Math.floor(v.price_paisa / 100)}</td> <td class="px-3 py-2 text-center">${v.quantity ?? "—"}</td> <td class="px-3 py-2 text-center text-muted">${v.reserved_quantity ?? 0}</td> <td class="px-3 py-2 text-center"> <span${addAttribute(`font-semibold ${(v.available ?? 0) === 0 ? "text-red-600" : (v.available ?? 0) < 5 ? "text-amber-500" : "text-green-600"}`, "class")}>${v.available ?? 0}</span> </td> <td class="px-3 py-2 text-center"> <span${addAttribute(`text-[10px] px-1.5 py-0.5 rounded ${v.is_deleted ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`, "class")}>${v.is_deleted ? "Deleted" : "Active"}</span> </td> </tr>`)} </tbody> </table> </div>` : renderTemplate`<p class="text-muted text-sm">No variants found.</p>`} </div> <div class="mt-4"> <a href="/staff/products" class="text-sm text-muted no-underline hover:underline">&larr; Back to products</a> </div> ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/products/[id].astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/products/[id].astro";
const $$url = "/staff/products/[id]";
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $$id,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
