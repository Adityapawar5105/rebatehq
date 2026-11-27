import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authCookie, authCookieOptions } from "./cookies";

export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase Auth is not configured. Set the public project URL and publishable key.");
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, authCookie(options)));
        } catch {
          // Server Components are read-only; proxy.ts refreshes and writes auth cookies.
        }
      }
    }
  });
}
