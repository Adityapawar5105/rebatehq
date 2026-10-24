import { databaseContext } from "@/lib/context";
import { NextResponse } from "next/server";
import { getAppContext } from "@/lib/context";
import { withDatabase } from "@/lib/db";
import { assertPermission,errorResponse } from "@/lib/authz";
import { assertRepResponseSafe } from "@/lib/rep-response";
export const runtime="nodejs";
export async function GET(request:Request){try{const context=await getAppContext(request.headers);if(!context)return NextResponse.json({error:"Please sign in to continue."},{status:401});if(context.role==="rep")assertPermission(context,"customers.read.assigned");else assertPermission(context,"customers.read.all");const q=new URL(request.url).searchParams.get("q")?.trim().slice(0,100)||"";const data=await withDatabase(databaseContext(context,request.headers),async db=>(await db.query(`SELECT id,account_no,name,region,tier,assigned_rep_id FROM customer WHERE tenant_id=$1 AND ($2='' OR name ILIKE $3 OR account_no ILIKE $3) ORDER BY name LIMIT 500`,[context.tenantId,q,`%${q}%`])).rows);return NextResponse.json({data:assertRepResponseSafe(context.role,data)})}catch(e){return errorResponse(e)}}
