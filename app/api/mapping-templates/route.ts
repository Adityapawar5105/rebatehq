import { legacyBusinessEnabled, retiredBusinessResponse } from "@/lib/legacy-gate";
import { NextResponse } from "next/server";
import { assertPermission,errorResponse,HttpError } from "@/lib/authz";
import { getAppContext,databaseContext } from "@/lib/context";
import { withDatabase } from "@/lib/db";
import { readJsonLimited } from "@/lib/request";
import { TemplateKey,TemplateInput,loadMappingTemplate,saveMappingTemplate } from "@/lib/import-review";
import { rateLimit } from "@/lib/rate-limit";
export const dynamic="force-dynamic";
export async function GET(request:Request){if (!legacyBusinessEnabled()) return retiredBusinessResponse();try{
 const context=await getAppContext(request.headers);assertPermission(context,"files.review");
 const params=new URL(request.url).searchParams;const key=TemplateKey.safeParse({supplier:params.get("supplier"),fileType:params.get("fileType")});if(!key.success)throw new HttpError(400,"Choose a supplier and file type.");
 const template=await withDatabase(databaseContext(context,request.headers),db=>loadMappingTemplate(db,context.tenantId,key.data));
 return NextResponse.json({template},{headers:{"cache-control":"no-store"}});
}catch(error){return errorResponse(error);}}
export async function POST(request:Request){if (!legacyBusinessEnabled()) return retiredBusinessResponse();try{
 const context=await getAppContext(request.headers);assertPermission(context,"files.review");
 if(!(await rateLimit(request,"mapping-template",30,60*60_000)).ok)throw new HttpError(429,"Too many template saves. Try again later.");
 const input=TemplateInput.safeParse(await readJsonLimited(request,160*1024));if(!input.success)throw new HttpError(400,"Choose a supplier and a valid mapping.");
 const data=await withDatabase(databaseContext(context,request.headers),db=>saveMappingTemplate(db,context.tenantId,context.userId,input.data));
 return NextResponse.json({template:data},{headers:{"cache-control":"no-store"}});
}catch(error){return errorResponse(error);}}
