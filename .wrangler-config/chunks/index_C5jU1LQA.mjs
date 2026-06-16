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
  if (!can(user.role, "inventory.manage")) return new Response("Forbidden", { status: 403 });
  const env = getEnv();
  const inventory = await env.DB.prepare(
    `SELECT ii.id, ii.quantity, ii.reserved_quantity, ii.is_available, ii.updated_at,
          pv.id as variant_id, pv.sku, pv.size, pv.color, pv.price_paisa,
          p.id as product_id, p.name as product_name, p.slug as product_slug
   FROM inventory_items ii
   JOIN product_variants pv ON pv.id = ii.variant_id
   JOIN products p ON p.id = pv.product_id
   WHERE pv.is_deleted = 0
   ORDER BY ii.quantity ASC
   LIMIT 500`
  ).all();
  const alerts = await env.DB.prepare(
    `SELECT la.id, la.variant_id, la.message, la.is_acknowledged, la.created_at, pv.sku, p.name as product_name
   FROM low_stock_alerts la
   JOIN product_variants pv ON pv.id = la.variant_id
   JOIN products p ON p.id = pv.product_id
   WHERE la.is_acknowledged = 0
   ORDER BY la.created_at DESC
   LIMIT 100`
  ).all();
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Inventory", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Inventory", "subtitle": `${inventory.results?.length || 0} items` })} ${alerts.results?.length > 0 && renderTemplate`${maybeRenderHead()}<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;"> <strong style="font-size:0.85rem;color:#92400e;">${alerts.results.length} unacknowledged low-stock alert(s)</strong> <ul style="margin:0.5rem 0 0;padding-left:1.25rem;font-size:0.85rem;color:#92400e;"> ${alerts.results.map((a) => renderTemplate`<li>${a.product_name} (${a.sku}): ${a.message}</li>`)} </ul> </div>`}<div class="overflow-x-auto border border-line rounded-lg"> <table class="w-full border-collapse text-sm"> <thead> <tr class="bg-surface-soft text-left"> <th style="padding:0.6rem 0.75rem;font-weight:600;">Product</th> <th style="padding:0.6rem 0.75rem;font-weight:600;">SKU</th> <th style="padding:0.6rem 0.75rem;font-weight:600;">Size / Color</th> <th style="padding:0.6rem 0.75rem;font-weight:600;">Price</th> <th style="padding:0.6rem 0.75rem;font-weight:600;">On Hand</th> <th style="padding:0.6rem 0.75rem;font-weight:600;">Reserved</th> <th style="padding:0.6rem 0.75rem;font-weight:600;">Available</th> <th style="padding:0.6rem 0.75rem;font-weight:600;">Status</th> </tr> </thead> <tbody> ${inventory.results?.map((i) => {
    const available = i.quantity - i.reserved_quantity;
    return renderTemplate`<tr${addAttribute(`border-t border-line-soft ${i.quantity <= 0 ? "bg-red-50" : available <= 5 ? "bg-amber-50" : ""}`, "class")}> <td style="padding:0.6rem 0.75rem;"><span style="color:var(--brand);font-weight:600;">${i.product_name}</span></td> <td style="padding:0.6rem 0.75rem;font-family:monospace;font-size:0.8rem;">${i.sku}</td> <td style="padding:0.6rem 0.75rem;color:var(--muted);">${[i.size, i.color].filter(Boolean).join(" / ") || "—"}</td> <td style="padding:0.6rem 0.75rem;font-weight:600;">৳${(i.price_paisa / 100).toFixed(2)}</td> <td style="padding:0.6rem 0.75rem;font-weight:600;color:{i.quantity === 0 ? 'var(--danger)' : '#92400e'};">${i.quantity}</td> <td style="padding:0.6rem 0.75rem;color:var(--muted);">${i.reserved_quantity}</td> <td style="padding:0.6rem 0.75rem;font-weight:600;color:{available <= 0 ? 'var(--danger)' : available <= 5 ? '#f59e0b' : 'var(--success)'};">${available}</td> <td style="padding:0.6rem 0.75rem;"> <span${addAttribute(`padding:2px 6px;border-radius:4px;font-size:0.75rem;background:${i.is_available ? "#dcfce7" : "#fee2e2"};color:${i.is_available ? "#166534" : "#991b1b"};`, "style")}>${i.is_available ? "Active" : "Hidden"}</span> </td> </tr>`;
  }) || renderTemplate`<tr><td colspan="8" style="padding:2rem;text-align:center;color:var(--muted);">No inventory items found.</td></tr>`} </tbody> </table> </div> ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/inventory/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/inventory/index.astro";
const $$url = "/staff/inventory";
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
