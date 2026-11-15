/* Cache only public static assets. Authenticated pages, documents and APIs stay on the network. */
const CACHE = "detali-static-v1";
const ASSETS = ["/offline.html", "/brand/app-192.png", "/brand/app-512.png", "/brand/detali.svg"];
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("detali-static-") && key !== CACHE).map(key => caches.delete(key))))); self.clients.claim(); });
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (ASSETS.includes(url.pathname)) { event.respondWith(caches.match(request).then(cached => cached || fetch(request))); return; }
  if (request.mode === "navigate") event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
});
