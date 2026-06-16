globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, F as Fragment, m as maybeRenderHead, b as addAttribute } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { $ as $$StepUpRequired } from "./StepUpRequired_13j4Wiz0.mjs";
import { $ as $$PageHeader } from "./PageHeader_93CCipe8.mjs";
import { g as getCurrentStaffUser, f as can } from "./rbac_cfH-YcoZ.mjs";
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { r as requireRecentStaffSession, C as CriticalAuthError } from "./critical-auth_D2TvZBIE.mjs";
const prerender = false;
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Index;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "staff.manage")) return new Response("Forbidden", { status: 403 });
  let needsStepUp = false;
  try {
    await requireRecentStaffSession(Astro2, user);
  } catch (err) {
    if (err instanceof CriticalAuthError && err.code === "STEP_UP_REQUIRED") {
      needsStepUp = true;
    } else if (err instanceof CriticalAuthError) {
      return err.toResponse();
    } else {
      throw err;
    }
  }
  const env = getEnv();
  let staffList = [];
  if (!needsStepUp) {
    const result = await env.DB.prepare(
      `SELECT id, email, phone, full_name, role, is_active, last_login_at, created_at
     FROM staff_users ORDER BY created_at DESC LIMIT 200`
    ).all();
    staffList = result.results ?? [];
  }
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Staff Users", "user": user }, { "default": async ($$result2) => renderTemplate`${needsStepUp ? renderTemplate`${renderComponent($$result2, "StepUpRequired", $$StepUpRequired, { "message": "Staff user management requires recent authentication." })}` : renderTemplate`${renderComponent($$result2, "Fragment", Fragment, {}, { "default": async ($$result3) => renderTemplate` ${renderComponent($$result3, "PageHeader", $$PageHeader, { "title": "Staff Users", "subtitle": `${staffList.length} users` })} ${maybeRenderHead()}<div class="overflow-x-auto border border-line rounded-lg"> <table class="w-full border-collapse text-sm"> <thead><tr class="bg-surface-soft text-left"> <th class="px-3 py-2.5">Name</th> <th class="px-3 py-2.5">Email</th> <th class="px-3 py-2.5">Phone</th> <th class="px-3 py-2.5">Role</th> <th class="px-3 py-2.5">Active</th> <th class="px-3 py-2.5">Last Login</th> </tr></thead> <tbody>${staffList.map((s) => renderTemplate`<tr class="border-t border-line-soft"> <td class="px-3 py-2 font-semibold">${s.full_name}</td> <td class="px-3 py-2">${s.email || "—"}</td> <td class="px-3 py-2">${s.phone || "—"}</td> <td class="px-3 py-2"><span${addAttribute(`inline-block px-1.5 py-0.5 rounded text-[10px] ${["super_admin", "owner"].includes(s.role) ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`, "class")}>${s.role}</span></td> <td class="px-3 py-2"><span${addAttribute(`inline-block px-1.5 py-0.5 rounded text-[10px] ${s.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`, "class")}>${s.is_active ? "Active" : "Inactive"}</span></td> <td class="px-3 py-2 text-muted text-xs">${s.last_login_at || "Never"}</td> </tr>`)}</tbody> </table> </div> ` })}`}` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/users/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/users/index.astro";
const $$url = "/staff/users";
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
