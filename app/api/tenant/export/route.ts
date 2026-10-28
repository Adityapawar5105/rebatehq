import { databaseContext } from "@/lib/context";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { getAppContext } from "@/lib/context";
import { appendAudit } from "@/lib/audit";
import { assertPermission, errorResponse, HttpError } from "@/lib/authz";
import { withDatabase } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { csvDocument } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const tables = ["tenant","membership","invite","customer","product","price_list","price_list_version","price_list_item","margin_policy","quote","quote_line","approval","sales_order","rebate_agreement","rebate_progress","invoice","invoice_line","cost_component","supplier_credit","alert","margin_snapshot","connector_secret","import_job","audit_log","uom","cost_history","uom_conversion","fx_rate","data_quality_issue","customer_group","customer_price","rebate_tier","rebate_entry"] as const;

export async function GET(request: Request) {
  try {
    const context = await getAppContext(request.headers); assertPermission(context, "tenant.export");
    const rate = await rateLimit(request, "tenant-export", 3, 60 * 60_000); if (!rate.ok) throw new HttpError(429, "Too many workspace exports. Try again later.");
    const archive = new JSZip();
    await withDatabase(databaseContext(context,request.headers), async db => {
      await appendAudit(db, { tenantId: context.tenantId, actorId: context.actorId, action: "tenant.export", entityType: "tenant", entityId: context.tenantId, after: { format: "json+csv-zip" } });
      const json: Record<string, unknown[]> = {};
      for (const table of tables) {
        const result = await db.query(`SELECT * FROM public.${table} WHERE tenant_id=$1 ORDER BY 1`, [context.tenantId]);
        const rows = table === "connector_secret" ? result.rows.map(({ ciphertext: _c, nonce: _n, auth_tag: _a, ...metadata }) => metadata) : result.rows;
        json[table] = rows;
        const headers = (result.fields || []).map(field => field.name).filter(name => table !== "connector_secret" || !["ciphertext","nonce","auth_tag"].includes(name));
        const csv = csvDocument(headers, rows.map(row => headers.map(header => {
          const value = (row as Record<string, unknown>)[header];
          return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
        })));
        archive.file(`csv/${table}.csv`, csv);
      }
      archive.file("workspace.json", JSON.stringify({ exportedAt: new Date().toISOString(), workspace: { id: context.tenantId, name: context.tenantName }, data: json }, null, 2));
      archive.file("README.txt", "MarginDesk workspace export. Connector credential ciphertext, nonces, and authentication tags are deliberately excluded; reconnect providers after restore. CSV cells are escaped against spreadsheet formula execution.");
    });
    const bytes = await archive.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    return new Response(Buffer.from(bytes) as unknown as BodyInit, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="margindesk-${context.tenantId}-export.zip"`, "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
