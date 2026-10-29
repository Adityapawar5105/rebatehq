import {NextResponse} from "next/server";
import {z} from "zod";
import {assertPermission,errorResponse,HttpError} from "@/lib/authz";
import {getAppContext,databaseContext} from "@/lib/context";
import {withDatabase} from "@/lib/db";
import {readBytesLimited} from "@/lib/request";
import {rateLimit} from "@/lib/rate-limit";
import {parseUpload} from "@/lib/upload-parser";
import {UPLOAD_LIMITS} from "@/lib/upload-types";
import {ImportOptions,previewImport} from "@/lib/import-lifecycle";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
const Options=z.object({sheetId:z.string().max(4),headerRow:z.number().int().min(1).max(UPLOAD_LIMITS.rows),mapping:z.record(z.string(),z.number().int().min(0).max(63)),rules:ImportOptions}).strict();
export async function POST(request:Request){try{
 const context=await getAppContext(request.headers);assertPermission(context,"files.review");
 if(!(await rateLimit(request,"import-plan",30,60*60_000)).ok)throw new HttpError(429,"Too many import previews. Try again later.");
 let filename:string;try{filename=decodeURIComponent(request.headers.get("x-file-name")||"");}catch{throw new HttpError(400,"Choose a file with a valid name.");}
 if(!filename||filename.length>255)throw new HttpError(400,"Choose a file name of 255 characters or fewer.");
 const raw=request.headers.get("x-import-options")||"{}";if(raw.length>8000)throw new HttpError(400,"The import options are too large.");
 let options:unknown;try{options=JSON.parse(raw);}catch{throw new HttpError(400,"Choose valid import options.");}
 const safe=Options.safeParse(options);if(!safe.success)throw new HttpError(400,"Choose the mapping, effective date, and explicit approvals.");
 const parsed=parseUpload(filename,await readBytesLimited(request,UPLOAD_LIMITS.bytes),safe.data);
 const plan=await withDatabase(databaseContext(context,request.headers),db=>previewImport(db,context.tenantId,context.userId,filename,parsed,safe.data.rules));
 return NextResponse.json({plan},{headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});
}catch(error){return errorResponse(error);}}
