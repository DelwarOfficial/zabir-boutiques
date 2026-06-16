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
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Index;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "support.view")) return new Response("Forbidden", { status: 403 });
  const env = getEnv();
  const recent = await env.DB.prepare(
    `SELECT o.id, o.order_number, o.name, o.phone, o.total_paisa, o.status, o.created_at
   FROM orders o ORDER BY o.created_at DESC LIMIT 20`
  ).all();
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Support", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Support", "subtitle": "Recent orders and customer support tools." }, { "actions": async ($$result3) => renderTemplate`${maybeRenderHead()}<a href="/staff/support/search" class="px-3 py-1.5 bg-brand text-white rounded-md text-xs font-semibold no-underline">Search Orders</a>` })} <div class="overflow-x-auto border border-line rounded-lg"> <table class="w-full border-collapse text-sm"> <thead><tr class="bg-surface-soft text-left"> <th class="px-3 py-2.5 font-semibold">Order</th> <th class="px-3 py-2.5 font-semibold">Customer</th> <th class="px-3 py-2.5 font-semibold">Total</th> <th class="px-3 py-2.5 font-semibold">Status</th> <th class="px-3 py-2.5 font-semibold">Date</th> </tr></thead> <tbody> ${recent.results?.length ? recent.results.map((o) => renderTemplate`<tr class="border-t border-line-soft"> <td class="px-3 py-2"><a${addAttribute(`/staff/orders/${o.id}`, "href")} class="text-brand no-underline font-semibold">${o.order_number}</a></td> <td class="px-3 py-2">${o.name}<br><span class="text-xs text-muted">${o.phone}</span></td> <td class="px-3 py-2 font-semibold">৳${Math.floor(o.total_paisa / 100)}</td> <td class="px-3 py-2"><span class="text-[10px] px-1.5 py-0.5 rounded bg-line-soft text-ink-secondary">${o.status.replace(/_/g, " ")}</span></td> <td class="px-3 py-2 text-xs text-muted">${o.created_at?.split(" ")[0]}</td> </tr>`) : renderTemplate`<tr><td colspan="5" class="px-4 py-8 text-center text-muted">No orders yet.</td></tr>`} </tbody> </table> </div> ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/support/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/support/index.astro";
const $$url = "/staff/support";
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
