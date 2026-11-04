import { legacyBusinessEnabled, retiredBusinessResponse } from "@/lib/legacy-gate";
import { databaseContext } from "@/lib/context";
import { NextResponse } from "next/server";
import { getAppContext } from "@/lib/context";
import { errorResponse, HttpError } from "@/lib/authz";
import { withDatabase } from "@/lib/db";
import { assertRepResponseSafe } from "@/lib/rep-response";
export const runtime = "nodejs";
export async function GET(request: Request) {if (!legacyBusinessEnabled()) return retiredBusinessResponse();
  try {
    const context = await getAppContext(request.headers); if (!context) throw new HttpError(401, "Please sign in to search.");
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) || "";
    if (query.length < 2) return NextResponse.json({ data: [] });
    const data = await withDatabase(databaseContext(context,request.headers), async db => {
      const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      const products = (await db.query("SELECT id,sku AS label,'Product' AS kind,'/prices' AS href FROM product WHERE tenant_id=$1 AND active=true AND (sku ILIKE $2 OR name ILIKE $2) ORDER BY sku LIMIT 5", [context.tenantId, like])).rows;
      const customers = (await db.query("SELECT id,name||' · '||account_no AS label,'Customer' AS kind,'/dashboard' AS href FROM customer WHERE tenant_id=$1 AND (name ILIKE $2 OR account_no ILIKE $2) ORDER BY name LIMIT 5", [context.tenantId, like])).rows;
      const quotes = (await db.query("SELECT id,'Quote '||left(id::text,8)||' · '||status AS label,'Quote' AS kind,'/quoting' AS href FROM quote WHERE tenant_id=$1 AND id::text ILIKE $2 ORDER BY created_at DESC LIMIT 5", [context.tenantId, like])).rows;
      return [...customers, ...products, ...quotes];
    });
    return NextResponse.json({ data: assertRepResponseSafe(context.role,data) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
