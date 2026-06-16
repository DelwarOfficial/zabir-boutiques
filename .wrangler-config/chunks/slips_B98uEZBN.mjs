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
const $$Slips = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Slips;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "orders.pack")) return new Response("Forbidden", { status: 403 });
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Print Slips", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Print Slips", "subtitle": "Print packing slips and shipping labels." })} ${renderComponent($$result2, "ComingSoon", $$ComingSoon, { "title": "Batch slip printing is planned", "description": "Print packing slips and the 3-up A4 shipping labels for a batch of orders at once." }, { "default": async ($$result3) => renderTemplate` ${maybeRenderHead()}<ul class="list-disc pl-5 space-y-1"> <li>Select multiple orders and print together</li> <li>Three labels per A4 sheet for efficient courier prep</li> <li>Single-label printing already available on each order detail page</li> </ul> ` })} ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/packing/slips.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/packing/slips.astro";
const $$url = "/staff/packing/slips";
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $$Slips,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
