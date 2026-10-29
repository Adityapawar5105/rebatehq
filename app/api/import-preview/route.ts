import { NextResponse } from "next/server";
import { z } from "zod";
import { assertPermission,errorResponse,HttpError } from "@/lib/authz";
import { getAppContext,databaseContext } from "@/lib/context";
import { withDatabase } from "@/lib/db";
import { readBytesLimited } from "@/lib/request";
import { rateLimit } from "@/lib/rate-limit";
import { parseUpload } from "@/lib/upload-parser";
import { UPLOAD_LIMITS } from "@/lib/upload-types";
import { createImportReview,importReviewIssues } from "@/lib/import-review";
import {IMPORT_PREVIEW_PAGE_SIZE} from "@/lib/import-config";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
const Options=z.object({sheetId:z.string().max(4).optional(),headerRow:z.number().int().min(1).max(UPLOAD_LIMITS.rows).optional(),mapping:z.record(z.string(),z.number().int().min(0).max(63)).optional()}).strict();
export async function GET(request:Request){try{
 const context=await getAppContext(request.headers);assertPermission(context,"files.review");
 const params=new URL(request.url).searchParams;
 const input=z.object({id:z.uuid(),offset:z.coerce.number().int().min(0).max(UPLOAD_LIMITS.issues),limit:z.coerce.number().int().min(1).max(IMPORT_PREVIEW_PAGE_SIZE*10)}).safeParse({id:params.get("job"),offset:params.get("offset")||0,limit:params.get("limit")||IMPORT_PREVIEW_PAGE_SIZE});
 if(!input.success)throw new HttpError(400,"Choose a valid review issue page.");
 const data=await withDatabase(databaseContext(context,request.headers),db=>importReviewIssues(db,context.tenantId,input.data.id,input.data.offset,input.data.limit));
 return NextResponse.json(data,{headers:{"cache-control":"no-store"}});
}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{
 const context=await getAppContext(request.headers);assertPermission(context,"files.review");
 if(!(await rateLimit(request,"supplier-file-review",30,60*60_000)).ok)throw new HttpError(429,"Too many file reviews. Try again in an hour.");
 let filename:string;try{filename=decodeURIComponent(request.headers.get("x-file-name")||"");}catch{throw new HttpError(400,"Choose a file with a valid name.");}
 if(filename.length>255)throw new HttpError(400,"Choose a shorter file name.");
 const raw=request.headers.get("x-import-options")||"{}";if(raw.length>4096)throw new HttpError(400,"The review options are too large.");
 let options:unknown;try{options=JSON.parse(raw);}catch{throw new HttpError(400,"Choose valid sheet and mapping options.");}
 const safe=Options.safeParse(options);if(!safe.success)throw new HttpError(400,"Choose valid sheet and mapping options.");
 const bytes=await readBytesLimited(request,UPLOAD_LIMITS.bytes);const parsed=parseUpload(filename,bytes,safe.data);
 const data=await withDatabase(databaseContext(context,request.headers),db=>createImportReview(db,context.tenantId,context.userId,parsed));
 return NextResponse.json(data,{headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});
}catch(error){return errorResponse(error);}}
