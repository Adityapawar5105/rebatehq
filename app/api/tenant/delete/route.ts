import { readJsonLimited } from "@/lib/request";
import { databaseContext } from "@/lib/context";
import { NextResponse } from "next/server";
import { getAppContext } from "@/lib/context";
import { assertPermission,errorResponse,HttpError } from "@/lib/authz";
import { withDatabase } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { msg } from "../../../../lib/i18n/core";
export const runtime="nodejs";
const Confirm=z.object({confirmation:z.string().max(120)});
export async function POST(request:Request){try{const context=await getAppContext(request.headers);assertPermission(context,"tenant.delete");const limit=await rateLimit(request,"tenant-delete",2,60*60_000);if(!limit.ok)throw new HttpError(429,msg("api.tenantDelete.tooManyWorkspaceDeletion"));const parsed=Confirm.safeParse(await readJsonLimited(request));if(!parsed.success||parsed.data.confirmation!==context.tenantName)throw new HttpError(400,msg("api.tenantDelete.typeTheWorkspaceName"));await withDatabase(databaseContext(context,request.headers),async db=>{await appendAudit(db,{tenantId:context.tenantId,actorId:context.actorId,action:"tenant.delete.requested",entityType:"tenant",entityId:context.tenantId,after:{retentionDays:30}});await db.query("UPDATE tenant SET deleted_at=now() WHERE tenant_id=$1 AND deleted_at IS NULL",[context.tenantId])});return NextResponse.json({ok:true})}catch(e){return errorResponse(e)}}
