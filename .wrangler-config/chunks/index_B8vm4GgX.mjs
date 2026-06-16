globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, m as maybeRenderHead } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { $ as $$PageHeader } from "./PageHeader_93CCipe8.mjs";
import { $ as $$ComingSoon } from "./ComingSoon_uVxpAChw.mjs";
import { g as getCurrentStaffUser, f as can, p as permissionsFor } from "./rbac_cfH-YcoZ.mjs";
import { r as requireRecentStaffSession, C as CriticalAuthError } from "./critical-auth_D2TvZBIE.mjs";
const prerender = false;
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Index;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "roles.manage")) return new Response("Forbidden", { status: 403 });
  try {
    await requireRecentStaffSession(Astro2, user);
  } catch (err) {
    if (err instanceof CriticalAuthError) return err.toResponse();
    throw err;
  }
  const roles = ["super_admin", "owner", "manager", "salesman", "packing", "support", "developer", "auditor"];
  const roleLabel = {
    super_admin: "Super Admin",
    owner: "Owner",
    manager: "Manager",
    salesman: "Sales Staff",
    packing: "Packing Staff",
    support: "Support",
    developer: "Developer",
    auditor: "Auditor"
  };
  const rows = roles.map((r) => ({ role: r, label: roleLabel[r], perms: permissionsFor(r) }));
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Roles & Permissions", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Roles & Permissions", "subtitle": "Read-only view of the static permission matrix." })} ${maybeRenderHead()}<div class="overflow-x-auto border border-line rounded-lg mb-5"> <table class="w-full border-collapse text-sm"> <thead> <tr class="bg-surface-soft text-left"> <th class="px-3 py-2.5 font-semibold">Role</th> <th class="px-3 py-2.5 font-semibold">Granted permissions</th> </tr> </thead> <tbody> ${rows.map((row) => renderTemplate`<tr class="border-t border-line-soft align-top"> <td class="px-3 py-2 font-semibold whitespace-nowrap"> ${row.label} ${["super_admin", "owner"].includes(row.role) && renderTemplate`<span class="ml-1 inline-block px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800">Owner-tier</span>`} </td> <td class="px-3 py-2"> ${row.perms[0] === "owner.full_access" ? renderTemplate`<span class="text-ink-secondary">Full access to every permission</span>` : renderTemplate`<div class="flex flex-wrap gap-1.5"> ${row.perms.map((p) => renderTemplate`<code class="px-1.5 py-0.5 rounded bg-line-soft text-ink-secondary text-[11px] font-mono">${p}</code>`)} </div>`} </td> </tr>`)} </tbody> </table> </div> ${renderComponent($$result2, "ComingSoon", $$ComingSoon, { "title": "Editing roles in the UI is deferred", "description": "Permissions are defined in code (src/lib/rbac.ts) as a static matrix for safety. Inline editing is planned for a later release.", "status": "planned" })} ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/roles/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/roles/index.astro";
const $$url = "/staff/roles";
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
