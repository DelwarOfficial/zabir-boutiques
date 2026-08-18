// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SIZE_GUIDE_CHARTS, SIZE_GUIDE_CUSTOMER_NOTE } from "@/data/size-guide";
import { initSizeGuides } from "@/components/product/scripts/size-guide-tabs";

function read(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

function renderTabFixture(): void {
  document.body.innerHTML = `
    <section data-size-guide>
      <div role="tablist" aria-label="Choose a size chart">
        <button id="tab-pant" role="tab" aria-selected="true" aria-controls="panel-pant" data-size-guide-tab>Pant</button>
        <button id="tab-dress" role="tab" aria-selected="false" aria-controls="panel-dress" data-size-guide-tab>Dress</button>
      </div>
      <section id="panel-pant" role="tabpanel" aria-labelledby="tab-pant" data-size-guide-panel>Pant chart</section>
      <section id="panel-dress" role="tabpanel" aria-labelledby="tab-dress" data-size-guide-panel>Dress chart</section>
    </section>
  `;
}

describe("size guide data", () => {
  it("preserves the verified pant measurements exactly", () => {
    expect(SIZE_GUIDE_CHARTS[0]).toEqual({
      id: "pant",
      label: "Pant Size Chart",
      caption: "Pant product measurements in inches",
      headers: ["Size", "Waist", "Length", "Hip", "Thigh", "Leg Open"],
      rows: [
        ["S-38", "13", "38", "24", "12", "8/9"],
        ["M-40,42", "14", "40", "26", "14", "8/9"],
        ["L-44,46", "14", "39", "25", "13", "8/9"],
        ["XL-48", "15", "39", "27", "13", "8/9"],
      ],
    });
  });

  it("preserves the verified dress measurements exactly", () => {
    expect(SIZE_GUIDE_CHARTS[1]).toEqual({
      id: "dress",
      label: "Dress Size Chart",
      caption: "Dress product measurements in inches",
      headers: ["Size", "Bust", "Waist", "Hip", "Sleeve Length", "Full Length"],
      rows: [
        ["S-38", "20", "21", "22", "22", "45"],
        ["M-40,42", "21", "21", "23", "22", "48"],
        ["L-44,46", "23", "23", "24", "23", "48"],
        ["XL-48", "23", "24", "24", "24", "50"],
      ],
    });
  });

  it("keeps the approved product-measurement guidance", () => {
    expect(SIZE_GUIDE_CUSTOMER_NOTE).toContain("standard product measurements, not body measurements");
    expect(SIZE_GUIDE_CUSTOMER_NOTE).toContain("S-38, M-40/42, L-44/46, or XL-48");
  });
});

describe("size guide Astro contract", () => {
  it("is prerendered without adding a React island", () => {
    const page = read("src/pages/size-guide.astro");
    expect(page).toContain("export const prerender = true");
    expect(page).toContain("<SizeGuide />");
    expect(page).not.toMatch(/client:(load|idle|visible|only)/);
  });

  it("uses semantic, accessible tables and CSP-safe enhancement", () => {
    const component = read("src/components/product/SizeGuide.astro");
    expect(component).toContain('role="tablist"');
    expect(component).toContain('role="tab"');
    expect(component).toContain('role="tabpanel"');
    expect(component).toContain('scope="col"');
    expect(component).toContain('scope="row"');
    expect(component).toContain("<caption");
    expect(component).toContain("How to measure");
    expect(component).toContain("All measurements in inches");
    expect(component).not.toContain("is:inline");
    expect(component).not.toMatch(/\son[a-z]+=/i);
    expect(component).not.toMatch(/\sstyle=/i);
  });
});

describe("size guide tab enhancement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("leaves both charts exposed before JavaScript enhancement", () => {
    renderTabFixture();
    const panels = document.querySelectorAll<HTMLElement>("[data-size-guide-panel]");
    expect(Array.from(panels).every((panel) => panel.hidden === false)).toBe(true);
  });

  it("switches panels on click and initializes only once", () => {
    renderTabFixture();
    initSizeGuides();
    initSizeGuides();

    const pant = document.querySelector<HTMLButtonElement>("#tab-pant")!;
    const dress = document.querySelector<HTMLButtonElement>("#tab-dress")!;
    const pantPanel = document.querySelector<HTMLElement>("#panel-pant")!;
    const dressPanel = document.querySelector<HTMLElement>("#panel-dress")!;

    expect(pantPanel.hidden).toBe(false);
    expect(dressPanel.hidden).toBe(true);
    dress.click();
    expect(pant.getAttribute("aria-selected")).toBe("false");
    expect(dress.getAttribute("aria-selected")).toBe("true");
    expect(pantPanel.hidden).toBe(true);
    expect(dressPanel.hidden).toBe(false);
  });

  it("supports Arrow, Home, and End keyboard navigation", () => {
    renderTabFixture();
    initSizeGuides();

    const pant = document.querySelector<HTMLButtonElement>("#tab-pant")!;
    const dress = document.querySelector<HTMLButtonElement>("#tab-dress")!;

    pant.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(dress);
    expect(dress.getAttribute("aria-selected")).toBe("true");

    dress.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(pant);

    pant.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(dress);

    dress.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(document.activeElement).toBe(pant);
  });
});
