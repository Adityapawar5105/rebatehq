import { can, type Permission } from "@/lib/permissions";
import type { AppContext } from "@/lib/context";
import { msg } from "./i18n/core";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function assertPermission(context: AppContext | null, permission: Permission): asserts context is AppContext {
  if (!context) throw new HttpError(401, msg("api.authz.pleaseSignInTo"));
  if (!can(context.role, permission)) throw new HttpError(403, msg("api.authz.youDonTHave"));
}
export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as {code?:unknown}).code || "") : "";
  const message = error instanceof Error ? error.message : "";
  if (code === "23514" && /licence|seat limit|Location\/ERP/i.test(message)) return Response.json({error:msg("api.authz.licenceLimitReachedAsk")},{status:409});
  if (code === "54000" && message === "failed-login database rate limit") return Response.json({error:msg("api.authz.tooManySignIn")},{status:429});
  console.error(JSON.stringify({ event: "request.error", name: error instanceof Error ? error.name : "Unknown", code: code.slice(0, 30) }));
  return Response.json({ error: msg("api.authz.weCouldnTComplete") }, { status: 500 });
}
