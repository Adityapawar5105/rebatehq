import { databaseContext } from "@/lib/context";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppContext } from "@/lib/context";
import { assertPermission, errorResponse, HttpError } from "@/lib/authz";
import { withDatabase } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { PrototypeSchema } from "@/lib/validators";
import { validatePrototype, importPrototypeData } from "@/lib/prototype-import";
import { readTextLimited } from "@/lib/request";
import { scanUpload } from "@/lib/file-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Body = z.object({ prototype: z.unknown(), commit: z.boolean().default(false), dryRunId: z.string().uuid().optional() });
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const context = await getAppContext(request.headers);
    assertPermission(context, "prototype.import");
    const limit = await rateLimit(request, "prototype-import", 5, 60 * 60_000);
    if (!limit.ok) throw new HttpError(429, "Too many import attempts. Try again in an hour.");
    let raw: string;
    try { raw = await readTextLimited(request, MAX_BYTES); } catch (error) { if (error instanceof HttpError && error.status === 413) throw new HttpError(413, "This export is larger than 2 MB. Split it into smaller exports before importing."); throw error; }
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new HttpError(415, "Upload a JSON export from the MarginDesk prototype.");
    await scanUpload(new TextEncoder().encode(raw));
    let decoded: unknown;
    try { decoded = JSON.parse(raw); } catch { throw new HttpError(400, "The selected file is not valid JSON."); }
    const body = Body.safeParse(decoded);
    if (!body.success) throw new HttpError(400, "The import request is missing its prototype data.");
    const root = (body.data.prototype as { model?: unknown } | null)?.model ?? body.data.prototype;
    const schema = PrototypeSchema.safeParse(root);
    if (!schema.success) throw new HttpError(422, "This file is not a supported MarginDesk prototype export or exceeds a row limit.");
    const plan = validatePrototype(schema.data);
    const sourceHash = createHash("sha256").update(JSON.stringify(schema.data)).digest("hex");
    const preview = {
      customers: plan.customers.length, products: plan.products.length, orders: plan.orders.length,
      quotes: plan.quotes.length, rebateAgreements: plan.rebates.length, invoices: plan.invoices.length,
      supplierCredits: plan.credits.length, alerts: plan.alerts.length, recomputedSnapshots: plan.snapshots.length,
      marginPolicies: plan.marginPolicies.length, skippedRedQuotes: plan.skippedRedQuotes.length, warnings: plan.warnings
    };

    if (!body.data.commit) {
      const dryRunId = await withDatabase(databaseContext(context,request.headers), async db => {
        const result = await db.query<{ id: string }>(`INSERT INTO import_job(tenant_id,import_type,status,source_name,source_hash,summary,created_by)
          VALUES($1,'prototype','dry_run','prototype-export.json',$2,$3::jsonb,$4) RETURNING id`,
          [context.tenantId, sourceHash, JSON.stringify(preview), context.userId]);
        return result.rows[0].id;
      });
      return NextResponse.json({ preview, dryRunId }, { status: 200, headers: { "cache-control": "no-store" } });
    }

    if (!body.data.dryRunId) throw new HttpError(400, "Run a fresh dry run before confirming the import.");
    const result = await withDatabase(databaseContext(context,request.headers), async db => {
      const job = await db.query<{ source_hash: string; created_at: string; status: string; created_by: string }>(
        "SELECT source_hash,created_at,status,created_by FROM import_job WHERE tenant_id=$1 AND id=$2 AND import_type='prototype' FOR UPDATE",
        [context.tenantId, body.data.dryRunId]);
      const row = job.rows[0];
      if (!row || row.created_by !== context.userId || row.status !== "dry_run") throw new HttpError(409, "That dry run is unavailable or was already used. Run it again.");
      if (row.source_hash !== sourceHash) throw new HttpError(409, "The file changed after its dry run. Run the dry run again.");
      if (Date.now() - new Date(row.created_at).getTime() > 30 * 60_000) throw new HttpError(410, "The dry run expired. Run it again before importing.");
      return importPrototypeData(db, context.tenantId, context.userId, plan, body.data.dryRunId!);
    });
    return NextResponse.json({ imported: result }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
