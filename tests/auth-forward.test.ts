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
  // A plain GET (a click, or a mail scanner prefetch) never verifies a token-hash link: it shows /auth/confirm,
  // and only that page's same-origin POST calls verifyOtp.
  const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
  assert.ok(!get.includes("verifyOtp") && get.includes('"/auth/confirm"'));
  assert.match(src.slice(src.indexOf("export async function POST")), /verifyOtp\(\{token_hash:tokenHash,type:type as EmailOtpType\}\)/);
  assert.match(readFileSync("app/auth/confirm/page.tsx", "utf8"), /method="post" action="\/auth\/callback"/);
  assert.match(src, /exchangeCodeForSession\(code\)/);
  for (const reason of ["link", "expired", "browser", "invite"]) assert.ok(src.includes(`"${reason}"`), reason);
  const login = readFileSync("app/api/auth/login/route.ts", "utf8");
  assert.match(login, /api\.login\.emailLimit/);
});
