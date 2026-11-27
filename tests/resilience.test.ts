// Licence and vault resilience (20 Nov 2026; audit B-2, B-6, B-8, B-10, B-11, X-4).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { failedReply, refreshLicence } from "../lib/licence-cache";
import { READ_ONLY_ACTIONS } from "../lib/vault/licence";
import { VaultService } from "../lib/vault/service";

test("B-2: only a refusal clears the saved licence; server errors, rate limits and timeouts count as offline", () => {
  for (const s of [400, 401, 402, 403, 404, 409]) assert.equal(failedReply(s), "refused", String(s));
  for (const s of [408, 429, 500, 502, 503, 504]) assert.equal(failedReply(s), "offline", String(s));
});

test("B-2: refreshLicence keeps the saved envelope through a server hiccup and drops it on a refusal or a bad signature", async (t) => {
  const store = new Map<string, string>(), key = "rebatehq-licence-v1:t:u:d", saved = { assertion: "saved" };
  const g = globalThis as unknown as Record<string, unknown>;
  const before = { localStorage: g.localStorage, fetch: g.fetch };
  t.after(() => { g.localStorage = before.localStorage; g.fetch = before.fetch; });
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const reply = (r: () => Promise<Response>) => { g.fetch = async () => r(); };
  const scope = { tenantId: "t", userId: "u" };
  const reset = () => store.set(key, JSON.stringify(saved));
  for (const status of [500, 502, 503, 429]) {
    reset(); reply(async () => new Response("busy", { status }));
    assert.deepEqual(await refreshLicence(scope, "d"), { envelope: saved, offline: true }, String(status));
    assert.ok(store.has(key), "a server error deleted the saved licence");
  }
  reset(); reply(async () => new Response("<html>gateway</html>", { status: 200 }));
  assert.deepEqual(await refreshLicence(scope, "d"), { envelope: saved, offline: true }, "a non-JSON reply is not a licence answer");
  reset(); reply(async () => { throw new TypeError("network"); });
  assert.deepEqual(await refreshLicence(scope, "d"), { envelope: saved, offline: true });
  for (const status of [401, 403]) {
    reset(); reply(async () => new Response("{}", { status }));
    assert.deepEqual(await refreshLicence(scope, "d"), { envelope: null, offline: false }, String(status));
    assert.ok(!store.has(key), "a refusal kept the saved licence");
  }
  reset(); reply(async () => Response.json({ assertion: "forged", signature: "x" }));
  assert.deepEqual(await refreshLicence(scope, "d"), { envelope: null, offline: false }, "an invalid signature never gets the offline allowance");
  assert.ok(!store.has(key));
});

