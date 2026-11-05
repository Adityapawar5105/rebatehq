import { readJsonLimited } from "@/lib/request";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppContext } from "@/lib/context";
import { errorResponse, HttpError } from "@/lib/authz";
import { withDatabase } from "@/lib/db";
import { assertRepResponseSafe } from "@/lib/rep-response";
import { msg } from "../../../../lib/i18n/core";
const Body = z.object({ tenantId: z.string().uuid() });
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const context = await getAppContext(request.headers);
    if (!context) throw new HttpError(401, msg("api.tenantSwitch.pleaseSignInTo"));
    const body = Body.safeParse(await readJsonLimited(request)); if (!body.success) throw new HttpError(400, msg("api.tenantSwitch.chooseAValidWorkspace"));
    const allowed = context.memberships.some(item => item.tenant_id === body.data.tenantId);
    if (!allowed) throw new HttpError(403, msg("api.tenantSwitch.youDonTHave"));
    const cookieStore = await cookies();
    cookieStore.set("md-tenant", body.data.tenantId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return NextResponse.json(assertRepResponseSafe(context.role,{ ok: true }));
  } catch (error) { return errorResponse(error); }
}
