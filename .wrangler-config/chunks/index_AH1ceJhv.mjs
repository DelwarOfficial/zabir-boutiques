globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, m as maybeRenderHead } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { r as renderScript } from "./script_CSzDbyjI.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { $ as $$StepUpRequired } from "./StepUpRequired_13j4Wiz0.mjs";
import { g as getCurrentStaffUser, f as can, h as isSuperAdmin } from "./rbac_cfH-YcoZ.mjs";
import { r as requireRecentStaffSession, C as CriticalAuthError } from "./critical-auth_D2TvZBIE.mjs";
const prerender = false;
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Index;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "api_code.read")) return new Response("Forbidden", { status: 403 });
  const canMintKeys = isSuperAdmin(user.role);
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
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "API Keys", "user": user }, { "default": async ($$result2) => renderTemplate`${needsStepUp ? renderTemplate`${renderComponent($$result2, "StepUpRequired", $$StepUpRequired, { "message": "API Key management requires recent authentication." })}` : renderTemplate`${maybeRenderHead()}<div> class="flex justify-between items-center mb-6">
<h1 class="m-0 text-xl font-bold">API Keys</h1> ${canMintKeys && renderTemplate`<button id="createKeyBtn" class="px-4 py-2 bg-brand text-white border-0 rounded cursor-pointer text-sm font-semibold" onclick="showCreateForm()">+ New Key</button>`} </div>

  <div id="createForm" style="display:none;border:1px solid var(--line);border-radius:8px;padding:1.25rem;margin-bottom:1.5rem;background:var(--surface-soft);"> <h2 style="font-size:1rem;font-weight:600;margin:0 0 1rem;">Create API Key</h2> <div style="margin-bottom:0.75rem;"> <label style="display:block;font-size:0.85rem;font-weight:500;margin-bottom:0.25rem;">Key Name</label> <input id="keyName" type="text" placeholder="e.g. checkout-webhook" class="w-full px-3 py-2 border border-line rounded-md text-sm bg-surface text-ink"> </div> <div style="margin-bottom:0.75rem;"> <label style="display:block;font-size:0.85rem;font-weight:500;margin-bottom:0.35rem;">Scopes</label> <div id="scopeList" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0.4rem;font-size:0.8rem;"></div> </div> <div style="display:flex;gap:0.5rem;"> <button class="px-4 py-2 bg-brand text-white border-0 rounded-md cursor-pointer text-sm font-semibold" onclick="createKey()">Create</button> <button class="px-4 py-2 bg-transparent text-ink border border-line rounded-md cursor-pointer text-sm" onclick="hideCreateForm()">Cancel</button> </div> </div>

  <div id="newKeyResult" style="display:none;border:1px solid #fef08a;border-radius:8px;padding:1.25rem;margin-bottom:1.5rem;background:#fefce8;color:#713f12;font-size:0.85rem;"></div>

  <div style="overflow-x:auto;border:1px solid var(--line);border-radius:8px;"> <table style="width:100%;border-collapse:collapse;font-size:0.85rem;"> <thead> <tr style="background:var(--surface-soft);text-align:left;"> <th style="padding:0.6rem 0.75rem;font-weight:600;">Name</th> <th style="padding:0.6rem 0.75rem;font-weight:600;">Key Prefix</th> <th style="padding:0.6rem 0.75rem;font-weight:600;">Scopes</th> <th style="padding:0.6rem 0.75rem;font-weight:600;">Status</th> <th style="padding:0.6rem 0.75rem;font-weight:600;">Last Used</th> <th style="padding:0.6rem 0.75rem;font-weight:600;">Created</th> <th style="padding:0.6rem 0.75rem;font-weight:600;">Actions</th> </tr> </thead> <tbody id="keysTableBody"> <tr><td colspan="7" style="padding:2rem;text-align:center;color:var(--muted);">Loading...</td></tr> </tbody> </table> </div>`}` })} ${renderScript($$result, "D:/Antigravity/zabir-boutiques/src/pages/staff/api-code/index.astro?astro&type=script&index=0&lang.ts")}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/api-code/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/api-code/index.astro";
const $$url = "/staff/api-code";
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
