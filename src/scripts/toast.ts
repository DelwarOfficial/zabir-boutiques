const TOAST_VARIANTS: Record<string, string> = {
  success: 'bg-emerald-50/95 border-emerald-100 text-emerald-800 dark:bg-emerald-950/95 dark:text-emerald-300 dark:border-transparent',
  error: 'bg-red-50/95 border-red-100 text-red-800 dark:bg-red-950/95 dark:text-red-300 dark:border-transparent',
  info: 'bg-[var(--surface-storefront-soft)] border-[var(--border-storefront)] text-[var(--ink-storefront-secondary)]',
};

const TOAST_ICONS: Record<string, string> = {
  success:
    '<svg class="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>',
  error:
    '<svg class="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
  info:
    '<svg class="h-4 w-4 shrink-0 text-[var(--brand-storefront)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
};

window.showToast = function showToast(message, variant = 'success', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className =
    'toast pop pointer-events-auto flex items-start gap-2.5 rounded-2xl border p-4 text-xs font-semibold shadow-lg backdrop-blur-md transition-all duration-300 ' +
    (TOAST_VARIANTS[variant] || TOAST_VARIANTS.info);

  toast.innerHTML = `
    ${TOAST_ICONS[variant] || TOAST_ICONS.info}
    <div class="flex-1 leading-normal pr-1">${message}</div>
    <button type="button" class="tap-44 -mr-1.5 -mt-1 rounded-full p-0.5 opacity-70 hover:bg-black/5 hover:opacity-100 focus-visible:outline-none" aria-label="Dismiss toast">
      <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
    </button>
  `;

  const removeToast = () => {
    toast.classList.add('toast-leaving');
    window.setTimeout(() => toast.remove(), 300);
  };

  toast.querySelector('button')?.addEventListener('click', removeToast);
  container.appendChild(toast);

  if (duration > 0) {
    window.setTimeout(removeToast, duration);
  }
};
