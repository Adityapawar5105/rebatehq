// Review R2 (SECURITY_REVIEW.md R24): the Supabase session cookies are HttpOnly, Secure in production and live 30 days,
// and every server client uses the same options.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authCookie, authCookieOptions, AUTH_COOKIE_MAX_AGE } from "../lib/supabase/cookies";

test("R24: session cookies are HttpOnly, Lax, site-wide and 30 days; a removal stays a removal", () => {
  const set = authCookie({ path: "/", sameSite: "lax", httpOnly: false, maxAge: 400 * 24 * 60 * 60 });
  assert.equal(set.httpOnly, true);
  assert.equal(set.sameSite, "lax");
  assert.equal(set.path, "/");
  assert.equal(set.maxAge, AUTH_COOKIE_MAX_AGE);
  assert.equal(AUTH_COOKIE_MAX_AGE, 30 * 24 * 60 * 60);
  assert.equal(authCookie({ maxAge: 0 }).maxAge, 0, "sign-out must still clear the cookie");
  assert.equal(authCookie(undefined).maxAge, AUTH_COOKIE_MAX_AGE);
});

test("R24: Secure follows production", () => {
  const env = process.env as Record<string, string | undefined>, before = env.NODE_ENV;
  try {
    env.NODE_ENV = "production"; assert.equal(authCookieOptions().secure, true);
    env.NODE_ENV = "development"; assert.equal(authCookieOptions().secure, false);
  } finally { env.NODE_ENV = before; }
});

test("R24: every Supabase server client writes cookies through authCookie, and there is no browser client", () => {
  for (const file of ["proxy.ts", "lib/supabase/server.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /cookieOptions:\s*authCookieOptions\(\)/, file + " must pass the shared cookie options");
    assert.match(source, /authCookie\(options\)/, file + " must write cookies through authCookie");
  }
  for (const file of ["components/local/VaultApp.tsx", "app/layout.tsx"]) assert.doesNotMatch(readFileSync(file, "utf8"), /createBrowserClient/);
});
