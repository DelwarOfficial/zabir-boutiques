import { getCsrf } from '@/lib/csrf-client';

type StaffFormPayload = {
  message?: string;
  error?: string;
  redirect?: string;
  redirect_url?: string;
  [key: string]: unknown;
};

function syncCsrfToken(): void {
  const meta = document.querySelector('meta[name="zb-csrf"]');
  const csrfToken = meta instanceof HTMLMetaElement ? meta.content : '';
  window.__ZB_CSRF__ = csrfToken;

  try {
    if (csrfToken) {
      sessionStorage.setItem('zb-csrf', csrfToken);
    }
  } catch {
    // Ignore storage failures in private browsing or locked-down contexts.
  }
}

function applyStoredTheme(): void {
  try {
    const storedTheme = localStorage.getItem('zb-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldUseDark = storedTheme === 'dark' || (!storedTheme && prefersDark);
    document.documentElement.setAttribute('data-theme', shouldUseDark ? 'dark' : 'light');
  } catch {
    document.documentElement.setAttribute('data-theme', 'light');
  }
}

function setupSidebar(): void {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  const backdrop = document.getElementById('sidebar-backdrop');

  if (!(sidebar instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement) || !(backdrop instanceof HTMLElement)) {
    return;
  }

  const setOpen = (open: boolean) => {
    sidebar.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  toggle.addEventListener('click', () => setOpen(!sidebar.classList.contains('open')));
  backdrop.addEventListener('click', () => setOpen(false));
  sidebar.addEventListener('click', (event) => {
    if (window.innerWidth <= 768 && event.target instanceof HTMLAnchorElement) {
      setOpen(false);
    }
  });
}

function setupLogout(): void {
  const logoutButton = document.getElementById('logout-btn');
  if (!(logoutButton instanceof HTMLButtonElement)) return;

  logoutButton.addEventListener('click', async () => {
    try {
      await fetch('/api/staff/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
      });
    } catch {
      // Best-effort logout; redirect regardless so the session cookie can be rechecked.
    }

    window.location.href = '/staff/login';
  });
}

function setupStaffForms(): void {
  document.addEventListener(
    'submit',
    async (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;

      const action = form.getAttribute('action') || '';
      const enctype = form.getAttribute('enctype') || '';
      if (form.method.toLowerCase() !== 'post' || !action.includes('/api/staff/')) return;
      if (enctype.includes('multipart') || form.dataset.noAutoCsrf !== undefined) return;

      const csrf = getCsrf();
      if (!csrf) return;

      event.preventDefault();

      const data = new FormData(form);
      const body = new URLSearchParams();
      data.forEach((value, key) => body.append(key, typeof value === 'string' ? value : value.name));

      const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submitButton instanceof HTMLButtonElement || submitButton instanceof HTMLInputElement) {
        submitButton.disabled = true;
      }

      try {
        const response = await fetch(action, {
          method: 'POST',
          headers: {
            'X-CSRF-Token': csrf,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        });
        const isJson = (response.headers.get('content-type') || '').includes('application/json');
        const payload: StaffFormPayload = isJson
          ? await response.json().then((value) => value as StaffFormPayload).catch(() => ({} as StaffFormPayload))
          : {};

        if (response.ok) {
          if (typeof window.showToast === 'function') {
            window.showToast(payload.message || 'Saved successfully.', 'success');
          }

          document.dispatchEvent(
            new CustomEvent('staff:form-success', {
              detail: { action, formId: form.id || null, payload },
            }),
          );

          const redirectTarget =
            typeof payload.redirect_url === 'string'
              ? payload.redirect_url
              : typeof payload.redirect === 'string'
                ? payload.redirect
                : '';

          if (redirectTarget) {
            window.location.href = redirectTarget;
            return;
          }

          if (form.dataset.resetOnSuccess !== 'false') {
            form.reset();
          }

          if (form.dataset.reloadOnSuccess === 'true') {
            window.location.reload();
          }
        } else if (typeof window.showToast === 'function') {
          window.showToast(payload.error || payload.message || 'Action failed.', 'error');
        }
      } catch {
        if (typeof window.showToast === 'function') {
          window.showToast('Network error. Try again.', 'error');
        }
      } finally {
        if (submitButton instanceof HTMLButtonElement || submitButton instanceof HTMLInputElement) {
          submitButton.disabled = false;
        }
      }
    },
    true,
  );
}

syncCsrfToken();
applyStoredTheme();
setupSidebar();
setupLogout();
setupStaffForms();
