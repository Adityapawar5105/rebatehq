// Chunk 8C-2: the offline service worker (public/sw.js), run in a VM with fake caches and network. It must cache only the
// app shell (the signed-in page's HTML, /_next/static, /spike engine files, manifest, icon), serve them offline, and
// never intercept or store anything else: no /api/, no POST, no query-string request, no redirect, no other origin.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";

const ORIGIN = "https://app.rebatehq.test";
type Handler = (event: Record<string, unknown>) => void;
function load() {
  const handlers: Record<string, Handler[]> = {}, store = new Map<string, Map<string, Response>>(), calls: string[] = [];
  let online = true, redirect = false;
  const key = (r: Request | string) => typeof r === "string" ? r : new URL(r.url).href;
  const caches = {
    keys: async () => [...store.keys()], delete: async (n: string) => store.delete(n),
    open: async (n: string) => { if (!store.has(n)) store.set(n, new Map()); const m = store.get(n)!; return {
      match: async (r: Request | string) => { const k = key(r); const hit = m.get(k.startsWith("/") ? ORIGIN + k : k); return hit?.clone(); },
      put: async (r: Request | string, res: Response) => { const k = key(r); m.set(k.startsWith("/") ? ORIGIN + k : k, res); },
      delete: async (r: Request | string) => { const k = key(r); return m.delete(k.startsWith("/") ? ORIGIN + k : k); },
      keys: async () => [...m.keys()].map(k => new Request(k)) }; },
  };
  const pages = new Map<string, string>();
  const fetch = async (r: Request) => {
    calls.push(new URL(r.url).pathname); if (!online) throw new TypeError("Failed to fetch");
    const res = new Response(pages.get(new URL(r.url).pathname) ?? "body of " + new URL(r.url).pathname, { status: 200, headers: { "content-type": "text/html" } });
    Object.defineProperty(res, "type", { value: "basic" }); Object.defineProperty(res, "redirected", { value: redirect }); return res;
  };
  const self = { location: new URL(ORIGIN), clients: { claim: async () => undefined }, skipWaiting: () => undefined, addEventListener: (t: string, h: Handler) => { (handlers[t] ??= []).push(h); } };
  const context = createContext({ self, caches, fetch, URL, Response, Request, Headers, console });
  new Script(readFileSync("public/sw.js", "utf8")).runInContext(context);
  const request = (path: string, init: { method?: string; mode?: string } = {}) => { const r = new Request(ORIGIN + path, { method: init.method ?? "GET" }); Object.defineProperty(r, "mode", { value: init.mode ?? "cors" }); return r; };
  /** Fires a fetch event; resolves to the response the worker chose, or null when it let the browser handle it. */
  const fire = async (path: string, init?: { method?: string; mode?: string }) => {
    let answer = null as Promise<Response> | null;
    for (const h of handlers.fetch) h({ request: request(path, init), respondWith: (p: Promise<Response>) => { answer = p; } });
    return answer ? await (answer as Promise<Response>) : null;
  };
  const lifecycle = async (type: string, data?: unknown) => { const waits: Promise<unknown>[] = []; for (const h of handlers[type] ?? []) h({ data, ports: [], waitUntil: (p: Promise<unknown>) => waits.push(p) }); await Promise.all(waits); };
  return { fire, lifecycle, store, calls, pages, setOnline: (v: boolean) => { online = v; }, setRedirect: (v: boolean) => { redirect = v; } };
}
const cached = (sw: ReturnType<typeof load>) => [...(sw.store.get("rebatehq-shell-v1")?.keys() ?? [])].map(k => new URL(k).pathname).sort();

test("8C-2 service worker: caches only the app shell and serves it offline", async () => {
  const sw = load();
  await sw.lifecycle("activate");
  assert.equal((await sw.fire("/home", { mode: "navigate" }))!.status, 200);
  for (const p of ["/_next/static/chunks/app.js", "/spike/vault-worker.js", "/spike/duckdb-eh.wasm", "/manifest.webmanifest", "/icon.svg"]) assert.ok(await sw.fire(p), p);
  assert.deepEqual(cached(sw), ["/_next/static/chunks/app.js", "/home", "/icon.svg", "/manifest.webmanifest", "/spike/duckdb-eh.wasm", "/spike/vault-worker.js"]);
  // Offline: the shell and the engine come from the cache.
  sw.setOnline(false);
  assert.equal(await (await sw.fire("/home", { mode: "navigate" }))!.text(), "body of /home");
  assert.equal(await (await sw.fire("/spike/duckdb-eh.wasm"))!.text(), "body of /spike/duckdb-eh.wasm");
  await assert.rejects(sw.fire("/spike/never-loaded.js"), TypeError, "an asset never fetched online is not invented");
  // Static files are cache-first: online again, a cached file is not fetched twice.
  sw.setOnline(true); const before = sw.calls.length; await sw.fire("/_next/static/chunks/app.js"); assert.equal(sw.calls.length, before);
  // Fixed-name engine files and the page are network-first: an updated engine is used as soon as the network answers.
  await sw.fire("/spike/vault-worker.js"); await sw.fire("/home", { mode: "navigate" }); assert.deepEqual(sw.calls.slice(before), ["/spike/vault-worker.js", "/home"]);
});

