import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withDatabase } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { errorResponse, HttpError } from "@/lib/authz";
import { devImpersonationEnabled, verifyImpersonation } from "@/lib/impersonation";
import { msg } from "../../../../../lib/i18n/core";
export const runtime="nodejs";
export async function POST(request:Request){try{if(!devImpersonationEnabled())throw new HttpError(404,msg("api.dev.stop.developmentImpersonationIsDisabled"));const supabase=await createSupabaseServerClient();const {data:{user}}=await supabase.auth.getUser();const cookieStore=await cookies();const payload=user?verifyImpersonation(cookieStore.get("md-dev-impersonation")?.value,user.id):null;if(payload)await withDatabase({userId:payload.targetUserId,realActorId:payload.realActorId,headers:request.headers},async db=>{await appendAudit(db,{tenantId:payload.tenantId,actorId:payload.realActorId,action:"dev.impersonation.ended",entityType:"membership",entityId:payload.targetUserId,after:{targetUserId:payload.targetUserId}})});cookieStore.delete("md-dev-impersonation");cookieStore.delete("md-tenant");return NextResponse.redirect(new URL("/dashboard",request.url),303)}catch(error){return errorResponse(error)}}
