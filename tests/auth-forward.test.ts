// Sign-in links that land on the Site URL or /login are finished by /auth/callback (14 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forwardAuthParams } from "../lib/auth-forward";

test("PKCE codes, token hashes and Supabase link errors are forwarded to the callback", () => {
  assert.equal(forwardAuthParams({ code: "abc" }), "/auth/callback?code=abc");
  assert.equal(forwardAuthParams({ token_hash: "h", type: "email", invite: "i" }), "/auth/callback?token_hash=h&type=email&invite=i");
  assert.equal(forwardAuthParams({ error: "access_denied", error_code: "otp_expired", error_description: "x" }), "/auth/callback?error=access_denied&error_code=otp_expired&error_description=x");
});
test("the login page's own reasons and unrelated parameters are not forwarded (no redirect loop)", () => {
  assert.equal(forwardAuthParams({ error: "expired" }), null);
  assert.equal(forwardAuthParams({ next: "/home", foo: ["a", "b"] }), null);
});
test("the callback verifies token-hash links on the server and explains every failure", () => {
  const src = readFileSync("app/auth/callback/route.ts", "utf8");
  assert.match(src, /verifyOtp\(\{token_hash:tokenHash,type\}\)/);
  assert.match(src, /exchangeCodeForSession\(code\)/);
  for (const reason of ["link", "expired", "browser", "invite"]) assert.ok(src.includes(`"${reason}"`), reason);
  const login = readFileSync("app/api/auth/login/route.ts", "utf8");
  assert.match(login, /api\.login\.emailLimit/);
});
