// Sign-in links that land on the Site URL or /login are finished by /auth/callback (14 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forwardAuthParams } from "../lib/auth-forward";
import { seeOther } from "../lib/see-other";

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
  assert.ok(!get.includes("verifyOtp") && get.includes('"/auth/confirm?"'));
  assert.match(src.slice(src.indexOf("export async function POST")), /verifyOtp\(\{token_hash:tokenHash,type:type as EmailOtpType\}\)/);
  assert.match(readFileSync("app/auth/confirm/page.tsx", "utf8"), /method="post" action="\/auth\/callback"/);
  assert.match(src, /exchangeCodeForSession\(code\)/);
  for (const reason of ["link", "expired", "browser", "invite"]) assert.ok(src.includes(`"${reason}"`), reason);
  const login = readFileSync("app/api/auth/login/route.ts", "utf8");
  assert.match(login, /api\.login\.emailLimit/);
});
test("auth redirects stay on the address the browser opened (Netlify serves request.url on the deploy host)", () => {
  // On Netlify, request.url is https://main--rebatehq.netlify.app/... while the user is on rebatehq.netlify.app. Auth
  // cookies are per host, so an absolute redirect built from request.url signed the user in on one host and sent them
  // to the other, where they had no session and landed back on /login.
  const res = seeOther("/home");
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/home");
  assert.throws(() => seeOther("https://evil.example/"));
  assert.throws(() => seeOther("//evil.example/"));
  for (const file of ["app/auth/callback/route.ts", "app/api/auth/logout/route.ts", "app/api/dev/impersonate/stop/route.ts"]) {
    const src = readFileSync(file, "utf8");
    assert.ok(!/NextResponse\.redirect|\.origin\b|new URL\("[^"]*",\s*(request\.url|url)\)/.test(src), file);
    assert.match(src, /seeOther\(/, file);
  }
});
