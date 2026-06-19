/**
 * Zabir Boutiques service worker — e-commerce safe caching.
 * Version token __SW_VERSION__ is replaced at build time by scripts/generate-sw.mjs.
 *
 * Strategy:
 * - Network-only: API, staff, checkout, orders, payments, cart mutations, stock
 * - Cache-first: hashed build assets (/ _astro /), icons, offline shell
 * - Network-first navigations with offline.html fallback (never cache HTML)
 */
/* global self, caches, fetch */

const SW_VERSION = '__SW_VERSION__';
const STATIC_CACHE = `zb-static-${SW_VERSION}`;

/** Precached shell assets — safe to version with each deploy. */
const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/favicon.svg',
  '/favicon.ico',
];

/** Never intercept — always hit the network (fresh commerce data). */
const NETWORK_ONLY = [
  /^\/api(?:\/|$)/,
  /^\/staff(?:\/|$)/,
  /^\/checkout(?:\/|$)/,
  /^\/orders(?:\/|$)/,
  /^\/order-track(?:\/|$)/,
  /^\/buy-now(?:\/|$)/,
  /^\/_image(?:\/|$)/,
  /^\/_server-islands(?:\/|$)/,
];

/** Immutable hashed bundles — safe to cache long-term. */
const ASSET_PREFIXES = ['/_astro/', '/icons/', '/assets/zabir-logo.jpg'];

function isNetworkOnly(url) {
  return NETWORK_ONLY.some((re) => re.test(url.pathname));
}

function isStaticAsset(url) {
  if (url.pathname === '/favicon.svg' || url.pathname === '/favicon.ico') return true;
  return ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key.startsWith('zb-static-') && key !== STATIC_CACHE).map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isNetworkOnly(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/offline.html').then((cached) => cached || Response.error()),
      ),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
  }
});