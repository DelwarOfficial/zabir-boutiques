globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { m as maybeRenderHead, b as addAttribute, r as renderTemplate, a as renderSlot, d as renderHead } from "./sequence_XySMyPne.mjs";
import { h as reactExports, f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { d as addPaisa, m as multiplyPaisa } from "./money_DWLDQpFs.mjs";
/* empty css                 */
var jsxRuntime = { exports: {} };
var reactJsxRuntime_production = {};
var hasRequiredReactJsxRuntime_production;
function requireReactJsxRuntime_production() {
  if (hasRequiredReactJsxRuntime_production) return reactJsxRuntime_production;
  hasRequiredReactJsxRuntime_production = 1;
  var REACT_ELEMENT_TYPE = /* @__PURE__ */ Symbol.for("react.transitional.element"), REACT_FRAGMENT_TYPE = /* @__PURE__ */ Symbol.for("react.fragment");
  function jsxProd(type, config, maybeKey) {
    var key = null;
    void 0 !== maybeKey && (key = "" + maybeKey);
    void 0 !== config.key && (key = "" + config.key);
    if ("key" in config) {
      maybeKey = {};
      for (var propName in config)
        "key" !== propName && (maybeKey[propName] = config[propName]);
    } else maybeKey = config;
    config = maybeKey.ref;
    return {
      $$typeof: REACT_ELEMENT_TYPE,
      type,
      key,
      ref: void 0 !== config ? config : null,
      props: maybeKey
    };
  }
  reactJsxRuntime_production.Fragment = REACT_FRAGMENT_TYPE;
  reactJsxRuntime_production.jsx = jsxProd;
  reactJsxRuntime_production.jsxs = jsxProd;
  return reactJsxRuntime_production;
}
var hasRequiredJsxRuntime;
function requireJsxRuntime() {
  if (hasRequiredJsxRuntime) return jsxRuntime.exports;
  hasRequiredJsxRuntime = 1;
  {
    jsxRuntime.exports = requireReactJsxRuntime_production();
  }
  return jsxRuntime.exports;
}
var jsxRuntimeExports = requireJsxRuntime();
function getStoredTheme() {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("zb-theme");
  if (stored === "dark") return "dark";
  if (stored === "light") return "light";
  return matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light";
}
function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}
function ThemeToggle() {
  const [theme, setTheme] = reactExports.useState("light");
  reactExports.useEffect(() => {
    setTheme(getStoredTheme());
  }, []);
  reactExports.useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("zb-theme", next);
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "button",
    {
      type: "button",
      onClick: toggle,
      "aria-label": theme === "light" ? "Switch to dark mode" : "Switch to light mode",
      title: theme === "light" ? "Dark mode" : "Light mode",
      className: "flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] transition hover:text-[var(--ink)] hover:border-[var(--brand)] active:scale-95",
      children: theme === "light" ? /* @__PURE__ */ jsxRuntimeExports.jsx("svg", { className: "h-[18px] w-[18px]", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 2, children: /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" }) }) : /* @__PURE__ */ jsxRuntimeExports.jsxs("svg", { className: "h-[18px] w-[18px]", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 2, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("circle", { cx: "12", cy: "12", r: "5" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" })
      ] })
    }
  );
}
const $$Header = createComponent(($$result, $$props, $$slots) => {
  const facebookUrl = "https://www.facebook.com/zabirboutiques";
  return renderTemplate`${maybeRenderHead()}<header class="sticky top-0 z-40 glass-nav safe-top"> <div class="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 md:px-8 lg:px-16"> <!-- Logo --> <a href="/" class="flex min-w-0 items-center gap-3 leading-tight press" aria-label="Zabir Boutiques home"> <span class="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--ink)] ring-2 ring-[var(--line)] transition-transform duration-300 hover:scale-105 active:scale-95"> <img src="/assets/zabir-logo.jpg" alt="" width="40" height="40" class="h-full w-full object-cover"> <span class="absolute inset-0 rounded-full ring-1 ring-[var(--brand)]/40" aria-hidden="true"></span> </span> <span class="min-w-0 hidden sm:block"> <strong class="block truncate text-[15px] font-extrabold tracking-tight text-[var(--ink)]">Zabir Boutiques</strong> <span class="block truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Wari · Dhaka</span> </span> </a> <!-- Search (desktop only) --> <label class="hidden md:flex relative w-full max-w-md"> <span class="sr-only">Search products</span> <svg class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg> <input type="search" name="q" placeholder="Search products, e.g. kurti, jewelry, bag…" class="control w-full pl-9 pr-4 h-10 rounded-full text-sm bg-[var(--surface)] border-[var(--line)] focus:border-[var(--brand)]" autocomplete="off" oninput="if(this.value.length>1){location.href='/categories/all?q='+encodeURIComponent(this.value)}"> </label> <!-- Right actions --> <div class="flex items-center gap-2 sm:gap-3"> <!-- Search trigger (mobile) --> <a href="/categories/all" aria-label="Search" class="tap-44 md:hidden grid place-items-center rounded-full text-[var(--ink-secondary)] hover:text-[var(--brand)] active:scale-95 transition"> <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg> </a> <!-- Facebook: icon-only on mobile, text on sm+ --> <a${addAttribute(facebookUrl, "href")} aria-label="Facebook page" class="press tap-44 hidden sm:inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 h-9 text-xs font-semibold text-[var(--brand)] transition hover:border-[var(--brand)] hover:bg-[var(--brand-light)]"> <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"> <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"></path> </svg> <span class="hidden sm:inline">Facebook</span> </a> <!-- Call: icon-only on mobile, text on sm+ --> <a href="tel:+8801985516000" aria-label="Call us" class="press tap-44 inline-flex items-center justify-center gap-1.5 rounded-full bg-[var(--ink)] text-[var(--bg)] h-9 px-3 sm:px-4 text-xs font-semibold transition hover:opacity-90"> <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"> <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"></path> </svg> <span class="hidden sm:inline">Call</span> </a> <!-- Theme toggle --> ${renderComponent($$result, "ThemeToggle", ThemeToggle, { "client:idle": true, "client:component-hydration": "idle", "client:component-path": "@/islands/ThemeToggle", "client:component-export": "ThemeToggle" })} </div> </div> </header>`;
}, "D:/Antigravity/zabir-boutiques/src/components/shell/Header.astro", void 0);
function slugify(value) {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
const STORE_TAXONOMY = [
  {
    name: "Pakistani Collection",
    slug: "pakistani-collection",
    subcategories: ["Bin Sayed", "Sadabahar", "Other Pakistani Brands"].map((name) => ({ name, slug: slugify(name) }))
  },
  {
    name: "Indian Collection",
    slug: "indian-collection",
    subcategories: ["Indian Party Wear", "Indian Three-Piece", "Indian Kurti Collection", "Other Indian Brands"].map((name) => ({ name, slug: slugify(name) }))
  },
  {
    name: "ZB Stitch",
    slug: "zb-stitch",
    subcategories: ["ZB Ready-to-Wear", "ZB Custom Stitch", "ZB Premium Collection", "ZB Exclusive Design"].map((name) => ({ name, slug: slugify(name) }))
  },
  {
    name: "Jewelry",
    slug: "jewelry",
    subcategories: ["Earrings", "Necklace Set", "Bangles & Bracelets", "Rings", "Bridal Jewelry"].map((name) => ({ name, slug: slugify(name) }))
  },
  {
    name: "Bags",
    slug: "bags",
    subcategories: ["Handbags", "Clutches", "Shoulder Bags", "Party Bags"].map((name) => ({ name, slug: slugify(name) }))
  }
];
const FLAT_CATEGORY_FILTERS = STORE_TAXONOMY.flatMap((category) => [
  { name: category.name, slug: category.slug, parent: null },
  ...category.subcategories.map((subcategory) => ({ ...subcategory, parent: category.slug }))
]);
const $$CategoryRail = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$CategoryRail;
  const activeSlug = Astro2.props.activeSlug ?? "";
  return renderTemplate`${maybeRenderHead()}<nav class="sticky top-16 z-30 glass-nav" aria-label="Product categories"> <div class="mx-auto max-w-7xl px-4 md:px-8 lg:px-16 py-2.5"> <div class="scroll-x-snap flex items-center gap-2 overflow-x-auto"> ${FLAT_CATEGORY_FILTERS.map((item) => {
    const active = activeSlug === item.slug;
    return renderTemplate`<a${addAttribute(item.parent ? `/categories/${item.parent}?filter=${item.slug}` : `/categories/${item.slug}`, "href")}${addAttribute([
      "press tap-44 relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-all duration-200",
      active ? "bg-[var(--brand)] text-white shadow-[0_4px_12px_rgba(161,98,7,0.25)]" : "bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-soft)] border border-[var(--line)]"
    ], "class:list")}${addAttribute(active ? "page" : void 0, "aria-current")}> ${active && renderTemplate`<span class="h-1.5 w-1.5 rounded-full bg-white/80" aria-hidden="true"></span>`} ${item.name} </a>`;
  })} </div> </div> </nav>`;
}, "D:/Antigravity/zabir-boutiques/src/components/shell/CategoryRail.astro", void 0);
const $$Footer = createComponent(($$result, $$props, $$slots) => {
  const facebookUrl = "https://www.facebook.com/zabirboutiques";
  return renderTemplate`${maybeRenderHead()}<footer class="border-t border-[var(--line)] bg-[var(--surface)]"> <div class="mx-auto max-w-7xl px-4 md:px-8 lg:px-16 py-12 md:py-16"> <div class="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr]"> <div> <a href="/" class="flex items-center gap-3 press"> <span class="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--ink)] ring-2 ring-[var(--line)]"> <img src="/assets/zabir-logo.jpg" alt="" width="48" height="48" loading="lazy" decoding="async" class="h-full w-full object-cover"> </span> <div> <h3 class="text-base font-extrabold tracking-tight">Zabir Boutiques</h3> <p class="text-xs text-[var(--muted)]">Premium fashion since 2024</p> </div> </a> <p class="mt-4 max-w-sm text-sm leading-relaxed text-[var(--muted)]">
COD-first boutique shopping from Wari, Dhaka. Bangladesh-wide delivery with live stock discipline and staff-confirmed orders.
</p> <div class="mt-5 flex flex-wrap gap-2"> <a${addAttribute(facebookUrl, "href")} class="press tap-44 inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-4 h-10 text-xs font-bold text-[var(--brand)] transition hover:border-[var(--brand)] hover:bg-[var(--brand-light)]"> <svg class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"></path></svg>
Facebook
</a> <a href="https://wa.me/8801985516000" class="press tap-44 inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-4 h-10 text-xs font-bold text-[var(--brand)] transition hover:border-[var(--brand)] hover:bg-[var(--brand-light)]"> <svg class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884"></path></svg>
WhatsApp
</a> </div> </div> <div> <h4 class="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted)]">Shop</h4> <ul class="mt-4 space-y-2.5"> ${[
    { href: "/categories/pakistani-collection", label: "Pakistani Collection" },
    { href: "/categories/indian-collection", label: "Indian Collection" },
    { href: "/categories/zb-stitch", label: "ZB Stitch" },
    { href: "/categories/jewelry", label: "Jewelry" },
    { href: "/categories/bags", label: "Bags" }
  ].map((link) => renderTemplate`<li> <a${addAttribute(link.href, "href")} class="press text-sm text-[var(--ink-secondary)] transition hover:text-[var(--brand)]">${link.label}</a> </li>`)} </ul> </div> <address class="not-italic"> <h4 class="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted)]">Visit Us</h4> <div class="mt-4 space-y-2 text-sm leading-relaxed text-[var(--muted)]"> <p class="flex items-start gap-2"> <svg class="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"> <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path> <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path> </svg> <span>10 (Ground Floor), A.K Famous Tower, Rankin Street, Wari, Dhaka</span> </p> <p class="flex items-center gap-2"> <svg class="h-4 w-4 shrink-0 text-[var(--brand)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"></path></svg> <a href="tel:+8801985516000" class="transition hover:text-[var(--ink)]">+880 1985-516000</a> </p> <p>Near Aarong Building</p> </div> </address> </div> <div class="mt-10 border-t border-[var(--line)] pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[var(--muted)]"> <p>© ${(/* @__PURE__ */ new Date()).getFullYear()} Zabir Boutiques. All rights reserved.</p> <p>Built with care in Wari, Dhaka.</p> </div> </div> </footer>`;
}, "D:/Antigravity/zabir-boutiques/src/components/shell/Footer.astro", void 0);
const toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();
var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};
const Icon = reactExports.forwardRef(
  ({
    color = "currentColor",
    size = 24,
    strokeWidth = 2,
    absoluteStrokeWidth,
    className = "",
    children,
    iconNode,
    ...rest
  }, ref) => {
    return reactExports.createElement(
      "svg",
      {
        ref,
        ...defaultAttributes,
        width: size,
        height: size,
        stroke: color,
        strokeWidth: absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
        className: mergeClasses("lucide", className),
        ...rest
      },
      [
        ...iconNode.map(([tag, attrs]) => reactExports.createElement(tag, attrs)),
        ...Array.isArray(children) ? children : [children]
      ]
    );
  }
);
const createLucideIcon = (iconName, iconNode) => {
  const Component = reactExports.forwardRef(
    ({ className, ...props }, ref) => reactExports.createElement(Icon, {
      ref,
      iconNode,
      className: mergeClasses(`lucide-${toKebabCase(iconName)}`, className),
      ...props
    })
  );
  Component.displayName = `${iconName}`;
  return Component;
};
const Grid3x3 = createLucideIcon("Grid3x3", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M3 9h18", key: "1pudct" }],
  ["path", { d: "M3 15h18", key: "5xshup" }],
  ["path", { d: "M9 3v18", key: "fh3hqa" }],
  ["path", { d: "M15 3v18", key: "14nvp0" }]
]);
const House = createLucideIcon("House", [
  ["path", { d: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8", key: "5wwlr5" }],
  [
    "path",
    {
      d: "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
      key: "1d0kgt"
    }
  ]
]);
const ReceiptText = createLucideIcon("ReceiptText", [
  [
    "path",
    { d: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z", key: "q3az6g" }
  ],
  ["path", { d: "M14 8H8", key: "1l3xfs" }],
  ["path", { d: "M16 12H8", key: "1fr5h0" }],
  ["path", { d: "M13 16H8", key: "wsln4y" }]
]);
const ShoppingBag = createLucideIcon("ShoppingBag", [
  ["path", { d: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z", key: "hou9p0" }],
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M16 10a4 4 0 0 1-8 0", key: "1ltviw" }]
]);
const CART_STORAGE_KEY = "zb_cart_v68a";
const CART_UPDATED_EVENT = "zb-cart-updated";
const EMPTY_CART = [];
let cachedCart = null;
function loadCart() {
  if (typeof window === "undefined") return EMPTY_CART;
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (raw === null) return EMPTY_CART;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_CART;
    const validItems = parsed.filter((item) => item.variantId && Number.isSafeInteger(item.quantity) && item.quantity > 0);
    return validItems.length > 0 ? validItems : EMPTY_CART;
  } catch {
    return EMPTY_CART;
  }
}
function readCart() {
  if (cachedCart === null) {
    cachedCart = loadCart();
  }
  return cachedCart;
}
function writeCart(items) {
  cachedCart = items;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
  }
}
function summarizeCart(items) {
  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalPaisa: addPaisa(items.map((item) => multiplyPaisa(item.unitPricePaisa, item.quantity)))
  };
}
function invalidateCartCache() {
  cachedCart = null;
}
function subscribe(onStoreChange) {
  const sync = () => {
    invalidateCartCache();
    onStoreChange();
  };
  window.addEventListener("storage", sync);
  window.addEventListener(CART_UPDATED_EVENT, sync);
  return () => {
    window.removeEventListener("storage", sync);
    window.removeEventListener(CART_UPDATED_EVENT, sync);
  };
}
function getServerSnapshot() {
  return EMPTY_CART;
}
function useLocalCart() {
  const items = reactExports.useSyncExternalStore(subscribe, readCart, getServerSnapshot);
  const snapshot = reactExports.useMemo(() => summarizeCart(items), [items]);
  return {
    ...snapshot,
    addItem(item) {
      const current = readCart();
      const existing = current.find((cartItem) => cartItem.variantId === item.variantId);
      const next = existing ? current.map(
        (cartItem) => cartItem.variantId === item.variantId ? { ...cartItem, quantity: cartItem.quantity + item.quantity, availableQuantity: item.availableQuantity } : cartItem
      ) : [...current, item];
      writeCart(next);
    },
    updateQuantity(variantId, quantity) {
      const next = readCart().map((item) => item.variantId === variantId ? { ...item, quantity } : item).filter((item) => item.quantity > 0);
      writeCart(next);
    },
    clear() {
      writeCart([]);
    }
  };
}
const navItems = [
  { href: "/", label: "Home", icon: House, match: (path) => path === "/" },
  { href: "/categories/pakistani-collection", label: "Shop", icon: Grid3x3, match: (path) => path.startsWith("/categories") },
  { href: "/checkout", label: "Cart", icon: ShoppingBag, match: (path) => path.startsWith("/checkout") },
  { href: "/orders", label: "Orders", icon: ReceiptText, match: (path) => path.startsWith("/orders") }
];
function BottomNav() {
  const [pathname, setPathname] = reactExports.useState("/");
  const [bump, setBump] = reactExports.useState(0);
  const cart = useLocalCart();
  const cartLabel = reactExports.useMemo(() => cart.itemCount > 9 ? "9+" : String(cart.itemCount), [cart.itemCount]);
  reactExports.useEffect(() => {
    setPathname(window.location.pathname);
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  reactExports.useEffect(() => {
    if (cart.itemCount > 0) setBump((b) => b + 1);
  }, [cart.itemCount]);
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "nav",
    {
      "aria-label": "Primary",
      className: "fixed inset-x-0 bottom-0 z-50 md:hidden glass-nav safe-bottom pt-1.5 shadow-[0_-8px_30px_rgba(0,0,0,0.06)]",
      children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mx-auto grid max-w-md grid-cols-4 gap-1 px-1", children: navItems.map((item) => {
        const active = item.match(pathname);
        const Icon2 = item.icon;
        return /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "a",
          {
            href: item.href,
            "aria-current": active ? "page" : void 0,
            className: `press tap-44 relative flex flex-col items-center justify-center rounded-2xl text-[10px] font-semibold transition-colors duration-200 ${active ? "text-[var(--brand)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`,
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs(
                "span",
                {
                  "aria-hidden": "true",
                  className: `relative mb-0.5 grid h-7 w-7 place-items-center rounded-full transition-all duration-300 ${active ? "bg-[var(--brand-light)] scale-110" : "bg-transparent scale-100"}`,
                  children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx(Icon2, { className: "h-[18px] w-[18px]", strokeWidth: active ? 2.4 : 2 }),
                    item.label === "Cart" && cart.itemCount > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx(
                      "span",
                      {
                        className: "pop absolute -right-1 -top-1 grid min-h-[16px] min-w-[16px] place-items-center rounded-full bg-[var(--brand)] px-1 text-[9px] font-bold text-white shadow-sm",
                        "aria-label": `${cart.itemCount} items in cart`,
                        children: cartLabel
                      },
                      bump
                    ) : null
                  ]
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: active ? "opacity-100" : "opacity-90", children: item.label })
            ]
          },
          item.href
        );
      }) })
    }
  );
}
var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(cooked.slice()) }));
var _a;
const $$RootLayout = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$RootLayout;
  const { title, description = "Premium boutique fashion from Wari, Dhaka with COD-first checkout.", activeCategory = "", ogImage } = Astro2.props;
  const canonicalUrl = new URL(Astro2.url.pathname, Astro2.site ?? "https://zabirboutiques.com").href;
  return renderTemplate(_a || (_a = __template(['<html lang="en"> <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="description"', '><link rel="canonical"', '><!-- Open Graph --><meta property="og:title"', '><meta property="og:description"', '><meta property="og:type" content="website"><meta property="og:url"', ">", `<!-- Icons --><link rel="icon" href="/assets/zabir-logo.jpg"><link rel="apple-touch-icon" href="/assets/zabir-logo.jpg"><!-- Theme: prevent flash by applying stored preference synchronously --><script>
      (function(){
        var t = localStorage.getItem('zb-theme');
        if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme:dark)').matches)) {
          document.documentElement.setAttribute('data-theme','dark');
        }
      })();
    <\/script><meta name="theme-color" content="#faf9f7" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1a1816" media="(prefers-color-scheme: dark)"><title>`, "</title>", '</head> <body class="font-sans antialiased"> <div class="min-h-dvh pb-24 md:pb-0"> ', " ", ' <main class="mx-auto max-w-7xl px-4 md:px-8 lg:px-16 py-6 md:py-10"> ', " </main> ", " </div> <!-- Bottom nav: idle-hydrated (not blocking LCP) --> ", " </body></html>"])), addAttribute(description, "content"), addAttribute(canonicalUrl, "href"), addAttribute(title, "content"), addAttribute(description, "content"), addAttribute(canonicalUrl, "content"), ogImage && renderTemplate`<meta property="og:image"${addAttribute(ogImage, "content")}>`, title, renderHead(), renderComponent($$result, "Header", $$Header, {}), renderComponent($$result, "CategoryRail", $$CategoryRail, { "activeSlug": activeCategory }), renderSlot($$result, $$slots["default"]), renderComponent($$result, "Footer", $$Footer, {}), renderComponent($$result, "BottomNav", BottomNav, { "client:idle": true, "client:component-hydration": "idle", "client:component-path": "@/islands/BottomNav", "client:component-export": "BottomNav" }));
}, "D:/Antigravity/zabir-boutiques/src/layouts/RootLayout.astro", void 0);
export {
  $$RootLayout as $
};
