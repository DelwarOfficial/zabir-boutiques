globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, m as maybeRenderHead, b as addAttribute } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { $ as $$PageHeader } from "./PageHeader_93CCipe8.mjs";
import { g as getCurrentStaffUser, f as can } from "./rbac_cfH-YcoZ.mjs";
import { g as getEnv } from "./env_BNqnkDbh.mjs";
const prerender = false;
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Index;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "system.audit.view")) return new Response("Forbidden", { status: 403 });
  const env = getEnv();
  const { searchParams } = new URL(Astro2.request.url);
  const page2 = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const actionFilter = (searchParams.get("action") || "").trim();
  const actorFilter = (searchParams.get("actor") || "").trim();
  const limit = 50;
  let where = "WHERE 1=1";
  const bindings = [];
  if (actionFilter) {
    where += " AND al.action LIKE ?";
    bindings.push(`%${actionFilter}%`);
  }
  if (actorFilter) {
    where += " AND (s.full_name LIKE ? OR al.actor_role LIKE ?)";
    bindings.push(`%${actorFilter}%`, `%${actorFilter}%`);
  }
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM audit_log al LEFT JOIN staff_users s ON s.id = al.actor_staff_id ${where}`
  ).bind(...bindings).first();
  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const logs = await env.DB.prepare(
    `SELECT al.id, al.actor_staff_id, al.actor_role, al.action, al.entity_type, al.entity_id,
          al.ip_address, al.created_at, s.full_name as actor_name
   FROM audit_log al
   LEFT JOIN staff_users s ON s.id = al.actor_staff_id
   ${where}
   ORDER BY al.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...bindings, limit, (page2 - 1) * limit).all();
  function qs(overrides) {
    const p = new URLSearchParams();
    if (actionFilter) p.set("action", actionFilter);
    if (actorFilter) p.set("actor", actorFilter);
    for (const [k, v] of Object.entries(overrides)) p.set(k, String(v));
    return "?" + p.toString();
  }
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Audit Logs", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Audit Logs", "subtitle": `${total} entries · Page ${page2}/${totalPages}` })} ${maybeRenderHead()}<form method="get" class="flex flex-wrap gap-2 mb-4 items-end"> <div> <label class="block text-xs text-ink-secondary mb-1">Action</label> <input name="action" type="text"${addAttribute(actionFilter, "value")} placeholder="e.g. coupon.create" class="px-2.5 py-1.5 border border-line rounded-md bg-bg text-ink text-xs w-44 box-border"> </div> <div> <label class="block text-xs text-ink-secondary mb-1">Staff / Role</label> <input name="actor" type="text"${addAttribute(actorFilter, "value")} placeholder="name or role" class="px-2.5 py-1.5 border border-line rounded-md bg-bg text-ink text-xs w-36 box-border"> </div> <button type="submit" class="px-3 py-1.5 bg-brand text-white rounded-md text-xs font-semibold border-0 cursor-pointer">Filter</button> ${(actionFilter || actorFilter) && renderTemplate`<a href="/staff/audit" class="text-xs text-muted no-underline hover:underline">Clear</a>`} </form> ${logs.results?.length ? renderTemplate`<div class="overflow-x-auto border border-line rounded-lg"> <table class="w-full border-collapse text-xs"> <thead><tr class="bg-surface-soft text-left"> <th class="px-2.5 py-2 font-semibold">Date</th> <th class="px-2.5 py-2 font-semibold">Staff</th> <th class="px-2.5 py-2 font-semibold">Action</th> <th class="px-2.5 py-2 font-semibold">Entity</th> <th class="px-2.5 py-2 font-semibold">IP</th> </tr></thead> <tbody>${logs.results.map((l) => renderTemplate`<tr class="border-t border-line-soft"> <td class="px-2.5 py-1.5 whitespace-nowrap">${l.created_at}</td> <td class="px-2.5 py-1.5">${l.actor_name || l.actor_role || "—"}</td> <td class="px-2.5 py-1.5 font-mono">${l.action}</td> <td class="px-2.5 py-1.5 text-muted">${l.entity_type}/${l.entity_id?.substring(0, 8)}</td> <td class="px-2.5 py-1.5 font-mono text-[10px]">${l.ip_address || "—"}</td> </tr>`)}</tbody> </table> </div>` : renderTemplate`<div class="text-center text-muted text-sm py-8 border border-line rounded-lg">No audit entries match your filters.</div>`}<div class="mt-4 flex gap-2 items-center"> ${page2 > 1 && renderTemplate`<a${addAttribute(`/staff/audit${qs({ page: page2 - 1 })}`, "href")} class="px-3 py-1.5 border border-line rounded-md text-sm no-underline hover:bg-surface-soft">&larr; Previous</a>`} ${page2 < totalPages && renderTemplate`<a${addAttribute(`/staff/audit${qs({ page: page2 + 1 })}`, "href")} class="px-3 py-1.5 border border-line rounded-md text-sm no-underline hover:bg-surface-soft">Next &rarr;</a>`} <span class="text-xs text-muted ml-auto">Showing ${Math.min(limit, logs.results?.length ?? 0)} of ${total}</span> </div> ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/audit/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/audit/index.astro";
const $$url = "/staff/audit";
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
