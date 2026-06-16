globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, m as maybeRenderHead } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
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
  if (!can(user.role, "reports.view")) return new Response("Forbidden", { status: 403 });
  const env = getEnv();
  const [orderStats, revToday, topProducts, statusBreakdown] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) as total, COALESCE(SUM(total_paisa), 0) as revenue FROM orders`).first(),
    env.DB.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(total_paisa), 0) as revenue FROM orders WHERE date(created_at) = date('now')`).first(),
    env.DB.prepare(
      `SELECT oi.product_name, SUM(oi.quantity) as qty, SUM(oi.total_price_paisa) as rev
     FROM order_items oi GROUP BY oi.product_name ORDER BY rev DESC LIMIT 10`
    ).all(),
    env.DB.prepare(
      `SELECT status, COUNT(*) as count FROM orders GROUP BY status ORDER BY count DESC`
    ).all()
  ]);
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Reports", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Reports", "subtitle": "Revenue, top products, and order status breakdown." })} ${maybeRenderHead()}<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6"> <div class="bg-surface border border-line rounded-lg p-4"> <div class="text-[10px] uppercase tracking-wider text-muted">All Time Orders</div> <div class="text-2xl font-bold mt-1">${orderStats?.total ?? 0}</div> </div> <div class="bg-surface border border-line rounded-lg p-4"> <div class="text-[10px] uppercase tracking-wider text-muted">All Time Revenue</div> <div class="text-2xl font-bold mt-1">৳${Math.floor((orderStats?.revenue ?? 0) / 100)}</div> </div> <div class="bg-surface border border-line rounded-lg p-4"> <div class="text-[10px] uppercase tracking-wider text-muted">Today Orders</div> <div class="text-2xl font-bold mt-1">${revToday?.count ?? 0}</div> </div> <div class="bg-surface border border-line rounded-lg p-4"> <div class="text-[10px] uppercase tracking-wider text-muted">Today Revenue</div> <div class="text-2xl font-bold mt-1">৳${Math.floor((revToday?.revenue ?? 0) / 100)}</div> </div> </div> <div class="grid grid-cols-1 lg:grid-cols-2 gap-4"> <div class="bg-surface border border-line rounded-lg p-4"> <h2 class="text-xs font-semibold uppercase tracking-wider text-muted m-0 mb-3">Top Products</h2> ${topProducts.results?.length ? renderTemplate`<table class="w-full border-collapse text-sm"> <thead><tr class="border-b border-line text-left"> <th class="px-2 py-1.5 font-semibold">Product</th> <th class="px-2 py-1.5 font-semibold">Sold</th> <th class="px-2 py-1.5 font-semibold">Revenue</th> </tr></thead> <tbody>${topProducts.results.map((p) => renderTemplate`<tr class="border-b border-line-soft"> <td class="px-2 py-1.5">${p.product_name}</td> <td class="px-2 py-1.5">${p.qty}</td> <td class="px-2 py-1.5 font-semibold">৳${Math.floor(p.rev / 100)}</td> </tr>`)}</tbody> </table>` : renderTemplate`<p class="text-muted text-sm m-0">No data yet.</p>`} </div> <div class="bg-surface border border-line rounded-lg p-4"> <h2 class="text-xs font-semibold uppercase tracking-wider text-muted m-0 mb-3">Orders by Status</h2> ${statusBreakdown.results?.length ? renderTemplate`<table class="w-full border-collapse text-sm"> <thead><tr class="border-b border-line text-left"> <th class="px-2 py-1.5 font-semibold">Status</th> <th class="px-2 py-1.5 font-semibold">Count</th> </tr></thead> <tbody>${statusBreakdown.results.map((s) => renderTemplate`<tr class="border-b border-line-soft"> <td class="px-2 py-1.5">${s.status.replace(/_/g, " ")}</td> <td class="px-2 py-1.5 font-semibold">${s.count}</td> </tr>`)}</tbody> </table>` : renderTemplate`<p class="text-muted text-sm m-0">No data yet.</p>`} </div> </div> ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/reports/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/reports/index.astro";
const $$url = "/staff/reports";
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
