import { databaseContext } from "@/lib/context";
import { NextResponse } from "next/server";
import { getAppContext } from "@/lib/context";
import { withDatabase } from "@/lib/db";
import { assertPermission,errorResponse } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { assertRepResponseSafe } from "@/lib/rep-response";
export const runtime="nodejs";
export async function GET(request:Request){try{const context=await getAppContext(request.headers);assertPermission(context,"products.read");const q=new URL(request.url).searchParams.get("q")?.trim().slice(0,100)||"";const rows=await withDatabase(databaseContext(context,request.headers),async db=>{const cols=can(context.role,"costs.read")?"id,sku,name,category,supplier,uom,unit_cost,freight_cost,payment_terms_cost,list_price,tier_prices":"id,sku,name,category,supplier,uom,list_price,tier_prices";const result=await db.query(`SELECT ${cols} FROM product WHERE tenant_id=$1 AND active=true AND ($2='' OR sku ILIKE $3 OR name ILIKE $3 OR category ILIKE $3) ORDER BY sku LIMIT 500`,[context.tenantId,q,`%${q}%`]);return result.rows});return NextResponse.json({data:assertRepResponseSafe(context.role,rows),role:context.role})}catch(e){return errorResponse(e)}}
