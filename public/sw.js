// RebateHQ offline mode (chunk 8C-2). Caches only the app shell: the signed-in page's HTML, the build's static
// files under /_next/static/, the engine files under /spike/ (the worker still checks their pinned SHA-256 before
// use), the manifest and the icon. It never touches /api/ or any other request, never caches a POST, a query-string
// request or a redirect, and never sees business data: pricing, costs and invoices live in the encrypted local vault
// (OPFS), not in HTTP responses. No background or periodic sync is registered.
const CACHE = "rebatehq-shell-v1";
const SHELL = [/^\/home$/, /^\/lab\/vault$/];
// Content-hashed build files are cache-first. Fixed-name files (engine, manifest, icon) and the page are network-first,
// so an update is used whenever the network answers and the stored copy is only the offline fallback.
const HASHED = [/^\/_next\/static\//];
const FIXED = [/^\/spike\//, /^\/manifest\.webmanifest$/, /^\/icon\.svg$/];
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
const cacheable = response => response && response.ok && response.type === "basic" && !response.redirected;
async function networkFirst(request, key, navigation) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // Signed out (redirected to the sign-in page): drop the stored shell so it cannot open offline.
    if (navigation && response.redirected) await cache.delete(key); else if (cacheable(response)) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw error;
  }
}
async function cacheFirst(request) {
  const cache = await caches.open(CACHE), hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(request, response.clone());
  return response;
}
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.search) return;
  if (request.mode === "navigate") { if (SHELL.some(p => p.test(url.pathname))) event.respondWith(networkFirst(request, url.pathname, true)); return; }
  if (HASHED.some(p => p.test(url.pathname))) event.respondWith(cacheFirst(request));
  else if (FIXED.some(p => p.test(url.pathname))) event.respondWith(networkFirst(request, url.pathname, false));
});
// The page asks to forget the offline copy (sign-out, or "Remove offline copy" in Settings).
self.addEventListener("message", event => {
  if (event.data && event.data.type === "rebatehq-offline-clear") event.waitUntil(caches.delete(CACHE).then(() => event.ports[0] && event.ports[0].postMessage("cleared")));
});
