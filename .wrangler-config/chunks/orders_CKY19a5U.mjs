globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, m as maybeRenderHead } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { $ as $$RootLayout } from "./RootLayout_-lZcb627.mjs";
const $$Orders = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "RootLayout", $$RootLayout, { "title": "My Orders | Zabir Boutiques" }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="max-w-2xl mx-auto fade-up"> <div class="text-center py-6 sm:py-10"> <span class="chip chip-brand"> <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"></path></svg>
Order lookup
</span> <h1 class="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight">My orders</h1> <p class="mt-2 text-sm text-[var(--muted)]">Track any order placed with your phone number — no login required.</p> </div> <form class="shell-card p-4 sm:p-6 space-y-4" method="post" action="/api/orders/track"> <label class="block"> <span class="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Phone number</span> <input name="phone" type="tel" class="control" placeholder="017XXXXXXXX" autocomplete="tel" required> </label> <label class="block"> <span class="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Order number</span> <input name="order_number" type="text" class="control" placeholder="ZB-20260606-A1B2C3" autocomplete="off" required> </label> <button type="submit" class="press tap-44 w-full h-12 rounded-full bg-[var(--brand)] text-white font-extrabold text-sm inline-flex items-center justify-center gap-2"> <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>
Find my order
</button> </form> <ul class="mt-6 grid sm:grid-cols-3 gap-3 text-sm stagger"> <li class="shell-card p-4 flex items-start gap-2"> <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--brand-light)] text-[var(--brand)]"> <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"></path><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"></path></svg> </span> <div> <p class="font-extrabold">Live stock</p> <p class="text-[var(--muted)] text-xs">Fresh D1 read on every check.</p> </div> </li> <li class="shell-card p-4 flex items-start gap-2"> <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--brand-light)] text-[var(--brand)]"> <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg> </span> <div> <p class="font-extrabold">30-min reservation</p> <p class="text-[var(--muted)] text-xs">Held during checkout, released if you don't pay.</p> </div> </li> <li class="shell-card p-4 flex items-start gap-2"> <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--brand-light)] text-[var(--brand)]"> <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 9.4-8 10-4.5-.6-8-5-8-10V6z"></path></svg> </span> <div> <p class="font-extrabold">Server-authoritative</p> <p class="text-[var(--muted)] text-xs">No overselling, ever.</p> </div> </li> </ul> </section> ` })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/orders.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/orders.astro";
const $$url = "/orders";
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $$Orders,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
