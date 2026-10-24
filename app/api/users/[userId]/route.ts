import { readJsonLimited } from "@/lib/request";
import { databaseContext } from "@/lib/context";
import { NextResponse } from "next/server";
import { getAppContext } from "@/lib/context";
import { assertPermission,errorResponse,HttpError } from "@/lib/authz";
import { withDatabase } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { z } from "zod";
export const runtime="nodejs";
const RoleChange=z.object({role:z.enum(["owner","manager","analyst","rep"])});
export async function PATCH(request:Request,{params}:{params:Promise<{userId:string}>}){try{const context=await getAppContext(request.headers);assertPermission(context,"users.role.change");const {userId}=await params;const parsed=RoleChange.safeParse(await readJsonLimited(request));if(!parsed.success)return NextResponse.json({error:"Choose a valid workspace role."},{status:400});if(userId===context.userId)throw new HttpError(409,"Ask another owner to change your own role.");const result=await withDatabase(databaseContext(context,request.headers),async db=>{const target=await db.query<{user_id:string;role:string;email:string}>("SELECT user_id,role,email FROM membership WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE",[context.tenantId,userId]);if(!target.rows[0])throw new HttpError(404,"Workspace member not found.");if(target.rows[0].role==="owner"&&parsed.data.role!=="owner"){const owners=await db.query("SELECT count(*)::int AS n FROM membership WHERE tenant_id=$1 AND role='owner' AND status='active'",[context.tenantId]);if(Number(owners.rows[0].n)<=1)throw new HttpError(409,"A workspace must keep at least one active owner.");}await db.query("UPDATE membership SET role=$3 WHERE tenant_id=$1 AND user_id=$2",[context.tenantId,userId,parsed.data.role]);await appendAudit(db,{tenantId:context.tenantId,actorId:context.actorId,action:"membership.role_changed",entityType:"membership",entityId:userId,before:{role:target.rows[0].role},after:{role:parsed.data.role,email:target.rows[0].email}});return{userId,email:target.rows[0].email,role:parsed.data.role}});return NextResponse.json({data:result})}catch(e){return errorResponse(e)}}
