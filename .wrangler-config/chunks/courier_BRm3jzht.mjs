globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, m as maybeRenderHead } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { $ as $$PageHeader } from "./PageHeader_93CCipe8.mjs";
import { $ as $$ComingSoon } from "./ComingSoon_uVxpAChw.mjs";
import { g as getCurrentStaffUser, f as can } from "./rbac_cfH-YcoZ.mjs";
const prerender = false;
const $$Courier = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Courier;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "orders.ship")) return new Response("Forbidden", { status: 403 });
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Courier Handoff", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Courier Handoff", "subtitle": "Hand packed orders to the courier for delivery." })} ${renderComponent($$result2, "ComingSoon", $$ComingSoon, { "title": "Courier handoff flow is planned", "description": "Mark parcels as dispatched and record which courier took them, in one pass." }, { "default": async ($$result3) => renderTemplate` ${maybeRenderHead()}<ul class="list-disc pl-5 space-y-1"> <li>Move packed orders to shipped in bulk</li> <li>Record courier name and tracking reference</li> <li>Auto-update order status and customer-facing tracking</li> </ul> ` })} ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/packing/courier.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/packing/courier.astro";
const $$url = "/staff/packing/courier";
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $$Courier,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
