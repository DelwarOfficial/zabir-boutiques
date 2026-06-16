globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, a as renderSlot, b as addAttribute, d as renderHead } from "./sequence_XySMyPne.mjs";
/* empty css                 */
import { h as isSuperAdmin, i as isOwnerTier } from "./rbac_cfH-YcoZ.mjs";
const ALL = [
  { label: "Dashboard", href: "/staff", roles: ["owner-tier", "manager", "salesman", "packing", "support", "developer", "auditor"] },
  { label: "Orders", href: "/staff/orders", roles: ["owner-tier", "manager"] },
  { label: "Products", href: "/staff/products", roles: ["owner-tier", "manager"] },
  { label: "Inventory", href: "/staff/inventory", roles: ["owner-tier", "manager"] },
  { label: "Fraud Review", href: "/staff/fraud", roles: ["owner-tier", "manager"] },
  { label: "Reports", href: "/staff/reports", roles: ["owner-tier", "manager", "auditor"] },
  { label: "Media Upload", href: "/staff/media", roles: ["owner-tier", "manager"] },
  { label: "Support", href: "/staff/support", roles: ["owner-tier", "manager", "support"] },
  // Sales
  { label: "Sales Dashboard", href: "/staff/sales", roles: ["salesman"] },
  { label: "Create Order", href: "/staff/sales/new", roles: ["owner-tier", "manager", "salesman"] },
  { label: "In-Store Order", href: "/staff/sales/instore", roles: ["owner-tier", "manager", "salesman"] },
  { label: "My Orders", href: "/staff/sales/orders", roles: ["salesman"] },
  { label: "Product Search", href: "/staff/sales/search", roles: ["salesman"] },
  { label: "Customer Notes", href: "/staff/sales/notes", roles: ["salesman"] },
  // Packing
  { label: "Packing Queue", href: "/staff/packing", roles: ["packing"] },
  { label: "Packed Orders", href: "/staff/packing/packed", roles: ["packing"] },
  { label: "Courier Handoff", href: "/staff/packing/courier", roles: ["packing"] },
  { label: "Print Slips", href: "/staff/packing/slips", roles: ["packing"] },
  // Support extras
  { label: "Order Search", href: "/staff/support/search", roles: ["support"] },
  { label: "Escalations", href: "/staff/support/escalations", roles: ["support"] },
  // Business owner-level (super_admin + owner)
  { label: "Coupon Management", href: "/staff/coupons", roles: ["owner-tier"] },
  { label: "Staff Users", href: "/staff/users", roles: ["owner-tier"] },
  { label: "Roles & Permissions", href: "/staff/roles", roles: ["owner-tier"] },
  { label: "Site Settings", href: "/staff/settings", roles: ["owner-tier"] },
  { label: "Media / R2", href: "/staff/media-admin", roles: ["owner-tier"] },
  { label: "Audit Logs", href: "/staff/audit", roles: ["owner-tier", "auditor"] },
  // Platform-control (super_admin ONLY)
  { label: "API Code / Developer", href: "/staff/api-code", roles: ["super-admin-only", "developer"] },
  { label: "Backups", href: "/staff/backups", roles: ["super-admin-only"] }
];
function menuForRole(role) {
  const superAdmin = isSuperAdmin(role);
  const owner = isOwnerTier(role);
  return ALL.filter(
    (item) => item.roles.some((r) => {
      if (r === "super-admin-only") return superAdmin;
      if (r === "owner-tier") return owner;
      return r === role;
    })
  );
}
var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(raw || cooked.slice()) }));
var _a;
const $$StaffLayout = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$StaffLayout;
  const { title, user } = Astro2.props;
  const currentPath = Astro2.url.pathname;
  const menu = menuForRole(user.role).map((item) => ({
    ...item,
    active: item.href === currentPath || item.href !== "/staff" && currentPath.startsWith(item.href)
  }));
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
  const roleColor = {
    super_admin: "chip-danger",
    owner: "chip-brand",
    manager: "",
    salesman: "",
    packing: "",
    support: "",
    developer: "",
    auditor: ""
  };
  return renderTemplate(_a || (_a = __template(['<html lang="en" data-theme="light"> <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="icon" href="/favicon.ico"><meta name="theme-color" content="#faf9f7" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1a1816" media="(prefers-color-scheme: dark)"><title>', " — Zabir Boutiques Staff</title><script>\n      (function(){\n        var t = localStorage.getItem('zb-theme');\n        if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme:dark)').matches)) {\n          document.documentElement.setAttribute('data-theme','dark');\n        }\n      })();\n    <\/script><style>\n      .staff-shell { min-height: 100dvh; }\n      .staff-sidebar {\n        width: 240px; min-width: 240px;\n        background: var(--surface-soft);\n        border-right: 1px solid var(--line);\n        padding: 0.75rem 0;\n        overflow-y: auto;\n        transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);\n      }\n      .staff-sidebar a {\n        display: flex; align-items: center; gap: 0.5rem;\n        padding: 0.55rem 1.25rem;\n        color: var(--ink-secondary);\n        text-decoration: none;\n        font-size: 0.875rem;\n        border-left: 3px solid transparent;\n        transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;\n      }\n      .staff-sidebar a:hover { background: var(--brand-glow); color: var(--ink); transform: translateX(2px); }\n      .staff-sidebar a.active {\n        border-left-color: var(--brand);\n        background: var(--brand-glow);\n        font-weight: 700;\n        color: var(--ink);\n      }\n      .staff-toggle { display: none; background: none; border: none; cursor: pointer; padding: 0.5rem; color: var(--ink-secondary); }\n      .staff-toggle:hover { color: var(--ink); }\n      @media (max-width: 768px) {\n        .staff-sidebar { position: fixed; top: 60px; left: 0; bottom: 0; z-index: 100; transform: translateX(-100%); box-shadow: 8px 0 32px rgba(0,0,0,0.1); }\n        .staff-sidebar.open { transform: translateX(0); }\n        .staff-toggle { display: inline-flex; }\n      }\n      .staff-backdrop {\n        position: fixed; inset: 0; z-index: 99;\n        background: rgba(0,0,0,0.4);\n        opacity: 0; pointer-events: none;\n        transition: opacity 200ms ease;\n      }\n      .staff-backdrop.open { opacity: 1; pointer-events: auto; }\n    </style>", '</head> <body class="bg-bg text-ink font-sans m-0"> <div class="staff-shell"> <header class="glass-nav sticky top-0 z-40 safe-top"> <div class="flex items-center gap-3 px-4 sm:px-6 py-3"> <button id="sidebar-toggle" class="staff-toggle tap-44 rounded-md hover:bg-[var(--surface-soft)]" type="button" aria-label="Toggle navigation"> <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg> </button> <a href="/staff" class="text-brand text-base sm:text-lg font-extrabold no-underline tracking-tight">Zabir Boutiques <span class="text-[var(--muted)] font-bold">· Staff</span></a> <div class="ml-auto flex items-center gap-2 sm:gap-3"> <div class="hidden md:flex relative"> <svg class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg> <input type="search" placeholder="Search orders, products…" class="control h-9 w-64 pl-9 pr-3 text-sm rounded-full"> </div> <span', '> <span class="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" aria-hidden="true"></span> ', ' </span> <span class="hidden sm:inline text-sm text-[var(--ink-secondary)] font-semibold">', '</span> <button id="logout-btn" type="button" class="press tap-44 inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 h-9 text-xs font-semibold text-[var(--ink-secondary)] hover:bg-[var(--surface-soft)]"> <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M17 16l4-4m0 0l-4-4m4 4H7"></path><path d="M3 21V3"></path></svg>\nSign out\n</button> </div> </div> </header> <div class="flex"> <div id="sidebar-backdrop" class="staff-backdrop md:hidden" aria-hidden="true"></div> <nav id="sidebar" class="staff-sidebar md:sticky md:top-[60px] md:self-start md:h-[calc(100dvh-60px)]" aria-label="Staff navigation"> <ul class="list-none p-0 m-0"> ', ' </ul> </nav> <main class="flex-1 min-w-0 p-4 sm:p-6"> ', ` </main> </div> </div> <script>
      (function() {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebar-toggle');
        const backdrop = document.getElementById('sidebar-backdrop');
        function setOpen(open) {
          if (!sidebar) return;
          sidebar.classList.toggle('open', open);
          if (backdrop) backdrop.classList.toggle('open', open);
        }
        toggle?.addEventListener('click', () => setOpen(!sidebar.classList.contains('open')));
        backdrop?.addEventListener('click', () => setOpen(false));
        sidebar?.addEventListener('click', (e) => {
          if (window.innerWidth <= 768 && e.target instanceof HTMLAnchorElement) setOpen(false);
        });
      })();
    <\/script> <script>
      // Logout + CSRF helper
      function getCsrf() {
        const m = document.cookie.match(/(?:^|;\\s*)__Host-csrf-token=([^;]+)/) || document.cookie.match(/(?:^|;\\s*)csrf-token=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
      }
      document.getElementById('logout-btn')?.addEventListener('click', async () => {
        try {
          await fetch('/api/staff/logout', {
            method: 'POST',
            headers: { 'X-CSRF-Token': getCsrf() }
          });
        } catch (e) { /* no-op */ }
        window.location.href = '/staff/login';
      });

      // Auto-attach CSRF to all <form action="/api/staff/*" method="post"> forms
      document.addEventListener('submit', (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        const action = form.getAttribute('action') || '';
        if (form.method.toLowerCase() === 'post' && action.includes('/api/staff/')) {
          const csrf = getCsrf();
          if (!csrf) return;
          e.preventDefault();
          const data = new FormData(form);
          const body = new URLSearchParams();
          data.forEach((v, k) => body.append(k, typeof v === 'string' ? v : v.name));
          fetch(action, {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/x-www-form-urlencoded' },
            body
          }).then(res => {
            if (res.ok) { window.location.reload(); }
            else { res.json().then(b => alert(b.error || b.message || 'Action failed')).catch(() => alert('Action failed')); }
          }).catch(() => alert('Network error'));
        }
      }, true);
    <\/script> </body> </html>`], ['<html lang="en" data-theme="light"> <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="icon" href="/favicon.ico"><meta name="theme-color" content="#faf9f7" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1a1816" media="(prefers-color-scheme: dark)"><title>', " — Zabir Boutiques Staff</title><script>\n      (function(){\n        var t = localStorage.getItem('zb-theme');\n        if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme:dark)').matches)) {\n          document.documentElement.setAttribute('data-theme','dark');\n        }\n      })();\n    <\/script><style>\n      .staff-shell { min-height: 100dvh; }\n      .staff-sidebar {\n        width: 240px; min-width: 240px;\n        background: var(--surface-soft);\n        border-right: 1px solid var(--line);\n        padding: 0.75rem 0;\n        overflow-y: auto;\n        transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);\n      }\n      .staff-sidebar a {\n        display: flex; align-items: center; gap: 0.5rem;\n        padding: 0.55rem 1.25rem;\n        color: var(--ink-secondary);\n        text-decoration: none;\n        font-size: 0.875rem;\n        border-left: 3px solid transparent;\n        transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;\n      }\n      .staff-sidebar a:hover { background: var(--brand-glow); color: var(--ink); transform: translateX(2px); }\n      .staff-sidebar a.active {\n        border-left-color: var(--brand);\n        background: var(--brand-glow);\n        font-weight: 700;\n        color: var(--ink);\n      }\n      .staff-toggle { display: none; background: none; border: none; cursor: pointer; padding: 0.5rem; color: var(--ink-secondary); }\n      .staff-toggle:hover { color: var(--ink); }\n      @media (max-width: 768px) {\n        .staff-sidebar { position: fixed; top: 60px; left: 0; bottom: 0; z-index: 100; transform: translateX(-100%); box-shadow: 8px 0 32px rgba(0,0,0,0.1); }\n        .staff-sidebar.open { transform: translateX(0); }\n        .staff-toggle { display: inline-flex; }\n      }\n      .staff-backdrop {\n        position: fixed; inset: 0; z-index: 99;\n        background: rgba(0,0,0,0.4);\n        opacity: 0; pointer-events: none;\n        transition: opacity 200ms ease;\n      }\n      .staff-backdrop.open { opacity: 1; pointer-events: auto; }\n    </style>", '</head> <body class="bg-bg text-ink font-sans m-0"> <div class="staff-shell"> <header class="glass-nav sticky top-0 z-40 safe-top"> <div class="flex items-center gap-3 px-4 sm:px-6 py-3"> <button id="sidebar-toggle" class="staff-toggle tap-44 rounded-md hover:bg-[var(--surface-soft)]" type="button" aria-label="Toggle navigation"> <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg> </button> <a href="/staff" class="text-brand text-base sm:text-lg font-extrabold no-underline tracking-tight">Zabir Boutiques <span class="text-[var(--muted)] font-bold">· Staff</span></a> <div class="ml-auto flex items-center gap-2 sm:gap-3"> <div class="hidden md:flex relative"> <svg class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg> <input type="search" placeholder="Search orders, products…" class="control h-9 w-64 pl-9 pr-3 text-sm rounded-full"> </div> <span', '> <span class="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" aria-hidden="true"></span> ', ' </span> <span class="hidden sm:inline text-sm text-[var(--ink-secondary)] font-semibold">', '</span> <button id="logout-btn" type="button" class="press tap-44 inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 h-9 text-xs font-semibold text-[var(--ink-secondary)] hover:bg-[var(--surface-soft)]"> <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M17 16l4-4m0 0l-4-4m4 4H7"></path><path d="M3 21V3"></path></svg>\nSign out\n</button> </div> </div> </header> <div class="flex"> <div id="sidebar-backdrop" class="staff-backdrop md:hidden" aria-hidden="true"></div> <nav id="sidebar" class="staff-sidebar md:sticky md:top-[60px] md:self-start md:h-[calc(100dvh-60px)]" aria-label="Staff navigation"> <ul class="list-none p-0 m-0"> ', ' </ul> </nav> <main class="flex-1 min-w-0 p-4 sm:p-6"> ', ` </main> </div> </div> <script>
      (function() {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebar-toggle');
        const backdrop = document.getElementById('sidebar-backdrop');
        function setOpen(open) {
          if (!sidebar) return;
          sidebar.classList.toggle('open', open);
          if (backdrop) backdrop.classList.toggle('open', open);
        }
        toggle?.addEventListener('click', () => setOpen(!sidebar.classList.contains('open')));
        backdrop?.addEventListener('click', () => setOpen(false));
        sidebar?.addEventListener('click', (e) => {
          if (window.innerWidth <= 768 && e.target instanceof HTMLAnchorElement) setOpen(false);
        });
      })();
    <\/script> <script>
      // Logout + CSRF helper
      function getCsrf() {
        const m = document.cookie.match(/(?:^|;\\\\s*)__Host-csrf-token=([^;]+)/) || document.cookie.match(/(?:^|;\\\\s*)csrf-token=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
      }
      document.getElementById('logout-btn')?.addEventListener('click', async () => {
        try {
          await fetch('/api/staff/logout', {
            method: 'POST',
            headers: { 'X-CSRF-Token': getCsrf() }
          });
        } catch (e) { /* no-op */ }
        window.location.href = '/staff/login';
      });

      // Auto-attach CSRF to all <form action="/api/staff/*" method="post"> forms
      document.addEventListener('submit', (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        const action = form.getAttribute('action') || '';
        if (form.method.toLowerCase() === 'post' && action.includes('/api/staff/')) {
          const csrf = getCsrf();
          if (!csrf) return;
          e.preventDefault();
          const data = new FormData(form);
          const body = new URLSearchParams();
          data.forEach((v, k) => body.append(k, typeof v === 'string' ? v : v.name));
          fetch(action, {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/x-www-form-urlencoded' },
            body
          }).then(res => {
            if (res.ok) { window.location.reload(); }
            else { res.json().then(b => alert(b.error || b.message || 'Action failed')).catch(() => alert('Action failed')); }
          }).catch(() => alert('Network error'));
        }
      }, true);
    <\/script> </body> </html>`])), title, renderHead(), addAttribute(`chip ${roleColor[user.role] || ""}`, "class"), roleLabel[user.role] ?? user.role, user.fullName, menu.map((item) => renderTemplate`<li> <a${addAttribute(item.href, "href")}${addAttribute(item.active ? "active" : "", "class")}> <span class="h-1.5 w-1.5 rounded-full"${addAttribute(item.active ? "background:var(--brand)" : "background:transparent", "style")} aria-hidden="true"></span> ${item.label} </a> </li>`), renderSlot($$result, $$slots["default"]));
}, "D:/Antigravity/zabir-boutiques/src/layouts/StaffLayout.astro", void 0);
export {
  $$StaffLayout as $
};