test("8C-2 service worker: never intercepts or stores the API, writes, queries, other pages or other origins", async () => {
  const sw = load();
  for (const [path, init] of [["/api/licence?device=d", {}], ["/api/relay/sync", { method: "POST" }], ["/api/licence", { mode: "navigate" }], ["/home?x=1", { mode: "navigate" }], ["/login", { mode: "navigate" }],
    ["/account", { mode: "navigate" }], ["/_next/static/chunks/app.js?v=2", {}], ["/_next/data/x.json", {}], ["/spike/vault-worker.js", { method: "POST" }]] as [string, { method?: string; mode?: string }][])
    assert.equal(await sw.fire(path, init), null, `${init.method ?? "GET"} ${path} must go straight to the network`);
  assert.deepEqual(cached(sw), [], "nothing outside the shell was stored");
  const src = readFileSync("public/sw.js", "utf8");
  assert.ok(!/periodicsync|addEventListener\("sync"|backgroundFetch|importScripts|indexedDB|postMessage\((?!"cleared")/.test(src), "no background sync, no other storage, no imported code");
});

test("8C-2 service worker: a redirect (signed out) is never cached and drops the stored shell; the page can clear it", async () => {
  const sw = load();
  await sw.fire("/home", { mode: "navigate" }); assert.deepEqual(cached(sw), ["/home"]);
  sw.setRedirect(true); await sw.fire("/home", { mode: "navigate" }); assert.deepEqual(cached(sw), [], "signing out removes the offline shell");
  sw.setRedirect(false); await sw.fire("/home", { mode: "navigate" }); await sw.fire("/spike/a.js");
  await sw.lifecycle("message", { type: "rebatehq-offline-clear" }); assert.equal(sw.store.has("rebatehq-shell-v1"), false);
  sw.store.set("rebatehq-shell-v0", new Map()); await sw.lifecycle("activate"); assert.equal(sw.store.has("rebatehq-shell-v0"), false, "old versions are removed on activation");
});

test("roadmap 14.4 service worker: a new release prunes build files used by neither it nor the previous release", async () => {
  const sw = load(), page = (...files: string[]) => `<html>${files.map(f => `<script src="/_next/static/chunks/${f}"></script>`).join("")}</html>`;
  const release = async (html: string, files: string[]) => { sw.pages.set("/home", html); await sw.fire("/home", { mode: "navigate" }); for (const f of files) await sw.fire("/_next/static/chunks/" + f); };
  // A file stored by a version without build tags is removed at the first release change.
  sw.store.set("rebatehq-shell-v1", new Map([[ORIGIN + "/_next/static/chunks/untagged.js", new Response("old")]]));
  await release(page("a.js", "shared.js"), ["a.js", "shared.js", "lazy-a.js"]);
  assert.ok(cached(sw).includes("/_next/static/chunks/untagged.js"), "nothing is pruned before a release change");
  await release(page("b.js", "shared.js"), ["b.js", "shared.js"]);
  assert.deepEqual(cached(sw), ["/_next/static/chunks/a.js", "/_next/static/chunks/b.js", "/_next/static/chunks/lazy-a.js", "/_next/static/chunks/shared.js", "/home"], "the previous release's files are kept for a tab still running it");
  await release(page("c.js", "shared.js"), ["c.js", "shared.js"]);
  assert.deepEqual(cached(sw), ["/_next/static/chunks/b.js", "/_next/static/chunks/c.js", "/_next/static/chunks/shared.js", "/home"], "files last used two releases ago are gone; shared files stay");
  // Revisiting the same release prunes nothing, and the kept files still open offline.
  await release(page("c.js", "shared.js"), []); assert.ok(cached(sw).includes("/_next/static/chunks/b.js"));
  sw.setOnline(false); assert.equal(await (await sw.fire("/_next/static/chunks/shared.js"))!.text(), "body of /_next/static/chunks/shared.js");
  assert.equal(await (await sw.fire("/home", { mode: "navigate" }))!.text(), page("c.js", "shared.js"));
});
