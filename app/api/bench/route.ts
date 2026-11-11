// Chunk 8D: opt-in anonymous benchmarks (BENCHMARKS_DESIGN.md). Every call is an explicit Owner action from the
// Benchmarks screen; nothing calls this route on its own. Off unless BENCHMARKS_ENABLED=true.
import { getAppContext, databaseContext } from "@/lib/context";
import { withDatabase } from "@/lib/db";
import { readJsonLimited } from "@/lib/request";
import { errorResponse, HttpError } from "@/lib/authz";
import { BenchError, consent, figures, setConsent, share, withdraw } from "@/lib/bench/store";
import { msg } from "../../../lib/i18n/core";
export const runtime = "nodejs";
const json = (body: unknown) => Response.json(body, { headers: { "Cache-Control": "no-store" } });
function failure(e: unknown) {
  const no = { "Cache-Control": "no-store" };
  if (e instanceof BenchError) return Response.json({ code: e.code, error: e.message }, { status: e.code === "ACCESS" ? 403 : e.code === "CONFIG" ? 503 : 400, headers: no });
  const code = (e as { code?: string })?.code;
  if (code === "42501") return Response.json({ code: "ACCESS", error: msg("bench.api.access") }, { status: 403, headers: no });
  if (code === "22023" || code === "23514") return Response.json({ code: "INVALID", error: msg("bench.api.refused") }, { status: 400, headers: no });
  return errorResponse(e);
}
async function context(request: Request) {
  if (process.env.BENCHMARKS_ENABLED !== "true") throw new HttpError(404, msg("bench.api.off"));
  const ctx = await getAppContext(request.headers); if (!ctx) throw new HttpError(401, msg("bench.api.signIn"));
  return ctx;
}
export async function GET(request: Request) { try {
  const ctx = await context(request), u = new URL(request.url), mode = u.searchParams.get("mode");
  if (![...u.searchParams.keys()].every(k => ["mode", "quarter"].includes(k)) || !["state", "figures"].includes(mode ?? "")) throw new HttpError(400, msg("bench.api.invalid"));
  return json(await withDatabase(databaseContext(ctx, request.headers), async db => mode === "state" ? { consent: await consent(db, ctx.tenantId) } : figures(db, ctx.tenantId, u.searchParams.get("quarter"))));
} catch (e) { return failure(e); } }
export async function POST(request: Request) { try {
  const ctx = await context(request), body = await readJsonLimited<Record<string, unknown>>(request, 16 * 1024);
  if (!body || typeof body !== "object") throw new HttpError(400, msg("bench.api.invalid"));
  return json(await withDatabase(databaseContext(ctx, request.headers), async db => {
    if (body.action === "consent" && typeof body.optedIn === "boolean" && Object.keys(body).length === 2) return { consent: await setConsent(db, ctx.tenantId, ctx.userId, body.optedIn) };
    if (body.action === "share" && Object.keys(body).length === 2) return share(db, ctx.tenantId, body.payload);
    if (body.action === "withdraw" && Object.keys(body).length === 1) return withdraw(db, ctx.tenantId, ctx.userId);
    throw new HttpError(400, msg("bench.api.invalid"));
  }));
} catch (e) { return failure(e); } }
