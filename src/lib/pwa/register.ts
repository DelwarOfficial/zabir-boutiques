/**
 * Registers the production service worker on public storefront pages only.
 * Staff, checkout, and API routes are excluded from SW scope handling in sw.js.
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  const { hostname, pathname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return;
  if (pathname.startsWith('/staff')) return;

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[pwa] Service worker registration failed', err);
      });
  });
}