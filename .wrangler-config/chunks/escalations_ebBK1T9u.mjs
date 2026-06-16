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
const $$Escalations = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Escalations;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "support.view")) return new Response("Forbidden", { status: 403 });
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Escalations", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Escalations", "subtitle": "Support tickets and issues needing attention." })} ${renderComponent($$result2, "ComingSoon", $$ComingSoon, { "title": "Escalations queue is planned", "description": "A prioritized list of customer issues that need a manager or owner to step in." }, { "default": async ($$result3) => renderTemplate` ${maybeRenderHead()}<ul class="list-disc pl-5 space-y-1"> <li>Flag an order or customer for escalation</li> <li>Assign to a manager and track resolution</li> <li>Tie escalations back to the audit trail</li> </ul> ` })} ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/support/escalations.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/support/escalations.astro";
const $$url = "/staff/support/escalations";
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $$Escalations,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
