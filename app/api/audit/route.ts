import { databaseContext } from "@/lib/context";
import { NextResponse } from "next/server";
import { getAppContext } from "@/lib/context";
import { assertPermission,errorResponse,HttpError } from "@/lib/authz";
import { withDatabase } from "@/lib/db";
import { csvDocument } from "@/lib/csv";
import { appendAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";
export const runtime="nodejs";
const DateValue=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export async function GET(request:Request){try{const context=await getAppContext(request.headers);assertPermission(context,"audit.read");const params=new URL(request.url).searchParams;const actor=params.get("actor")||"",action=(params.get("action")||"").trim().slice(0,100),from=params.get("from")||"",to=params.get("to")||"",format=params.get("format")||"",requestedLimit=Number(params.get("limit")||100);const limit=Number.isFinite(requestedLimit)?Math.min(5000,Math.max(1,Math.floor(requestedLimit))):100;if(actor&&!z.string().uuid().safeParse(actor).success)throw new HttpError(400,"Choose a valid actor filter.");if(from&&!DateValue.safeParse(from).success||to&&!DateValue.safeParse(to).success)throw new HttpError(400,"Use YYYY-MM-DD for date filters.");if(format==="csv"){const rate=await rateLimit(request,"audit-export",20,60*60_000);if(!rate.ok)throw new HttpError(429,"Too many audit exports. Try again later.");}
 const rows=await withDatabase(databaseContext(context,request.headers),async db=>{if(format==="csv")await appendAudit(db,{tenantId:context.tenantId,actorId:context.actorId,action:"tenant.export.audit_csv",entityType:"audit_log",after:{actor,action,from,to}});return(await db.query(`SELECT id,actor_id,action,entity_type,entity_id,before,after,ip::text,user_agent,created_at FROM audit_log WHERE tenant_id=$1 AND ($2::uuid IS NULL OR actor_id=$2::uuid) AND ($3='' OR action ILIKE '%'||$3||'%') AND ($4::date IS NULL OR created_at >= $4::date) AND ($5::date IS NULL OR created_at < ($5::date + interval '1 day')) ORDER BY created_at DESC LIMIT $6`,[context.tenantId,actor||null,action,from||null,to||null,limit])).rows});
 if(format==="csv"){const headers=["id","actor_id","action","entity_type","entity_id","before_json","after_json","ip","user_agent","created_at"],body=csvDocument(headers,rows.map(row=>[row.id,row.actor_id,row.action,row.entity_type,row.entity_id,JSON.stringify(row.before||{}),JSON.stringify(row.after||{}),row.ip,row.user_agent,row.created_at]));return new Response(body,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":"attachment; filename=margin-desk-audit.csv","cache-control":"no-store"}})}
 return NextResponse.json({data:rows})}catch(e){return errorResponse(e)}}
