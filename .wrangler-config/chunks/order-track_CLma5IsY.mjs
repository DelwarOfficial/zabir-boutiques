globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, m as maybeRenderHead } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { $ as $$RootLayout } from "./RootLayout_-lZcb627.mjs";
const prerender = false;
const $$OrderTrack = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "RootLayout", $$RootLayout, { "title": "Track Order — Zabir Boutiques" }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="max-w-xl mx-auto shell-card p-4 sm:p-6 fade-up"> <span class="chip chip-brand"> <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 7h11v10H3z"></path><path d="M14 10h4l3 3v4h-7z"></path><circle cx="7" cy="18" r="2"></circle><circle cx="17" cy="18" r="2"></circle></svg>
Track order
</span> <h1 class="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight">Where's my order?</h1> <p class="mt-2 text-sm leading-6 text-[var(--muted)]">Enter your phone number and order number to track delivery status. We normalize your number to the local 01X format before lookup.</p> <form class="mt-6 grid gap-4" method="post" action="/api/orders/track"> <label class="block"> <span class="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Phone Number</span> <input name="phone" type="tel" class="control" placeholder="017XXXXXXXX" autocomplete="tel" required> </label> <label class="block"> <span class="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Order Number</span> <input name="order_number" type="text" class="control" placeholder="ZB-20260606-A1B2C3" autocomplete="off" required> </label> <button type="submit" class="press tap-44 w-full h-12 rounded-full bg-[var(--brand)] text-white font-extrabold text-sm inline-flex items-center justify-center gap-2"> <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>
Track Order
</button> </form> </section> ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/order-track.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/order-track.astro";
const $$url = "/order-track";
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $$OrderTrack,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
