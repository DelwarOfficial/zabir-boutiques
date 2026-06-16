globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, m as maybeRenderHead } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { $ as $$PageHeader } from "./PageHeader_93CCipe8.mjs";
import { g as getCurrentStaffUser, f as can } from "./rbac_cfH-YcoZ.mjs";
const prerender = false;
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Index;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "orders.view")) return new Response("Forbidden", { status: 403 });
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Sales Dashboard", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Sales Dashboard", "subtitle": "Quick access for sales staff." })} ${maybeRenderHead()}<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"> <a href="/staff/sales/new" class="bg-brand text-white rounded-lg p-4 no-underline hover:opacity-90 transition-opacity"> <div class="font-semibold text-sm">Create Order</div> <div class="text-xs opacity-80 mt-1">Phone / Messenger / WhatsApp</div> </a> <a href="/staff/sales/instore" class="bg-surface border border-line rounded-lg p-4 no-underline hover:bg-surface-soft transition-colors"> <div class="font-semibold text-sm text-ink">In-Store Sale</div> <div class="text-xs text-muted mt-1">Walk-in POS — auto-confirmed</div> </a> <a href="/staff/sales/orders" class="bg-surface border border-line rounded-lg p-4 no-underline hover:bg-surface-soft transition-colors"> <div class="font-semibold text-sm text-ink">My Orders</div> <div class="text-xs text-muted mt-1">Track orders you created</div> </a> <a href="/staff/sales/search" class="bg-surface border border-line rounded-lg p-4 no-underline hover:bg-surface-soft transition-colors"> <div class="font-semibold text-sm text-ink">Product Search</div> <div class="text-xs text-muted mt-1">Quick lookup while on a call</div> </a> <a href="/staff/sales/notes" class="bg-surface border border-line rounded-lg p-4 no-underline hover:bg-surface-soft transition-colors"> <div class="font-semibold text-sm text-ink">Customer Notes</div> <div class="text-xs text-muted mt-1">Shared notes per customer</div> </a> </div> <p class="text-xs text-muted mt-5">All created orders flow into the main Orders queue for manager review and packing.</p> ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/sales/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/sales/index.astro";
const $$url = "/staff/sales";
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
