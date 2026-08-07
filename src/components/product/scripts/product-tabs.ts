interface TabElements {
  buttons: NodeListOf<HTMLElement>;
  panels: NodeListOf<HTMLElement>;
}

let elements: TabElements | null = null;

export function init(): void {
  elements = {
    buttons: document.querySelectorAll('[role="tab"]'),
    panels: document.querySelectorAll('[role="tabpanel"]'),
  };

  if (!elements.panels.length) return;

  elements.buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const tabId = button.dataset.tabId;
      if (tabId) switchTab(tabId);
    });
  });
}

function switchTab(targetTabId: string): void {
  if (!elements) return;

  elements.buttons.forEach((button) => {
    const tabId = button.dataset.tabId;
    const isActive = tabId === targetTabId;

    button.setAttribute('aria-selected', isActive ? 'true' : 'false');

    if (isActive) {
      button.classList.remove('border-transparent', 'text-[var(--muted)]');
      button.classList.add('border-[var(--brand)]', 'text-[var(--brand)]');
    } else {
      button.classList.remove('border-[var(--brand)]', 'text-[var(--brand)]');
      button.classList.add('border-transparent', 'text-[var(--muted)]');
    }
  });

  elements.panels.forEach((panel) => {
    const panelId = panel.dataset.tabPanel;
    if (panelId === targetTabId) {
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
