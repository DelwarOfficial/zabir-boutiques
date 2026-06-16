globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, m as maybeRenderHead } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { r as renderScript } from "./script_CSzDbyjI.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { $ as $$PageHeader } from "./PageHeader_93CCipe8.mjs";
import { g as getCurrentStaffUser, f as can } from "./rbac_cfH-YcoZ.mjs";
const prerender = false;
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Index;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "settings.manage")) return new Response("Forbidden", { status: 403 });
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Site Settings", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Site Settings", "subtitle": "Platform configuration, shipping rates, payment gateways, and feature flags." })} ${maybeRenderHead()}<div class="bg-surface border border-line rounded-lg p-4"> <table class="w-full border-collapse text-sm" id="settings-table"> <thead><tr class="border-b border-line text-left"><th class="py-2 px-3">Key</th><th class="py-2 px-3">Value</th><th class="py-2 px-3">Group</th></tr></thead> <tbody id="settings-body"><tr><td colspan="3" class="px-3 py-4 text-center text-muted">Loading...</td></tr></tbody> </table> </div> ${renderScript($$result2, "D:/Antigravity/zabir-boutiques/src/pages/staff/settings/index.astro?astro&type=script&index=0&lang.ts")} ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/settings/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/settings/index.astro";
const $$url = "/staff/settings";
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
