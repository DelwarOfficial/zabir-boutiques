globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, F as Fragment, m as maybeRenderHead } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { $ as $$PageHeader } from "./PageHeader_93CCipe8.mjs";
import { $ as $$ComingSoon } from "./ComingSoon_uVxpAChw.mjs";
import { $ as $$StepUpRequired } from "./StepUpRequired_13j4Wiz0.mjs";
import { g as getCurrentStaffUser, h as isSuperAdmin } from "./rbac_cfH-YcoZ.mjs";
import { r as requireRecentStaffSession, C as CriticalAuthError } from "./critical-auth_D2TvZBIE.mjs";
const prerender = false;
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Index;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!isSuperAdmin(user.role)) return new Response("Forbidden", { status: 403 });
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
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Backups", "user": user }, { "default": async ($$result2) => renderTemplate`${needsStepUp ? renderTemplate`${renderComponent($$result2, "StepUpRequired", $$StepUpRequired, { "message": "Backup management requires recent authentication." })}` : renderTemplate`${renderComponent($$result2, "Fragment", Fragment, {}, { "default": async ($$result3) => renderTemplate` ${renderComponent($$result3, "PageHeader", $$PageHeader, { "title": "Backups", "subtitle": "D1 and R2 backup management (owner-only)." })} ${maybeRenderHead()}<div class="bg-surface border border-line rounded-lg p-4 mb-5"> <h2 class="m-0 text-sm font-semibold mb-2">Current Backup Policy</h2> <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs"> <div class="bg-surface-soft rounded-md p-3"> <div class="text-muted uppercase tracking-wider text-[10px] mb-1">Weekly D1</div> <div class="font-semibold">Sunday 04:00 UTC</div> <div class="text-muted mt-0.5">→ R2 backups/d1/weekly/</div> </div> <div class="bg-surface-soft rounded-md p-3"> <div class="text-muted uppercase tracking-wider text-[10px] mb-1">Retention</div> <div class="font-semibold">8 weekly backups</div> <div class="text-muted mt-0.5">Minimum per Master Plan 3.32</div> </div> <div class="bg-surface-soft rounded-md p-3"> <div class="text-muted uppercase tracking-wider text-[10px] mb-1">Log Archive</div> <div class="font-semibold">Monthly 1st 05:00 UTC</div> <div class="text-muted mt-0.5">Old events → R2 archive</div> </div> </div> </div> ${renderComponent($$result3, "ComingSoon", $$ComingSoon, { "title": "On-demand backup controls are planned", "description": "This console will allow manual triggers, download links, and guarded restore operations.", "status": "planned" }, { "default": async ($$result4) => renderTemplate` <ul class="list-disc pl-5 space-y-1"> <li>Trigger immediate D1 backup to R2</li> <li>Download backup JSON securely via signed URL</li> <li>Restore to staging with confirmation gate</li> <li>Verify backup integrity against audit chain hash</li> </ul> ` })} ` })}`}` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/backups/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/backups/index.astro";
const $$url = "/staff/backups";
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
