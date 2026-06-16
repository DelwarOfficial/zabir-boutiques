globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { m as maybeRenderHead, r as renderTemplate } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { $ as $$RootLayout } from "./RootLayout_-lZcb627.mjs";
const $$CheckoutSkeleton = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${maybeRenderHead()}<div class="space-y-5 fade-in" aria-hidden="true"> <div class="space-y-2"> <div class="h-3 w-32 rounded-full skeleton"></div> <div class="h-8 w-2/3 rounded-md skeleton"></div> <div class="h-3 w-1/2 rounded-full skeleton"></div> </div> <div class="flex gap-2"> ${Array.from({ length: 4 }).map(() => renderTemplate`<div class="h-9 w-20 rounded-full skeleton"></div>`)} </div> <div class="grid gap-4 lg:grid-cols-[1fr_360px]"> <div class="shell-card space-y-4 p-4 sm:p-5"> <div class="h-4 w-24 rounded-full skeleton"></div> <div class="h-12 rounded-md skeleton"></div> <div class="h-12 rounded-md skeleton"></div> <div class="h-28 rounded-md skeleton"></div> <div class="grid grid-cols-2 gap-2"> <div class="h-16 rounded-md skeleton"></div> <div class="h-16 rounded-md skeleton"></div> </div> <div class="grid grid-cols-2 gap-2"> <div class="h-14 rounded-md skeleton"></div> <div class="h-14 rounded-md skeleton"></div> </div> <div class="h-12 rounded-full skeleton"></div> </div> <div class="shell-card p-4 sm:p-5"> <div class="h-4 w-36 rounded-full skeleton"></div> <div class="mt-4 space-y-3"> <div class="h-16 rounded-md skeleton"></div> <div class="h-16 rounded-md skeleton"></div> <div class="h-24 rounded-md skeleton"></div> </div> </div> </div> </div>`;
}, "D:/Antigravity/zabir-boutiques/src/components/checkout/CheckoutSkeleton.astro", void 0);
const prerender = false;
const $$Checkout = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "RootLayout", $$RootLayout, { "title": "Guest Checkout | Zabir Boutiques" }, { "default": ($$result2) => renderTemplate` ${renderComponent($$result2, "GuestCheckout", null, { "client:only": "react", "client:component-hydration": "only", "client:component-path": "@/islands/GuestCheckout", "client:component-export": "GuestCheckout" }, { "fallback": ($$result3) => renderTemplate`${renderComponent($$result3, "CheckoutSkeleton", $$CheckoutSkeleton, { "slot": "fallback" })}` })} ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/checkout.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/checkout.astro";
const $$url = "/checkout";
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $$Checkout,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
