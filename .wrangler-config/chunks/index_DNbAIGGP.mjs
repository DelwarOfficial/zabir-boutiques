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
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Index;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "orders.pack")) return new Response("Forbidden", { status: 403 });
  const env = getEnv();
  const queue = await env.DB.prepare(
    `SELECT o.id, o.order_number, o.name, o.phone, o.address, o.total_paisa,
          o.payment_method, o.advance_paisa, o.balance_paisa, o.status, o.created_at
   FROM orders o
   WHERE o.status IN ('staff_confirmed', 'packing')
   ORDER BY o.created_at ASC
   LIMIT 100`
  ).all();
  const rows = queue.results ?? [];
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Packing Queue", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Packing Queue", "subtitle": `${rows.length} orders ready to pack or in progress.` }, { "actions": async ($$result3) => renderTemplate`${renderComponent($$result3, "Fragment", Fragment, { "slot": "actions" }, { "default": async ($$result4) => renderTemplate` ${maybeRenderHead()}<a href="/staff/packing/packed" class="px-3 py-1.5 border border-line rounded-md text-xs no-underline hover:bg-surface-soft">Packed</a> <a href="/staff/packing/courier" class="px-3 py-1.5 border border-line rounded-md text-xs no-underline hover:bg-surface-soft">Courier</a> <a href="/staff/packing/slips" class="px-3 py-1.5 border border-line rounded-md text-xs no-underline hover:bg-surface-soft">Print Slips</a> ` })}` })} ${rows.length > 0 ? renderTemplate`<div class="overflow-x-auto border border-line rounded-lg"> <table class="w-full border-collapse text-sm"> <thead> <tr class="bg-surface-soft text-left"> <th class="px-3 py-2.5 font-semibold">Order</th> <th class="px-3 py-2.5 font-semibold">Customer</th> <th class="px-3 py-2.5 font-semibold">Address</th> <th class="px-3 py-2.5 font-semibold text-right">Total</th> <th class="px-3 py-2.5 font-semibold text-center">Payment</th> <th class="px-3 py-2.5 font-semibold text-center">Status</th> <th class="px-3 py-2.5 font-semibold">Label</th> </tr> </thead> <tbody> ${rows.map((o) => renderTemplate`<tr class="border-t border-line-soft"> <td class="px-3 py-2"> <a${addAttribute(`/staff/orders/${o.id}`, "href")} class="text-brand font-semibold no-underline">${o.order_number}</a> </td> <td class="px-3 py-2"> <div class="font-medium">${o.name}</div> <div class="text-xs text-muted">${o.phone}</div> </td> <td class="px-3 py-2 text-xs text-muted max-w-[200px] truncate"${addAttribute(o.address, "title")}>${o.address}</td> <td class="px-3 py-2 text-right font-medium">৳${Math.floor(o.total_paisa / 100)}</td> <td class="px-3 py-2 text-center"> ${o.payment_method === "in_store" ? renderTemplate`<span class="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-semibold">PAID</span>` : o.advance_paisa > 0 ? renderTemplate`<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">PARTIAL</span>` : renderTemplate`<span class="text-[10px] px-1.5 py-0.5 rounded bg-line-soft text-ink-secondary">COD</span>`} </td> <td class="px-3 py-2 text-center"> <span${addAttribute(`text-[10px] px-1.5 py-0.5 rounded font-semibold ${o.status === "packing" ? "bg-cyan-100 text-cyan-800" : "bg-amber-100 text-amber-800"}`, "class")}> ${o.status === "packing" ? "Packing" : "Ready"} </span> </td> <td class="px-3 py-2"> <a${addAttribute(`/api/staff/orders/${o.id}/label`, "href")} target="_blank" rel="noopener" class="text-[10px] px-2 py-1 border border-line rounded no-underline hover:bg-surface-soft">🏷️ Print</a> </td> </tr>`)} </tbody> </table> </div>` : renderTemplate`<div class="text-center text-muted text-sm py-12 border border-line rounded-lg border-dashed">
All clear — no orders waiting to be packed.
</div>`}` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/packing/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/packing/index.astro";
const $$url = "/staff/packing";
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
