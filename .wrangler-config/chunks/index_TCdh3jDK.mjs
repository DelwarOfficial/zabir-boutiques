globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { n as nowSql, r as renderTemplate, m as maybeRenderHead, b as addAttribute, F as Fragment } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { g as getCurrentStaffUser, f as can } from "./rbac_cfH-YcoZ.mjs";
import { g as getEnv } from "./env_BNqnkDbh.mjs";
const prerender = false;
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Index;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  const env = getEnv();
  const today = nowSql().slice(0, 10);
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
  const hour = (/* @__PURE__ */ new Date()).getHours();
  const greeting = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  let stats = { pendingReview: 0, packingQueue: 0, lowStockAlerts: 0, todayOrders: 0, todayRevenue: 0 };
  let recentOrders = [];
  let flagged = [];
  let dbError = "";
  try {
    const pr = await env.DB.prepare(`SELECT COUNT(*) as c FROM orders WHERE status = 'pending_review'`).first();
    if (pr) stats.pendingReview = pr.c;
    const pq = await env.DB.prepare(`SELECT COUNT(*) as c FROM orders WHERE status IN ('staff_confirmed','packing')`).first();
    if (pq) stats.packingQueue = pq.c;
    const ls = await env.DB.prepare(`SELECT COUNT(*) as c FROM low_stock_alerts WHERE is_acknowledged = 0`).first();
    if (ls) stats.lowStockAlerts = ls.c;
    const td = await env.DB.prepare(`SELECT COUNT(*) as c, COALESCE(SUM(total_paisa),0) as rev FROM orders WHERE created_at >= ?`).bind(today + " 00:00:00").first();
    if (td) {
      stats.todayOrders = td.c;
      stats.todayRevenue = td.rev ?? 0;
    }
    const ro = await env.DB.prepare(`SELECT id, order_number, name, total_paisa, status, created_at FROM orders ORDER BY created_at DESC LIMIT 6`).all();
    if (ro?.results) recentOrders = ro.results;
    const fl = await env.DB.prepare(`SELECT id, order_number, name, fraud_decision FROM orders WHERE fraud_decision IN ('review','blocked') ORDER BY created_at DESC LIMIT 5`).all();
    if (fl?.results) flagged = fl.results;
  } catch (e) {
    dbError = e?.message ?? "Database query failed";
  }
  const perms = {
    orders: can(user.role, "orders.view"),
    products: can(user.role, "products.manage"),
    fraud: can(user.role, "fraud.view"),
    sales: ["salesman", "manager", "owner", "super_admin"].includes(user.role),
    packing: user.role === "packing" || can(user.role, "orders.pack")
  };
  const statCards = [
    { label: "Today's orders", value: stats.todayOrders, tone: "brand", suffix: "placed" },
    { label: "Pending review", value: stats.pendingReview, tone: stats.pendingReview > 0 ? "warn" : "info" },
    { label: "Packing queue", value: stats.packingQueue, tone: "info" },
    { label: "Low-stock alerts", value: stats.lowStockAlerts, tone: stats.lowStockAlerts > 0 ? "danger" : "info" }
  ];
  const toneClass = {
    brand: "text-[var(--brand)]",
    warn: "text-amber-600",
    info: "text-cyan-600",
    danger: "text-[var(--danger)]"
  };
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Dashboard", "user": user }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="flex items-end justify-between flex-wrap gap-3 mb-5 fade-up"> <div> <p class="text-[11px] font-extrabold uppercase tracking-[0.22em] text-[var(--brand)]">${greeting}</p> <h1 class="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight">${user.fullName}</h1> <p class="text-sm text-[var(--muted)]">${roleLabel[user.role] ?? user.role} · ${today}</p> </div> </div> ${dbError && renderTemplate`<div class="bg-red-100 text-red-800 px-4 py-2 rounded-md text-sm mb-4">${dbError}</div>`}<div class="stagger grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6"> ${statCards.map((s) => renderTemplate`<div class="shell-card p-4 shine-card press"> <div class="flex items-start justify-between"> <p class="text-[10px] font-extrabold uppercase tracking-wider text-[var(--muted)]">${s.label}</p> <span class="h-1.5 w-1.5 rounded-full bg-current opacity-60" aria-hidden="true"></span> </div> <p${addAttribute(`tabular mt-1 text-3xl font-extrabold ${toneClass[s.tone]}`, "class")}>${s.value}${s.suffix ? renderTemplate`<span class="ml-1 text-xs font-semibold text-[var(--muted)]">${s.suffix}</span>` : null}</p> ${s.label === "Today's orders" && renderTemplate`<p class="mt-1 text-[11px] text-[var(--muted)] tabular">৳${(stats.todayRevenue / 100).toFixed(0)} revenue</p>`} </div>`)} </div> <div class="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6"> <div class="lg:col-span-3 shell-card p-4 sm:p-5 fade-up"> <div class="flex justify-between items-center mb-3"> <h2 class="m-0 text-base font-extrabold">Recent orders</h2> ${perms.orders && renderTemplate`<a href="/staff/orders" class="press text-sm font-bold text-[var(--brand)] hover:text-[var(--brand-strong)]">View all →</a>`} </div> ${recentOrders.length > 0 ? renderTemplate`${renderComponent($$result2, "Fragment", Fragment, {}, { "default": async ($$result3) => renderTemplate`  <ul class="grid sm:hidden gap-2 stagger"> ${recentOrders.map((o) => renderTemplate`<li> <a${addAttribute(`/staff/orders/${o.id}`, "href")} class="press flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3 no-underline"> <div class="min-w-0"> <p class="font-bold text-sm tabular text-[var(--brand)]">${o.order_number}</p> <p class="text-xs text-[var(--muted)] truncate">${o.name}</p> </div> <div class="text-right shrink-0"> <p class="font-extrabold tabular">৳${(o.total_paisa / 100).toFixed(0)}</p> <p class="text-[10px] text-[var(--muted)] uppercase tracking-wider">${String(o.status).replace(/_/g, " ")}</p> </div> </a> </li>`)} </ul> <div class="hidden sm:block overflow-x-auto"> <table class="w-full text-sm border-collapse"> <tbody> ${recentOrders.map((o) => renderTemplate`<tr class="border-t border-[var(--line-soft)] hover:bg-[var(--surface-soft)] transition-colors"> <td class="py-2"><a${addAttribute(`/staff/orders/${o.id}`, "href")} class="text-[var(--brand)] font-bold no-underline">${o.order_number}</a></td> <td class="py-2 text-[var(--muted)]">${o.name}</td> <td class="py-2 text-right font-bold tabular">৳${(o.total_paisa / 100).toFixed(0)}</td> <td class="py-2 pl-2 text-xs text-[var(--muted)]">${o.created_at?.split(" ")[0]}</td> <td class="py-2"><span class="text-[10px] px-2 py-0.5 rounded-full bg-[var(--line-soft)] text-[var(--ink-secondary)] font-bold uppercase tracking-wider">${o.status.replace(/_/g, " ")}</span></td> </tr>`)} </tbody> </table> </div> ` })}` : renderTemplate`<p class="text-[var(--muted)] text-sm my-2">No orders yet.</p>`} </div> <div class="lg:col-span-2 shell-card p-4 sm:p-5 fade-up"> <h2 class="m-0 mb-3 text-base font-extrabold">Attention needed</h2> ${flagged.length > 0 && perms.fraud ? renderTemplate`<ul class="text-sm pl-0 m-0 space-y-1.5 stagger">${flagged.map((f) => renderTemplate`<li class="flex items-center gap-2"><a${addAttribute(`/staff/orders/${f.id}`, "href")} class="text-[var(--brand)] font-bold no-underline">${f.order_number}</a><span class="text-[var(--muted)] truncate">${f.name}</span><span${addAttribute(`chip ml-auto ${f.fraud_decision === "blocked" ? "chip-danger" : "chip-brand"}`, "class")}>${f.fraud_decision}</span></li>`)}</ul>` : renderTemplate`<p class="text-[var(--muted)] text-sm m-0">No fraud flags.</p>`} <div class="mt-4 pt-4 border-t border-[var(--line)]"> <p class="text-xs font-extrabold uppercase tracking-wider text-[var(--muted)] mb-2">Quick actions</p> <div class="flex flex-wrap gap-2 text-sm"> ${perms.sales && renderTemplate`<a href="/staff/sales/new" class="press tap-44 inline-flex items-center gap-1 rounded-full bg-[var(--brand)] text-white px-3 h-9 text-xs font-bold no-underline">+ New order</a>`} ${perms.sales && renderTemplate`<a href="/staff/sales/instore" class="press tap-44 inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 h-9 text-xs font-bold text-[var(--ink)] no-underline">In-store</a>`} ${perms.packing && renderTemplate`<a href="/staff/packing" class="press tap-44 inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 h-9 text-xs font-bold text-[var(--ink)] no-underline">Packing</a>`} ${perms.products && renderTemplate`<a href="/staff/products" class="press tap-44 inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 h-9 text-xs font-bold text-[var(--ink)] no-underline">Products</a>`} ${perms.orders && renderTemplate`<a href="/staff/orders" class="press tap-44 inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 h-9 text-xs font-bold text-[var(--ink)] no-underline">All orders</a>`} <a href="/staff/support" class="press tap-44 inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 h-9 text-xs font-bold text-[var(--ink)] no-underline">Support</a> </div> </div> </div> </div> <p class="text-[var(--muted)] text-xs mt-4 flex items-center gap-1.5"> <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 9.4-8 10-4.5-.6-8-5-8-10V6z"></path></svg>
All staff actions are audited. Use the left navigation for your full toolset.
</p> ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/index.astro";
const $$url = "/staff";
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
