const ROOT_SELECTOR = "[data-size-guide]";
const TAB_SELECTOR = "[data-size-guide-tab]";
const PANEL_SELECTOR = "[data-size-guide-panel]";

function activateTab(root: HTMLElement, nextTab: HTMLButtonElement, moveFocus: boolean): void {
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>(TAB_SELECTOR));
  const panels = Array.from(root.querySelectorAll<HTMLElement>(PANEL_SELECTOR));
  const targetPanelId = nextTab.getAttribute("aria-controls");

  for (const tab of tabs) {
    const isActive = tab === nextTab;
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  }

  for (const panel of panels) {
    panel.hidden = panel.id !== targetPanelId;
  }

  if (moveFocus) nextTab.focus();
}

function initializeSizeGuide(root: HTMLElement): void {
  if (root.dataset.sizeGuideInitialized === "true") return;

  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>(TAB_SELECTOR));
  if (tabs.length === 0) return;

  root.dataset.sizeGuideInitialized = "true";
  activateTab(root, tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ?? tabs[0], false);

  for (const tab of tabs) {
    tab.addEventListener("click", () => activateTab(root, tab, false));
    tab.addEventListener("keydown", (event) => {
      const currentIndex = tabs.indexOf(tab);
      let nextIndex: number | undefined;

      if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
      if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabs.length - 1;
      if (nextIndex === undefined) return;

      event.preventDefault();
      activateTab(root, tabs[nextIndex], true);
    });
  }
}

export function initSizeGuides(scope: ParentNode = document): void {
  scope.querySelectorAll<HTMLElement>(ROOT_SELECTOR).forEach(initializeSizeGuide);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initSizeGuides(), { once: true });
} else {
  initSizeGuides();
}

document.addEventListener("astro:page-load", () => initSizeGuides());
