globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, m as maybeRenderHead, b as addAttribute } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { $ as $$PageHeader } from "./PageHeader_93CCipe8.mjs";
import { g as getCurrentStaffUser, f as can } from "./rbac_cfH-YcoZ.mjs";
import { g as getEnv } from "./env_BNqnkDbh.mjs";
const prerender = false;
const $$Search = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Search;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "orders.view")) return new Response("Forbidden", { status: 403 });
  const env = getEnv();
  const errors = [];
  const { searchParams } = new URL(Astro2.request.url);
  const q = searchParams.get("q") || "";
  let results = [];
  if (q) {
    const like = `%${q}%`;
    const rows = await env.DB.prepare(
      `SELECT o.id, o.order_number, o.name, o.phone, o.total_paisa, o.status, o.created_at
     FROM orders o
     WHERE o.order_number LIKE ? OR o.name LIKE ? OR o.phone LIKE ?
     ORDER BY o.created_at DESC LIMIT 50`
    ).bind(like, like, like).all();
    results = rows.results || [];
  }
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Order Search", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Order Search", "subtitle": "Find orders by number, name, or phone." })} ${maybeRenderHead()}<form method="get" class="flex gap-2 mb-5"> <input type="text" name="q"${addAttribute(q, "value")} placeholder="Search by order#, name, or phone..." class="flex-1 px-3 py-2 border border-line rounded-md text-sm bg-bg text-ink box-border"> <button type="submit" class="px-4 py-2 bg-brand text-white rounded-md text-sm font-semibold border-0 cursor-pointer">Search</button> </form> ${errors.length > 0 && renderTemplate`<div class="bg-red-100 text-red-800 px-3 py-2 rounded-md text-sm mb-4">${errors.join(", ")}</div>`}${q && renderTemplate`<p class="text-sm text-muted mb-3">${results.length} result(s) for "${q}"</p>`}${results.length > 0 && renderTemplate`<div class="overflow-x-auto border border-line rounded-lg"> <table class="w-full border-collapse text-sm"> <thead><tr class="bg-surface-soft text-left"> <th class="px-3 py-2.5 font-semibold">Order</th> <th class="px-3 py-2.5 font-semibold">Customer</th> <th class="px-3 py-2.5 font-semibold">Total</th> <th class="px-3 py-2.5 font-semibold">Status</th> <th class="px-3 py-2.5 font-semibold">Date</th> </tr></thead> <tbody>${results.map((o) => renderTemplate`<tr class="border-t border-line-soft"> <td class="px-3 py-2"><a${addAttribute(`/staff/orders/${o.id}`, "href")} class="text-brand no-underline font-semibold">${o.order_number}</a></td> <td class="px-3 py-2">${o.name}<br><span class="text-xs text-muted">${o.phone}</span></td> <td class="px-3 py-2 font-semibold">৳${Math.floor(o.total_paisa / 100)}</td> <td class="px-3 py-2"><span class="text-[10px] px-1.5 py-0.5 rounded bg-line-soft text-ink-secondary">${o.status.replace(/_/g, " ")}</span></td> <td class="px-3 py-2 text-xs text-muted">${o.created_at?.split(" ")[0]}</td> </tr>`)}</tbody> </table> </div>`}${q && results.length === 0 && renderTemplate`<p class="text-muted text-sm">No orders match your search.</p>`}` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/support/search.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/support/search.astro";
const $$url = "/staff/support/search";
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $$Search,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
