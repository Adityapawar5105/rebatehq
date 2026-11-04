import { can, type Permission } from "@/lib/permissions";
import type { AppContext } from "@/lib/context";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function assertPermission(context: AppContext | null, permission: Permission): asserts context is AppContext {
  if (!context) throw new HttpError(401, "Please sign in to continue.");
  if (!can(context.role, permission)) throw new HttpError(403, "You don't have permission to do that. Ask an owner or manager.");
}
export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as {code?:unknown}).code || "") : "";
  const message = error instanceof Error ? error.message : "";
  if (code === "23514" && /licence|seat limit|Location\/ERP/i.test(message)) return Response.json({error:"Licence limit reached. Ask your workspace owner to upgrade or renew the licence."},{status:409});
  if (code === "54000" && message === "failed-login database rate limit") return Response.json({error:"Too many sign-in attempts. Wait before trying again."},{status:429});
  console.error(JSON.stringify({ event: "request.error", name: error instanceof Error ? error.name : "Unknown", code: code.slice(0, 30) }));
  return Response.json({ error: "We couldn't complete that request. Please try again or contact support." }, { status: 500 });
}
