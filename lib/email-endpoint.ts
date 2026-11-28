/**
 * Review R3 (28 Nov 2026): where invitation emails are sent. Resend's API by default; `RESEND_API_URL` points it at
 * another Resend-compatible endpoint, which CI uses to catch the invitation it sends to a disposable local address.
 * Only https, or plain http to this machine, is accepted, so a mistyped setting cannot send invitation links in clear
 * text across the network.
 */
export function resendEmailsUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.RESEND_API_URL?.trim();
  if (!raw) return "https://api.resend.com/emails";
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("RESEND_API_URL is not a valid URL."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!(url.protocol === "https:" || (url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash)
    throw new Error("RESEND_API_URL must be https, or http to this machine, with no credentials or query.");
  return url.origin + url.pathname.replace(/\/+$/, "") + "/emails";
}
