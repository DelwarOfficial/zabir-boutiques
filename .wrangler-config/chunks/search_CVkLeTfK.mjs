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
const $$Search = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Search;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "products.manage")) return new Response("Forbidden", { status: 403 });
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Product Search", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Product Search", "subtitle": "Quick product lookup by name, SKU, or category." })} ${renderComponent($$result2, "ComingSoon", $$ComingSoon, { "title": "Fast product lookup is planned", "description": "A dedicated search to find variants, prices, and live stock while talking to a customer." }, { "default": async ($$result3) => renderTemplate` ${maybeRenderHead()}<ul class="list-disc pl-5 space-y-1"> <li>Search by product name, SKU, or category</li> <li>See price and available stock at a glance</li> <li>Add directly to a new assisted order</li> </ul> ` })} ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/sales/search.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/sales/search.astro";
const $$url = "/staff/sales/search";
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
