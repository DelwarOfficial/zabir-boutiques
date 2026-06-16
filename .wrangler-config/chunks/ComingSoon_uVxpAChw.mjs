globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { m as maybeRenderHead, b as addAttribute, r as renderTemplate, a as renderSlot } from "./sequence_XySMyPne.mjs";
const $$ComingSoon = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$ComingSoon;
  const { title = "Coming soon", description, status = "planned" } = Astro2.props;
  const badge = {
    planned: { label: "Planned", cls: "bg-amber-100 text-amber-800" },
    restricted: { label: "Restricted", cls: "bg-red-100 text-red-800" },
    unavailable: { label: "Not available", cls: "bg-line-soft text-ink-secondary" }
  };
  const hasExtra = Astro2.slots.has("default");
  return renderTemplate`${maybeRenderHead()}<div class="border border-line border-dashed rounded-xl bg-surface-soft px-6 py-10 sm:px-10 sm:py-12 text-center max-w-xl mx-auto mt-2"> <div class="mx-auto mb-4 flex items-center justify-center w-12 h-12 rounded-full bg-surface border border-line text-muted" aria-hidden="true"> <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"> <circle cx="12" cy="12" r="9"></circle> <path d="M12 7v5l3 2"></path> </svg> </div> <span${addAttribute(`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider mb-3 ${badge[status].cls}`, "class")}> ${badge[status].label} </span> <h2 class="m-0 text-base font-semibold text-ink">${title}</h2> ${description && renderTemplate`<p class="mt-2 mb-0 text-sm text-muted leading-relaxed">${description}</p>`} ${hasExtra && renderTemplate`<div class="mt-4 text-left text-sm text-ink-secondary"> ${renderSlot($$result, $$slots["default"])} </div>`} </div>`;
}, "D:/Antigravity/zabir-boutiques/src/components/staff/ComingSoon.astro", void 0);
export {
  $$ComingSoon as $
};
