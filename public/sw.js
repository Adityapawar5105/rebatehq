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
// Roadmap 14.4 (audit N-2): every release adds new content-hashed files and nothing removed the old ones. This file
// does not change between releases, so "activate" does not run per release. Instead a build is named by a hash of the
// /_next/static/ paths its page references; each stored static file carries the build that last used it; when the page
// of a new build is stored, static files last used by neither that build nor the previous one are deleted. The previous
// build is kept so a tab still running it can load its remaining chunks. A file deleted too early is fetched again.
const TAG = "x-rebatehq-build", PREVIOUS = "x-rebatehq-previous-build";
let current = "";
function buildOf(html) {
  const refs = [...new Set(html.match(/\/_next\/static\/[^"'\s)?#\\]+/g) || [])].sort().join("\n");
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < refs.length; i++) { const c = refs.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x811c9dc5); }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
function tagged(response, body, tags) {
  const headers = new Headers(response.headers);
  headers.delete("content-encoding"); headers.delete("content-length");
  for (const [name, value] of Object.entries(tags)) headers.set(name, value);
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
async function currentBuild(cache) {
  if (current) return current;
  for (const path of ["/home", "/lab/vault"]) { const hit = await cache.match(path), build = hit && hit.headers.get(TAG); if (build) return (current = build); }
  return "";
}
async function storePage(cache, key, response) {
  const html = await response.text(), build = buildOf(html), before = await currentBuild(cache), old = await cache.match(key);
  const changed = before !== "" && before !== build, previous = changed ? before : (old && old.headers.get(PREVIOUS)) || build;
  current = build;
  await cache.put(key, tagged(response, html, { [TAG]: build, [PREVIOUS]: previous }));
  if (changed) for (const request of await cache.keys()) {
    if (!HASHED.some(p => p.test(new URL(request.url).pathname))) continue;
    const hit = await cache.match(request), tag = hit && hit.headers.get(TAG);
    if (tag !== build && tag !== previous) await cache.delete(request);
  }
}
async function networkFirst(request, key, navigation) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // Signed out (redirected to the sign-in page): drop the stored shell so it cannot open offline.
    if (navigation && response.redirected) await cache.delete(key); else if (cacheable(response)) { if (navigation) await storePage(cache, key, response.clone()); else await cache.put(key, response.clone()); }
    return response;
  } catch (error) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw error;
  }
}
async function cacheFirst(request) {
  const cache = await caches.open(CACHE), build = await currentBuild(cache), hit = await cache.match(request);
  if (hit) {
    if (build && hit.headers.get(TAG) !== build) await cache.put(request, tagged(hit, await hit.clone().blob(), { [TAG]: build }));
    return hit;
  }
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(request, tagged(response, await response.clone().blob(), { [TAG]: build }));
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
