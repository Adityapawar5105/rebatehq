import { NextResponse } from "next/server";
/**
 * A 303 redirect to a path on the address the browser is already on. Behind Netlify, `request.url` carries the
 * deploy's own host (for example `main--rebatehq.netlify.app`), not the address the user opened, and auth cookies are
 * kept per host. An absolute redirect built from it would land the user on a host without their session, so redirects
 * use a relative Location, which the browser resolves against the address it is on.
 */
export function seeOther(path: string): NextResponse {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("seeOther takes a same-site path.");
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
