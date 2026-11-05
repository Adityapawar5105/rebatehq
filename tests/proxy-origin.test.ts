// CSRF origin guard in proxy.ts (regression for the 7A relay gate failure in CI #80).
import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { originVerdict, proxy } from "../proxy";
const h = (init: Record<string, string>) => new Headers(init);
test("same-origin browser writes pass when the server is bound to 0.0.0.0", () => {
  assert.equal(originVerdict("http://localhost:3000", h({ host: "localhost:3000" }), "0.0.0.0:3000"), "same");
  assert.equal(originVerdict("https://app.example.test", h({ host: "internal:3000", "x-forwarded-host": "app.example.test" }), "0.0.0.0:3000"), "same");
  assert.equal(originVerdict("HTTP://LOCALHOST:3000", h({ host: "localhost:3000" }), "x"), "same");
});
test("cross-site, wrong-port and malformed origins are denied", () => {
  assert.equal(originVerdict("https://evil.example", h({ host: "localhost:3000" }), "localhost:3000"), "cross");
  assert.equal(originVerdict("http://localhost:3001", h({ host: "localhost:3000" }), "localhost:3000"), "cross");
  assert.equal(originVerdict("http://localhost:3000", h({ host: "app.example.test", "x-forwarded-host": "evil.example" }), "x"), "cross");
  assert.equal(originVerdict("not a url", h({ host: "localhost:3000" }), "localhost:3000"), "invalid");
  assert.equal(originVerdict("null", h({ host: "localhost:3000" }), "localhost:3000"), "invalid");
  assert.equal(originVerdict("file:///etc/passwd", h({ host: "localhost:3000" }), "localhost:3000"), "invalid");
});
test("proxy applies the guard: 0.0.0.0-bound same-origin POST passes, cross-site POST is refused", async () => {
  const same = await proxy(new NextRequest("http://0.0.0.0:3000/api/relay", { method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000" } }));
  assert.notEqual(same.status, 403);
  const cross = await proxy(new NextRequest("http://0.0.0.0:3000/api/relay", { method: "POST", headers: { origin: "https://evil.example", host: "localhost:3000" } }));
  assert.equal(cross.status, 403); assert.equal(await cross.text(), "Cross-origin request denied");
  const read = await proxy(new NextRequest("http://0.0.0.0:3000/api/relay", { method: "GET", headers: { origin: "https://evil.example", host: "localhost:3000" } }));
  assert.notEqual(read.status, 403, "reads are not origin-gated here, as before");
});
