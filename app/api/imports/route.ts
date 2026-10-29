import {NextResponse} from "next/server";
import {z} from "zod";
import {assertPermission,errorResponse,HttpError} from "@/lib/authz";
import {getAppContext,databaseContext} from "@/lib/context";
import {withDatabase} from "@/lib/db";
import {readJsonLimited} from "@/lib/request";
import {rateLimit} from "@/lib/rate-limit";
import {commitImport,undoImport,exportLifeline,importHistory} from "@/lib/import-lifecycle";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const Action=z.discriminatedUnion("action",[
 z.object({action:z.literal("export"),supplier:z.string().max(200).optional()}).strict(),
 z.object({action:z.literal("commit"),id:z.uuid(),acknowledgeRejected:z.boolean()}).strict(),
 z.object({action:z.literal("undo"),id:z.uuid()}).strict()
]);
export async function GET(request:Request){try{
 const context=await getAppContext(request.headers);assertPermission(context,"files.review");
 const history=await withDatabase(databaseContext(context,request.headers),db=>importHistory(db,context.tenantId));
 return NextResponse.json({history},{headers:{"cache-control":"no-store"}});
}catch(error){return errorResponse(error);}}
export async function POST(request:Request){let actionName="";try{
 const context=await getAppContext(request.headers);assertPermission(context,"files.review");
 if(!(await rateLimit(request,"import-actions",30,60*60_000)).ok)throw new HttpError(429,"Too many import actions. Try again later.");
 const parsed=Action.safeParse(await readJsonLimited(request));if(!parsed.success)throw new HttpError(400,"Choose a valid import action.");
 const input=parsed.data;
 actionName=input.action;
 const data=await withDatabase(databaseContext(context,request.headers),async db=>{
  if(input.action==="export")return exportLifeline(db,context.tenantId,context.userId,input.supplier);
  if(input.action==="commit")return commitImport(db,context.tenantId,context.userId,input.id,input.acknowledgeRejected);
  return undoImport(db,context.tenantId,context.userId,input.id);
 });
 if(typeof data==="string")return new Response(data,{headers:{"content-type":"text/csv;charset=utf-8","content-disposition":'attachment; filename="margindesk-lifeline.csv"',"cache-control":"no-store","x-content-type-options":"nosniff"}});
 return NextResponse.json(data,{headers:{"cache-control":"no-store"}});
}catch(error){
 // Undo can encounter a new quote/invoice FK after the snapshot check. The
 // transaction has already rolled back; preserve later work and explain it.
 if(error&&typeof error==="object"&&"code" in error&&error.code==="23503")return errorResponse(new HttpError(409,actionName==="undo"?"Later work references an imported row. Undo that work first; this import was not changed.":"Required catalog or unit data changed. Run a fresh preview; no import changes were saved."));
 if(error&&typeof error==="object"&&"code" in error&&["23505","23P01"].includes(String(error.code)))return errorResponse(new HttpError(409,"A SKU or dated price/cost changed while importing. Run a fresh preview; no changes were committed."));
 return errorResponse(error);
}}
