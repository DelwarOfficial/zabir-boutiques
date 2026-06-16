globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, m as maybeRenderHead, b as addAttribute } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { $ as $$PageHeader } from "./PageHeader_93CCipe8.mjs";
import { g as getCurrentStaffUser, i as isOwnerTier } from "./rbac_cfH-YcoZ.mjs";
import { g as getEnv } from "./env_BNqnkDbh.mjs";
const prerender = false;
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Index;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!isOwnerTier(user.role)) return new Response("Forbidden", { status: 403 });
  const env = getEnv();
  const { searchParams } = new URL(Astro2.request.url);
  const typeFilter = searchParams.get("type") || "";
  const page2 = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = 50;
  let where = "WHERE 1=1";
  const binds = [];
  if (typeFilter) {
    where += " AND mo.owner_type = ?";
    binds.push(typeFilter);
  }
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM media_objects mo ${where}`
  ).bind(...binds).first();
  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const media = await env.DB.prepare(
    `SELECT mo.id, mo.r2_key, mo.bucket, mo.owner_type, mo.owner_id, mo.visibility,
          mo.content_type, mo.created_at, s.full_name as uploader_name
   FROM media_objects mo
   LEFT JOIN staff_users s ON s.id = mo.uploaded_by_staff_id
   ${where}
   ORDER BY mo.created_at DESC
   LIMIT ? OFFSET ?`
  ).bind(...binds, limit, (page2 - 1) * limit).all();
  const rows = media.results ?? [];
  const ownerTypes = ["product", "staff_upload", "integration", "client_private", "backup"];
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Media / R2 Admin", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Media / R2 Admin", "subtitle": `${total} objects · Page ${page2}/${totalPages}` })} ${maybeRenderHead()}<form method="get" class="flex flex-wrap gap-2 mb-4 items-end"> <div> <label class="block text-xs text-ink-secondary mb-1">Owner type</label> <select name="type" class="px-2.5 py-1.5 border border-line rounded-md bg-bg text-ink text-xs box-border w-36"> <option value="">All</option> ${ownerTypes.map((t) => renderTemplate`<option${addAttribute(t, "value")}${addAttribute(t === typeFilter, "selected")}>${t}</option>`)} </select> </div> <button type="submit" class="px-3 py-1.5 bg-brand text-white rounded-md text-xs font-semibold border-0 cursor-pointer">Filter</button> ${typeFilter && renderTemplate`<a href="/staff/media-admin" class="text-xs text-muted no-underline hover:underline">Clear</a>`} </form> ${rows.length > 0 ? renderTemplate`<div class="overflow-x-auto border border-line rounded-lg"> <table class="w-full border-collapse text-xs"> <thead> <tr class="bg-surface-soft text-left"> <th class="px-2.5 py-2 font-semibold">R2 Key</th> <th class="px-2.5 py-2 font-semibold">Bucket</th> <th class="px-2.5 py-2 font-semibold">Owner</th> <th class="px-2.5 py-2 font-semibold">Visibility</th> <th class="px-2.5 py-2 font-semibold">Type</th> <th class="px-2.5 py-2 font-semibold">Uploaded by</th> <th class="px-2.5 py-2 font-semibold">Date</th> </tr> </thead> <tbody> ${rows.map((m) => renderTemplate`<tr class="border-t border-line-soft"> <td class="px-2.5 py-1.5 font-mono truncate max-w-[200px]"${addAttribute(m.r2_key, "title")}>${m.r2_key}</td> <td class="px-2.5 py-1.5">${m.bucket}</td> <td class="px-2.5 py-1.5"><span class="text-[10px] px-1.5 py-0.5 rounded bg-line-soft">${m.owner_type}</span><span class="text-muted ml-1">/${m.owner_id?.substring(0, 8)}</span></td> <td class="px-2.5 py-1.5"><span${addAttribute(`text-[10px] px-1.5 py-0.5 rounded font-semibold ${m.visibility === "public" ? "bg-green-100 text-green-800" : m.visibility === "owner_only" ? "bg-amber-100 text-amber-800" : "bg-line-soft text-ink-secondary"}`, "class")}>${m.visibility}</span></td> <td class="px-2.5 py-1.5 text-muted">${m.content_type}</td> <td class="px-2.5 py-1.5">${m.uploader_name || "—"}</td> <td class="px-2.5 py-1.5 text-muted">${m.created_at?.split(" ")[0]}</td> </tr>`)} </tbody> </table> </div>` : renderTemplate`<div class="text-center text-muted text-sm py-8 border border-line rounded-lg">No media objects found.</div>`}<div class="mt-4 flex gap-2"> ${page2 > 1 && renderTemplate`<a${addAttribute(`/staff/media-admin?type=${typeFilter}&page=${page2 - 1}`, "href")} class="px-3 py-1.5 border border-line rounded-md text-sm no-underline hover:bg-surface-soft">&larr; Prev</a>`} ${page2 < totalPages && renderTemplate`<a${addAttribute(`/staff/media-admin?type=${typeFilter}&page=${page2 + 1}`, "href")} class="px-3 py-1.5 border border-line rounded-md text-sm no-underline hover:bg-surface-soft">Next &rarr;</a>`} </div> ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/media-admin/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/media-admin/index.astro";
const $$url = "/staff/media-admin";
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
