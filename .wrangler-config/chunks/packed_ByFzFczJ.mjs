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
const $$Packed = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Packed;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "orders.pack")) return new Response("Forbidden", { status: 403 });
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Packed Orders", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Packed Orders", "subtitle": "Orders packed and awaiting courier handoff." })} ${renderComponent($$result2, "ComingSoon", $$ComingSoon, { "title": "Packed-orders queue is planned", "description": "A focused list of orders already packed, ready to scan over to the courier." }, { "default": async ($$result3) => renderTemplate` ${maybeRenderHead()}<ul class="list-disc pl-5 space-y-1"> <li>See everything packed but not yet dispatched</li> <li>Batch-select for courier handoff</li> <li>Reprint a label if a parcel is repacked</li> </ul> ` })} ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/packing/packed.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/packing/packed.astro";
const $$url = "/staff/packing/packed";
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $$Packed,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
