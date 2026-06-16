globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { m as maybeRenderHead, r as renderTemplate, a as renderSlot } from "./sequence_XySMyPne.mjs";
const $$PageHeader = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$PageHeader;
  const { title, subtitle } = Astro2.props;
  const hasActions = Astro2.slots.has("actions");
  return renderTemplate`${maybeRenderHead()}<div class="flex items-start justify-between gap-3 flex-wrap mb-5 fade-up"> <div class="min-w-0"> <h1 class="m-0 text-xl sm:text-2xl font-extrabold text-ink leading-tight tracking-tight break-words">${title}</h1> ${subtitle && renderTemplate`<p class="mt-1 mb-0 text-sm text-muted">${subtitle}</p>`} </div> ${hasActions && renderTemplate`<div class="flex items-center gap-2 flex-wrap shrink-0"> ${renderSlot($$result, $$slots["actions"])} </div>`} </div>`;
}, "D:/Antigravity/zabir-boutiques/src/components/staff/PageHeader.astro", void 0);
export {
  $$PageHeader as $
};
