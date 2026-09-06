// Vesk PWA — auto-generated service worker (strategy: stale-while-revalidate)
const CACHE = 'vesk-pwa-v1';
self.addEventListener('install', (e) => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.protocol === 'chrome-extension:' || url.protocol === 'chrome:' || url.protocol === 'file:') return;
  e.respondWith((async () => {
    try {
      const cached = await caches.match(e.request);
      const resp = await fetch(e.request);
      if (resp && resp.ok) { const cache = await caches.open(CACHE); cache.put(e.request, resp.clone()); }
      return cached || resp;
    } catch { return caches.match(e.request); }
  })());
});
