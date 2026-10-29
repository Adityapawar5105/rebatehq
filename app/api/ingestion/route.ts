import {z} from "zod";
import {assertPermission,errorResponse,HttpError} from "@/lib/authz";
import {getAppContext,databaseContext} from "@/lib/context";
import {withDatabase} from "@/lib/db";
import {readJsonLimited} from "@/lib/request";
import {rateLimit} from "@/lib/rate-limit";
import {ingestionState,saveSchedule,pauseSchedule,runSchedule,ScheduleInput} from "@/lib/ingestion";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
const Action=z.discriminatedUnion("action",[
 z.object({action:z.literal("save"),schedule:ScheduleInput}).strict(),
 z.object({action:z.literal("pause"),id:z.uuid()}).strict(),
 z.object({action:z.literal("resume"),id:z.uuid()}).strict(),
 z.object({action:z.literal("run"),id:z.uuid().optional()}).strict()
]);
export async function GET(request:Request){try{
 const context=await getAppContext(request.headers);assertPermission(context,"files.review");
 const data=await withDatabase(databaseContext(context,request.headers),db=>ingestionState(db,context.tenantId));
 return Response.json(data,{headers:{"cache-control":"no-store"}});
}catch(e){return errorResponse(e);}}
export async function POST(request:Request){try{
 const context=await getAppContext(request.headers);assertPermission(context,"files.review");
 if(!(await rateLimit(request,"ingestion",30,60*60_000)).ok)throw new HttpError(429,"Too many ingestion requests. Try again later.");
 const input=Action.safeParse(await readJsonLimited(request,12_000));
 if(!input.success)throw new HttpError(400,"Choose a valid schedule action, link and CSV template.");
 const transaction=<T,>(fn:Parameters<typeof withDatabase<T>>[1])=>withDatabase(databaseContext(context,request.headers),fn);
 const value=input.data;
 const result=value.action==="run"?await runSchedule(transaction,context.tenantId,context.userId,value.id):
  await transaction(db=>value.action==="save"?saveSchedule(db,context.tenantId,context.userId,value.schedule):pauseSchedule(db,context.tenantId,context.userId,value.id,value.action==="resume"));
 return Response.json(result,{headers:{"cache-control":"no-store"}});
}catch(e){return errorResponse(e);}}
