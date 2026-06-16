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
const $$Orders = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Orders;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "orders.view")) return new Response("Forbidden", { status: 403 });
  const env = getEnv();
  const orders = await env.DB.prepare(
    `SELECT id, order_number, name, phone, total_paisa, payment_method, status, order_channel, created_at
   FROM orders
   WHERE created_by = ?
   ORDER BY created_at DESC
   LIMIT 100`
  ).bind(user.id).all();
  const rows = orders.results ?? [];
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "My Orders", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "My Orders", "subtitle": `${rows.length} orders you created.` }, { "actions": async ($$result3) => renderTemplate`${renderComponent($$result3, "Fragment", Fragment, { "slot": "actions" }, { "default": async ($$result4) => renderTemplate` ${maybeRenderHead()}<a href="/staff/sales/new" class="px-3 py-1.5 bg-brand text-white rounded-md text-xs font-semibold no-underline">+ New Order</a> ` })}` })} ${rows.length > 0 ? renderTemplate`<div class="overflow-x-auto border border-line rounded-lg"> <table class="w-full border-collapse text-sm"> <thead> <tr class="bg-surface-soft text-left"> <th class="px-3 py-2.5 font-semibold">Order</th> <th class="px-3 py-2.5 font-semibold">Customer</th> <th class="px-3 py-2.5 font-semibold text-right">Total</th> <th class="px-3 py-2.5 font-semibold">Channel</th> <th class="px-3 py-2.5 font-semibold">Status</th> <th class="px-3 py-2.5 font-semibold">Date</th> </tr> </thead> <tbody> ${rows.map((o) => renderTemplate`<tr class="border-t border-line-soft"> <td class="px-3 py-2"><a${addAttribute(`/staff/orders/${o.id}`, "href")} class="text-brand font-semibold no-underline">${o.order_number}</a></td> <td class="px-3 py-2"> <div class="font-medium">${o.name}</div> <div class="text-xs text-muted">${o.phone}</div> </td> <td class="px-3 py-2 text-right font-medium">৳${Math.floor(o.total_paisa / 100)}</td> <td class="px-3 py-2"><span class="text-[10px] px-1.5 py-0.5 rounded bg-line-soft text-ink-secondary">${o.order_channel ?? "web"}</span></td> <td class="px-3 py-2"><span class="text-[10px] px-1.5 py-0.5 rounded bg-line-soft text-ink-secondary">${o.status.replace(/_/g, " ")}</span></td> <td class="px-3 py-2 text-xs text-muted">${o.created_at?.split(" ")[0]}</td> </tr>`)} </tbody> </table> </div>` : renderTemplate`<div class="text-center text-muted text-sm py-12 border border-line rounded-lg border-dashed">
You haven't created any orders yet. Use <a href="/staff/sales/new" class="text-brand no-underline">Create Order</a> to get started.
</div>`}` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/sales/orders.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/sales/orders.astro";
const $$url = "/staff/sales/orders";
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $$Orders,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
