import { readJsonLimited } from "@/lib/request";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LoginSchema } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp, withDatabase } from "@/lib/db";
import { logSecurityEvent } from "@/lib/secure-logger";
export const runtime="nodejs";
export async function POST(request:Request){
 try{
  const limit=await rateLimit(request,"login",8,10*60_000);if(!limit.ok)return NextResponse.json({error:"Too many sign-in attempts. Wait a few minutes and try again."},{status:429});
  const parsed=LoginSchema.safeParse(await readJsonLimited(request));if(!parsed.success)return NextResponse.json({error:"Enter a valid email address."},{status:400});
  const email=parsed.data.email.trim().toLowerCase();const origin=process.env.APP_BASE_URL||new URL(request.url).origin;const callback=new URL("/auth/callback",origin);if(parsed.data.inviteToken)callback.searchParams.set("invite",parsed.data.inviteToken);
  const supabase=await createSupabaseServerClient();const {error}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:callback.toString()}});
  if(error){logSecurityEvent("auth.login_failed",{email,ip_hash:clientIp(request.headers),reason:error.name});await withDatabase({headers:request.headers},db=>db.query("SELECT public.record_failed_login($1,$2,$3)",[email,clientIp(request.headers),request.headers.get("user-agent")||""])).catch(()=>undefined);return NextResponse.json({error:"We couldn't send a sign-in link to that address. Check it and try again."},{status:400});}
  logSecurityEvent("auth.magic_link_requested",{email,ip_hash:clientIp(request.headers)});return NextResponse.json({ok:true});
 }catch(error){const message=error instanceof Error?error.message:"";if(message.includes("rate limiter"))return NextResponse.json({error:"Sign-in is temporarily unavailable. Please try again later."},{status:503});console.error(JSON.stringify({event:"auth.request_error",name:error instanceof Error?error.name:"unknown"}));return NextResponse.json({error:"We couldn't send a sign-in link. Try again later."},{status:500});}
}
