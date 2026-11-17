/**
 * Jagruk Jaipur — Service Worker (PWA)
 * Basic offline cache for PWA support
 */

const CACHE_NAME = 'jagruk-v3';
const STATIC_ASSETS = [
  '/favicon/site.webmanifest',
  '/img/logo.webp',
];

// Paths that must never be cached or intercepted.
const NO_CACHE_PREFIXES = ['/admin', '/api/', '/organizer'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache admin / API / organizer portal, or anything that is not a GET
  if (NO_CACHE_PREFIXES.some(p => url.pathname.startsWith(p)) || event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-First for HTML pages (so users always see new events!)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request)) // Fallback to offline cached HTML
    );
    return;
  }

  // Stale-While-Revalidate for static assets (CSS, JS, Images)
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse.ok) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => null);

      return cachedResponse || fetchPromise;
    })
  );
});
