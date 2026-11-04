import { legacyBusinessEnabled, retiredBusinessResponse } from "@/lib/legacy-gate";
import { databaseContext, getAppContext } from "@/lib/context";
import { NextResponse } from "next/server";
import { withDatabase } from "@/lib/db";
import { assertPermission, errorResponse } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { assertRepResponseSafe } from "@/lib/rep-response";
import { currentImportPrices,currentStandardCosts } from "@/lib/catalog-values";

export const runtime = "nodejs";

export async function GET(request: Request) {if (!legacyBusinessEnabled()) return retiredBusinessResponse();
  try {
    const context = await getAppContext(request.headers);
    assertPermission(context, "products.read");
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) || "";
    const rows = await withDatabase(databaseContext(context, request.headers), async db => {
      const cols = can(context.role, "costs.read")
        ? "id,sku,name,category,supplier,uom,unit_cost,freight_cost,payment_terms_cost,list_price,tier_prices"
        : "id,sku,name,category,supplier,uom,list_price,tier_prices";
      const products = (await db.query(
        `SELECT ${cols} FROM product WHERE tenant_id=$1 AND active=true
         AND ($2='' OR sku ILIKE $3 OR name ILIKE $3 OR category ILIKE $3) ORDER BY sku LIMIT 500`,
        [context.tenantId, query, `%${query}%`],
      )).rows;
      const prices=await currentImportPrices(db,context.tenantId,products.map((p:any)=>p.id));
      const costs=can(context.role,"costs.read")?await currentStandardCosts(db,context.tenantId,products.map((p:any)=>p.id)):new Map();
      for(const p of products){p.list_price=prices.get(p.id)??p.list_price;if(can(context.role,"costs.read"))p.unit_cost=costs.get(p.id)??null;}
      const conversions = products.length ? (await db.query<{ product_id: string | null; code: string }>(
        `SELECT c.product_id,u.code FROM uom_conversion c
         JOIN uom u ON u.tenant_id=c.tenant_id AND u.id IN (c.from_uom_id,c.to_uom_id)
         WHERE c.tenant_id=$1 AND (c.product_id IS NULL OR c.product_id=ANY($2::uuid[]))
         ORDER BY c.product_id,u.code`,
        [context.tenantId, products.map((product: any) => product.id)],
      )).rows : [];
      const unitsByProduct = new Map<string, Set<string>>();
      const tenantUnits = new Set<string>();
      for (const conversion of conversions) {
        const target = conversion.product_id ? (unitsByProduct.get(conversion.product_id) || new Set<string>()) : tenantUnits;
        target.add(conversion.code);
        if (conversion.product_id) unitsByProduct.set(conversion.product_id, target);
      }
      return products.map((product: any) => ({
        ...product,
        uom_options: [...new Set([product.uom, ...(unitsByProduct.get(product.id) || []), ...tenantUnits].filter(Boolean))].sort(),
      }));
    });
    return NextResponse.json({ data: assertRepResponseSafe(context.role, rows), role: context.role });
  } catch (error) {
    return errorResponse(error);
  }
}
