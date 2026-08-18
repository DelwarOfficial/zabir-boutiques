# Product Size Guide Implementation Prompt

Use the following prompt with an AI coding agent working in the Zabir Boutiques repository.

---

## Prompt

Act as a senior e-commerce UI/UX designer and Astro frontend engineer. Design and implement a polished, accessible product guideline and size-chart experience for the Zabir Boutiques apparel storefront.

### Project Context

- Framework: Astro 7.2 in server output mode with `@astrojs/cloudflare`.
- UI architecture: Astro-first, server-rendered HTML with minimal client JavaScript.
- Styling: Tailwind CSS v4 and the existing storefront tokens documented in `docs/DESIGN_SYSTEM.md` and `docs/DESIGN_TOKENS_QUICK_REFERENCE.md`.
- Existing route: `src/pages/size-guide.astro`. It must be one of the five approved static routes and explicitly declare `export const prerender = true`.
- Target users: Bangladesh-based shoppers, including users on low-end Android devices and unstable mobile connections.
- Accessibility target: WCAG 2.1 AA.
- Security: preserve the existing Content Security Policy. Do not add `unsafe-inline`, inline event handlers, inline `<script>` blocks, or runtime inline styles.

### Objective

Replace the placeholder `/size-guide` page with a clean, modern, mobile-responsive guide that helps customers compare product measurements before selecting a size. The page must provide an accessible tab or segmented-control interface for switching between:

1. Pant Size Chart
2. Dress Size Chart

Use an Astro component for the rendered UI. Do not introduce React or another hydrated framework merely for the tab interaction. If client-side enhancement is needed, place it in a small external TypeScript module and keep both charts available in the server-rendered HTML as a no-JavaScript fallback.

### Verified Measurement Data

Treat every value below as approved product data. Preserve it exactly; do not infer, average, normalize, or silently correct any measurement.

#### Pant Size Chart

| Size | Waist | Length | Hip | Thigh | Leg Open |
| :--- | :--- | :--- | :--- | :--- | :--- |
| S-38 | 13 | 38 | 24 | 12 | 8/9 |
| M-40,42 | 14 | 40 | 26 | 14 | 8/9 |
| L-44,46 | 14 | 39 | 25 | 13 | 8/9 |
| XL-48 | 15 | 39 | 27 | 13 | 8/9 |

#### Dress Size Chart

| Size | Bust | Waist | Hip | Sleeve Length | Full Length |
| :--- | :--- | :--- | :--- | :--- | :--- |
| S-38 | 20 | 21 | 22 | 22 | 45 |
| M-40,42 | 21 | 21 | 23 | 22 | 48 |
| L-44,46 | 23 | 23 | 24 | 23 | 48 |
| XL-48 | 23 | 24 | 24 | 24 | 50 |

### UX and Visual Requirements

- Use a warm, editorial boutique aesthetic consistent with Zabir Boutiques, not a generic dashboard table.
- Use the existing storefront surface, ink, border, and brand tokens. Do not introduce a parallel color system or hard-code colors already represented by tokens.
- Present the charts inside a restrained card or section with clear hierarchy, subtle borders, an off-white page background, and high-contrast dark text.
- Use a properly associated accessible tab pattern with `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls`, and keyboard support for Left Arrow, Right Arrow, Home, and End.
- Keep the controls at least 44 by 44 CSS pixels on touch devices and provide visible `:focus-visible` states.
- Use semantic `<table>`, `<caption>`, `<thead>`, `<tbody>`, `<th scope="col">`, and `<th scope="row">` markup. Do not recreate tabular data with generic grid `<div>` elements.
- Add subtle alternating row surfaces and hover/focus-within feedback without reducing text contrast.
- On narrow screens, wrap each table in a labelled horizontal scroll region. Keep the table header visible during vertical scrolling and the Size column visible during horizontal scrolling where browser support permits.
- Add a lightweight visual cue that the table can scroll horizontally. Do not hide the native scrollbar in a way that harms discoverability or keyboard use.
- Add a compact "How to Measure" helper using a semantic `<details>` disclosure or another accessible pattern. Explain how to measure waist, bust, hip, thigh, sleeve length, full length, and leg opening with a flexible tape while keeping it level and not pulling it tight.
- State clearly that all values are in inches.
- Include this customer note near the charts: "These are standard product measurements, not body measurements. Measure a similar well-fitting garment and compare the measurements before selecting S-38, M-40/42, L-44/46, or XL-48. Small variations may occur due to the production process."
- Do not add fake actions such as download, print, fit prediction, unit conversion, or personalized recommendations unless they are fully implemented and tested.
- Respect `prefers-reduced-motion`; any transition must be subtle and nonessential.

### Astro and Code Requirements

- Inspect existing project components and styles before editing so the implementation reuses established patterns.
- Prefer a reusable component such as `src/components/product/SizeGuide.astro`, rendered by `src/pages/size-guide.astro` and reusable from a product-details surface later.
- Keep the verified chart data in typed, immutable TypeScript structures rather than duplicating table markup by hand.
- Render the data at build time through Astro. The component must not fetch this static data from an API.
- Preserve `RootLayout` and route metadata, and ensure `/size-guide` declares `export const prerender = true` to match the master-plan route contract.
- Use Tailwind utilities and existing semantic tokens. Add Astro-scoped CSS only where sticky-table behavior or scrollbar affordances cannot be expressed cleanly.
- If JavaScript is used for tabs, use a small external module under `src/scripts/` or a component-adjacent `scripts/` directory. Initialize it once, use resilient `data-*` selectors, and avoid duplicate listeners during Astro navigation.
- Do not use `client:load`, `client:idle`, or a React island for this static information unless repository evidence proves it is necessary.
- Do not use inline handlers such as `onclick`, `is:inline` scripts, `innerHTML`, or style mutations such as `element.style.*`.
- Ensure the page has no mojibake or malformed symbols and uses consistent UTF-8 text.

### Responsive Behavior

- Mobile baseline: 360px viewport with no page-level horizontal overflow.
- The table itself may scroll horizontally inside its container while the surrounding page remains fixed.
- Tablet and desktop: allow the chart card to expand naturally, keep readable column spacing, and avoid excessively wide text lines.
- Long labels such as "Sleeve Length" and "Full Length" must remain readable without overlapping or clipping.

### Validation and Tests

- Add focused tests that assert the exact approved data, both tab labels, unit label, customer note, semantic table headers, and accessible tab relationships.
- Test keyboard tab switching if JavaScript enhancement is introduced.
- Verify the no-JavaScript output still exposes both data tables meaningfully.
- Run the relevant Vitest tests, TypeScript checks, and Astro build.
- Confirm there are no browser-console errors, hydration warnings, accessibility violations introduced by the interaction, or CSP violations on `/size-guide`.
- Check the page at 360px, 768px, and desktop widths.

### Deliverables

Implement the feature, tests, and any minimal supporting styles or script. Then summarize:

- the component and interaction approach;
- files changed;
- accessibility and mobile behavior;
- validation commands and results;
- any assumptions, especially around the meaning of the verified measurements.

Do not change product measurement values or weaken any existing security, rendering, performance, or accessibility guardrail.
