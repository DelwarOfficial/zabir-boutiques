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
  if (!can(user.role, "orders.view")) return new Response("Forbidden", { status: 403 });
  const env = getEnv();
  const { searchParams } = new URL(Astro2.request.url);
  const statusFilter = searchParams.get("status") || "";
  const page2 = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = 25;
  const offset = (page2 - 1) * limit;
  let where = "WHERE 1=1";
  const bindings = [];
  if (statusFilter) {
    where += " AND o.status = ?";
    bindings.push(statusFilter);
  }
  const countRow = await env.DB.prepare(`SELECT COUNT(*) as total FROM orders o ${where}`).bind(...bindings).first();
  const totalOrders = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalOrders / limit));
  const orders = await env.DB.prepare(
    `SELECT o.id, o.order_number, o.name, o.phone, o.total_paisa, o.payment_method, o.payment_status, o.status, o.fraud_decision, o.order_channel, o.created_at,
          s.full_name as created_by_name
   FROM orders o
   LEFT JOIN staff_users s ON s.id = o.created_by
   ${where}
   ORDER BY o.created_at DESC
   LIMIT ? OFFSET ?`
  ).bind(...bindings, limit, offset).all();
  const statuses = ["pending_review", "pending_payment", "payment_verified", "paid_over_allocated", "staff_confirmed", "packing", "shipped", "delivered", "cancelled", "refunded"];
  const badge = {
    pending_review: "#f59e0b",
    pending_payment: "#f59e0b",
    payment_verified: "#3b82f6",
    paid_over_allocated: "#8b5cf6",
    staff_confirmed: "#06b6d4",
    packing: "#06b6d4",
    shipped: "#6366f1",
    delivered: "#22c55e",
    cancelled: "#ef4444",
    refunded: "#64748b"
  };
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Orders", "user": user }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Orders", "subtitle": `${totalOrders} total · Page ${page2}/${totalPages}` })} ${maybeRenderHead()}<div class="mb-4 flex gap-2 flex-wrap"> <a href="/staff/orders"${addAttribute(`px-3 py-1.5 rounded-md text-xs no-underline ${!statusFilter ? "bg-brand text-white" : "bg-surface text-ink-secondary border border-line"}`, "class")}>All</a> ${statuses.map((s) => renderTemplate`<a${addAttribute(`/staff/orders?status=${s}`, "href")}${addAttribute(`px-3 py-1.5 rounded-md text-xs no-underline ${statusFilter === s ? "bg-brand text-white" : "bg-surface text-ink-secondary border border-line"}`, "class")}> ${s.replace(/_/g, " ")} </a>`)} </div> <div class="overflow-x-auto border border-line rounded-lg"> <table class="w-full border-collapse text-sm"> <thead> <tr class="bg-surface-soft text-left"> <th class="px-3 py-2.5 font-semibold">Order</th> <th class="px-3 py-2.5 font-semibold">Customer</th> <th class="px-3 py-2.5 font-semibold">Total</th> <th class="px-3 py-2.5 font-semibold">Payment</th> <th class="px-3 py-2.5 font-semibold">Status</th> <th class="px-3 py-2.5 font-semibold">Channel</th> <th class="px-3 py-2.5 font-semibold">Fraud</th> <th class="px-3 py-2.5 font-semibold">Created</th> <th class="px-3 py-2.5 font-semibold">By</th> </tr> </thead> <tbody> ${orders.results?.length ? orders.results.map((o) => renderTemplate`<tr class="border-t border-line-soft"> <td class="px-3 py-2.5"><a${addAttribute(`/staff/orders/${o.id}`, "href")} class="text-brand font-semibold no-underline">${o.order_number}</a></td> <td class="px-3 py-2.5"> <div>${o.name}</div> <div class="text-muted text-xs">${o.phone}</div> </td> <td class="px-3 py-2.5 font-semibold">৳${(o.total_paisa / 100).toFixed(2)}</td> <td class="px-3 py-2.5"> <span${addAttribute(`inline-block px-1.5 py-0.5 rounded text-[10px] ${["paid", "partially_paid"].includes(o.payment_status) ? "bg-green-100 text-green-800" : o.payment_status === "failed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`, "class")}> ${o.payment_method}${o.payment_status !== "paid" ? ` (${o.payment_status})` : ""} </span> </td> <td class="px-3 py-2.5"> <span class="inline-block px-1.5 py-0.5 rounded text-[10px]"${addAttribute(`background:${badge[o.status] || "#f1f5f9"}22;color:${badge[o.status] || "#475569"};`, "style")}> ${o.status.replace(/_/g, " ")} </span> </td> <td class="px-3 py-2.5 text-muted text-xs">${o.order_channel}</td> <td class="px-3 py-2.5"> <span class="inline-block px-1.5 py-0.5 rounded text-[10px]"${addAttribute(`background:${o.fraud_decision === "approved" ? "#dcfce7" : o.fraud_decision === "blocked" ? "#fee2e2" : "#fef3c7"};color:${o.fraud_decision === "approved" ? "#166534" : o.fraud_decision === "blocked" ? "#991b1b" : "#92400e"};`, "style")}> ${o.fraud_decision} </span> </td> <td class="px-3 py-2.5 text-muted text-xs">${o.created_at?.split(" ")[0]}</td> <td class="px-3 py-2.5 text-muted text-xs">${o.created_by_name || "—"}</td> </tr>`) : renderTemplate`<tr><td colspan="9" class="px-4 py-8 text-center text-muted">No orders found.</td></tr>`} </tbody> </table> </div> ${totalPages > 1 && renderTemplate`<div class="flex gap-2 justify-center mt-6"> ${Array.from({ length: totalPages }, (_, i) => renderTemplate`<a${addAttribute(`/staff/orders?page=${i + 1}${statusFilter ? `&status=${statusFilter}` : ""}`, "href")}${addAttribute(`px-2.5 py-1 rounded text-xs no-underline ${page2 === i + 1 ? "bg-brand text-white" : "bg-surface text-ink-secondary border border-line"}`, "class")}> ${i + 1} </a>`)} </div>`}` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/orders/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/orders/index.astro";
const $$url = "/staff/orders";
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
