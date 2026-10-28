import { databaseContext, getAppContext } from "@/lib/context";
import { NextResponse } from "next/server";
import { assertPermission, errorResponse, HttpError } from "@/lib/authz";
import { withDatabase } from "@/lib/db";
import { calculateServerQuote, assertQuotedPricesCurrent } from "@/lib/margin";
import { appendAudit } from "@/lib/audit";
import { assertRepResponseSafe } from "@/lib/rep-response";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const context = await getAppContext(request.headers);
    assertPermission(context, "quotes.send");
    const { quoteId } = await params;
    const result = await withDatabase(databaseContext(context, request.headers), async db => {
      const q = await db.query<{ id: string; customer_id: string; status: string; currency: string; created_at: string }>(
        "SELECT id,customer_id,status,currency,created_at::date::text AS created_at FROM quote WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [context.tenantId, quoteId],
      );
      const quote = q.rows[0];
      if (!quote) throw new HttpError(404, "Quote not found.");
      if (!["approved", "sent"].includes(quote.status)) throw new HttpError(409, "Only an approved quote can be sent.");
      const lines = (await db.query(
        `SELECT product_id AS "productId",quantity AS qty,uom_code AS uom,list_price AS "quotedUnitPrice",
                discount_pct AS "discountPct",off_invoice_rebate_pct AS "rebatePct",accessory_amount AS accessory
         FROM quote_line WHERE tenant_id=$1 AND quote_id=$2`,
        [context.tenantId, quoteId],
      )).rows;
      const calc = await calculateServerQuote(db, context.tenantId, quote.customer_id, lines, String(quote.created_at).slice(0, 10), quote.currency);
      assertQuotedPricesCurrent(lines,calc.math);
      if (calc.zone === "red") throw new HttpError(422, "This quote is now below the walk-away margin and cannot be sent.");
      await db.query(
        "UPDATE quote SET status='sent',pocket_price=$3,cogs_total=$4,pocket_margin=$5,margin_pct=$6,margin_zone=$7,headroom=$8,policy_version=$9,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [context.tenantId, quoteId, calc.math.pocket, calc.math.cogs, calc.math.margin, calc.math.rate, calc.zone, calc.headroom, calc.policyVersion],
      );
      await appendAudit(db, { tenantId: context.tenantId, actorId: context.actorId, action: "quote.send", entityType: "quote", entityId: quoteId, after: { zone: calc.zone, policyVersion: calc.policyVersion } });
      return { zone: calc.zone, headroom: calc.headroom, math: calc.math };
    });
    const response = context.role === "rep"
      ? { id: quoteId, status: "sent", zone: result.zone, headroom: result.headroom }
      : { id: quoteId, status: "sent", zone: result.zone, headroom: result.headroom, pocketPrice: result.math.pocket, margin: result.math.margin, marginRate: result.math.rate };
    return NextResponse.json({ data: assertRepResponseSafe(context.role, response) });
  } catch (error) {
    return errorResponse(error);
  }
}