test("B-6: commands marked read-only do not write without a writable licence", () => {
  assert.ok(!READ_ONLY_ACTIONS.has("benchWithdrawn"), "benchWithdrawn records the withdrawal, so it is a write");
  const src = readFileSync("lib/vault/service.ts", "utf8");
  const body = (name: string) => src.slice(src.indexOf(name), src.indexOf("\n  async ", src.indexOf(name) + name.length));
  assert.match(body("async leaks()"), /if \(changed && this\.licence\.writable\)/);
  assert.match(body("async reconcile()"), /if \(this\.licence\.writable && await differencesChanged\(/);
  assert.match(body("private async seedRoles()"), /if \(!this\.licence\.writable\) return;/);
});

test("B-11: an engine that fails after a correct passphrase is not reported as a wrong passphrase", () => {
  const src = readFileSync("lib/vault/service.ts", "utf8"), unlock = src.slice(src.indexOf("async unlock("), src.indexOf("private requireEngine()"));
  assert.match(unlock, /try \{ this\.engine = await openMemory\(decoded\.bytes\); \}[^]*?catch \{ throw new VaultError\("ENGINE", msg\("vault\.engineFailed"\)\); \}/);
});

test("B-8: a warning a minute before the idle lock, and a short grace lock after a long job", async () => {
  const events: string[] = [];
  const s = new VaultService(() => events.push("lock"), 1_200, 10, false, () => events.push("warn"));
  (s as unknown as { engine: object }).engine = {};
  // With a 1.2 s idle time the warning lead is capped: no warning when the idle time is not longer than a minute.
  s.touch(); await new Promise(r => setTimeout(r, 1_400)); assert.deepEqual(events, ["lock"]);
  events.length = 0; s.graceLock(); assert.deepEqual(events, ["warn"]); await new Promise(r => setTimeout(r, 1_400)); assert.deepEqual(events, ["warn", "lock"]);
  events.length = 0; s.graceLock(); s.touch(); s.touch(); (s as unknown as { engine: null }).engine = null; s.touch();
  await new Promise(r => setTimeout(r, 1_400)); assert.deepEqual(events, ["warn"], "touching after the warning must cancel the grace lock");
});

test("B-8: the worker never cancels a running request for the idle lock; a touch during a long job keeps it unlocked", () => {
  const src = readFileSync("lib/vault/worker.ts", "utf8");
  assert.match(src, /if \(inFlight > 0\) \{ lockAfterWork = true; return; \}/);
  assert.match(src, /if \(request\.action === "touch"\) lockAfterWork = false;/);
  assert.match(src, /inFlight--;\n\s*if \(inFlight === 0 && lockAfterWork\) \{ lockAfterWork = false; service\.graceLock\(\); \}/);
});

test("B-10: the used invite cookie is deleted on the path it was set on", () => {
  const login = readFileSync("app/api/auth/login/route.ts", "utf8"), callback = readFileSync("app/auth/callback/route.ts", "utf8");
  assert.match(login, /cookies\.set\("md-invite",[^)]*path:"\/auth\/callback"/);
  assert.match(callback, /cookieStore\.delete\(\{name:"md-invite",path:"\/auth\/callback"\}\)/);
});

test("X-4: the page keeps the worker's error code and notices a dead worker", () => {
  const src = readFileSync("lib/vault/client.ts", "utf8");
  assert.match(src, /request\.reject\(new VaultClientError\(data\.error\.code, data\.error\.message\)\)/);
  assert.match(src, /this\.failed = true;/);
  assert.match(readFileSync("components/local/VaultApp.tsx", "utf8"), /data-testid="worker-failed"/);
});

test("B-9: the rate-limit and audit address is the platform's, never a caller-chosen first x-forwarded-for hop", async () => {
  const { clientIp } = await import("../lib/db");
  const h = (o: Record<string, string>) => new Headers(o);
  const netlify = {}, vercel = { VERCEL: "1" };
  assert.equal(clientIp(h({ "x-nf-client-connection-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 203.0.113.7" }), netlify), "203.0.113.7", "Netlify's own header wins on Netlify");
  // 27 Nov 2026: a header only trusted where its platform sets it.
  assert.equal(clientIp(h({ "x-nf-client-connection-ip": "6.6.6.6", "x-real-ip": "198.51.100.4" }), vercel), "198.51.100.4", "on Vercel a caller's Netlify header is ignored");
  assert.equal(clientIp(h({ "x-vercel-forwarded-for": "198.51.100.5" }), vercel), "198.51.100.5", "Vercel's own header on Vercel");
  assert.equal(clientIp(h({ "x-real-ip": "198.51.100.6" }), vercel), "198.51.100.6");
  assert.equal(clientIp(h({ "x-forwarded-for": "6.6.6.6" }), vercel), "", "on Vercel x-forwarded-for alone is not trusted");
  assert.equal(clientIp(h({ "x-forwarded-for": "1.2.3.4, 198.51.100.9" })), "198.51.100.9", "the last hop, added by the proxy, not the caller's first");
  assert.equal(clientIp(h({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "1.2.3.4" })), "198.51.100.1");
  assert.equal(clientIp(h({ "x-vercel-forwarded-for": "1.2.3.4" }), netlify), "", "the Vercel header is not trusted on Netlify");
  assert.equal(clientIp(h({ "x-nf-client-connection-ip": "not-an-ip", "x-forwarded-for": "2001:db8::1" }), netlify), "2001:db8::1");
  assert.equal(clientIp(undefined), "");
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync("lib/rate-limit.ts", "utf8"), /const ip=clientIp\(request\.headers\)\|\|"unknown";/, "the sign-in limiter keys on the same address");
});
