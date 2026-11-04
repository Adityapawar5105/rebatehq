import { legacyBusinessEnabled, retiredBusinessResponse } from "@/lib/legacy-gate";
import { readJsonLimited } from "@/lib/request";
import { databaseContext, getAppContext } from "@/lib/context";
import { NextResponse } from "next/server";
import { assertPermission, errorResponse, HttpError } from "@/lib/authz";
import { withDatabase } from "@/lib/db";
import { DecisionSchema } from "@/lib/validators";
import { calculateServerQuote, assertQuotedPricesCurrent } from "@/lib/margin";
import { appendAudit } from "@/lib/audit";
import { assertNotQuoteCreator } from "@/lib/quote-approval";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ quoteId: string }> }) {if (!legacyBusinessEnabled()) return retiredBusinessResponse();
  try {
    const context = await getAppContext(request.headers);
    assertPermission(context, "quotes.approve");
    const { quoteId } = await params;
    const parsed = DecisionSchema.safeParse(await readJsonLimited(request));
    if (!parsed.success) return NextResponse.json({ error: "Choose approve or deny and include a note of at most 2,000 characters." }, { status: 400 });

    const result = await withDatabase(databaseContext(context, request.headers), async db => {
      const q = await db.query<{ id: string; customer_id: string; created_by: string; status: string; currency: string; created_at: string }>(
        "SELECT id,customer_id,created_by,status,currency,created_at::date::text AS created_at FROM quote WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [context.tenantId, quoteId],
      );
      const quote = q.rows[0];
      if (!quote) throw new HttpError(404, "Quote not found.");
      assertNotQuoteCreator(context.userId, quote.created_by);
      if (quote.status !== "pending_approval") throw new HttpError(409, "This quote no longer needs a decision.");
      const approval = await db.query<{ id: string; requested_by: string }>(
        "SELECT id,requested_by FROM approval WHERE tenant_id=$1 AND quote_id=$2 AND status='pending' FOR UPDATE",
        [context.tenantId, quoteId],
      );
      if (!approval.rows[0]) throw new HttpError(409, "The pending approval was not found.");
      const lines = (await db.query(
        `SELECT product_id AS "productId",quantity AS qty,uom_code AS uom,list_price AS "quotedUnitPrice",
                discount_pct AS "discountPct",off_invoice_rebate_pct AS "rebatePct",accessory_amount AS accessory
         FROM quote_line WHERE tenant_id=$1 AND quote_id=$2`,
        [context.tenantId, quoteId],
      )).rows;
      const calc = await calculateServerQuote(db, context.tenantId, quote.customer_id, lines, String(quote.created_at).slice(0, 10), quote.currency);
      assertQuotedPricesCurrent(lines,calc.math);
      if (parsed.data.decision === "approved" && calc.zone === "red") throw new HttpError(422, "The quote is below the current walk-away margin and cannot be approved.");
      const approvalStatus = parsed.data.decision;
      const quoteStatus = approvalStatus === "approved" ? "approved" : "denied";
      await db.query(
        "UPDATE approval SET status=$3,decided_by=$4,decision_note=$5,margin_pct_at_decision=$6,policy_version=$7,decided_at=now() WHERE tenant_id=$1 AND id=$2",
        [context.tenantId, approval.rows[0].id, approvalStatus, context.userId, parsed.data.note || null, calc.math.rate, calc.policyVersion],
      );
      await db.query(
        "UPDATE quote SET status=$3,pocket_price=$4,cogs_total=$5,pocket_margin=$6,margin_pct=$7,margin_zone=$8,headroom=$9,policy_version=$10,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [context.tenantId, quoteId, quoteStatus, calc.math.pocket, calc.math.cogs, calc.math.margin, calc.math.rate, calc.zone, calc.headroom, calc.policyVersion],
      );
      await appendAudit(db, { tenantId: context.tenantId, actorId: context.actorId, action: `quote.${approvalStatus}`, entityType: "quote", entityId: quoteId, before: { status: quote.status }, after: { status: quoteStatus, marginRate: calc.math.rate, policyVersion: calc.policyVersion, note: parsed.data.note || "" } });
      return { status: quoteStatus, zone: calc.zone, headroom: calc.headroom, margin: calc.math.margin, marginRate: calc.math.rate, policyVersion: calc.policyVersion };
    });
    return NextResponse.json({ data: context.role === "rep" ? { status: result.status, zone: result.zone, headroom: result.headroom } : result });
  } catch (error) {
    return errorResponse(error);
  }
}
