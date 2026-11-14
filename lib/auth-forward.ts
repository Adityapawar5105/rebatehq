// Supabase sends a sign-in link to the Site URL when the callback address is not on its allow list, and an expired
// or reused link comes back with error parameters. Any page that can receive those forwards them to /auth/callback.
const KEEP = ["code", "token_hash", "type", "error", "error_code", "error_description", "invite"];
export function forwardAuthParams(params: Record<string, string | string[] | undefined>): string | null {
  const q = new URLSearchParams();
  for (const k of KEEP) { const v = params[k]; if (typeof v === "string" && v) q.set(k, v); }
  return q.has("code") || q.has("token_hash") || q.has("error_code") ? "/auth/callback?" + q.toString() : null;
}
