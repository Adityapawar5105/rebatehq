import { databaseContext } from "@/lib/context";
import { NextResponse } from "next/server";
import { getAppContext } from "@/lib/context";
import { assertPermission,errorResponse } from "@/lib/authz";
import { withDatabase } from "@/lib/db";
export const runtime="nodejs";
export async function GET(request:Request){try{const context=await getAppContext(request.headers);assertPermission(context,"users.read");const data=await withDatabase(databaseContext(context,request.headers),async db=>(await db.query("SELECT user_id,email,role,status,created_at FROM membership WHERE tenant_id=$1 ORDER BY created_at",[context.tenantId])).rows);return NextResponse.json({data})}catch(e){return errorResponse(e)}}
