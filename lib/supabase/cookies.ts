import type { CookieOptions } from "@supabase/ssr";

/**
 * Review R2 (SECURITY_REVIEW.md R24, 27 Nov 2026): one set of options for the Supabase session cookies, used by every
 * server client (proxy.ts and lib/supabase/server.ts), so a refresh and a sign-out write and clear the same cookie.
 * - HttpOnly: no page script reads them. The app has no browser Supabase client; the vault worker gets the access
 *   token from /api/relay?mode=token.
 * - Secure in production; local development runs over http.
 * - 30 days instead of the library's 400, so a forgotten device signs out within a month. A shorter life would mean
 *   more sign-in emails, and Supabase's built-in mailer sends only a few an hour.
 */
export const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export function authCookieOptions(): CookieOptions {
  return { path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" };
}

/** The options to write one auth cookie with: the library's, then ours. A removal (maxAge 0) stays a removal. */
export function authCookie(options?: CookieOptions): CookieOptions {
  return { ...options, ...authCookieOptions(), maxAge: options?.maxAge === 0 ? 0 : AUTH_COOKIE_MAX_AGE };
}
