import { readJsonLimited } from "@/lib/request";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LoginSchema } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp, withDatabase } from "@/lib/db";
import { logSecurityEvent } from "@/lib/secure-logger";
import { msg } from "../../../../lib/i18n/core";
export const runtime="nodejs";
export async function POST(request:Request){
 try{
  const limit=await rateLimit(request,"login",8,10*60_000);if(!limit.ok)return NextResponse.json({error:msg("api.login.tooManySignIn")},{status:429});
  const parsed=LoginSchema.safeParse(await readJsonLimited(request));if(!parsed.success)return NextResponse.json({error:msg("api.login.enterAValidEmail")},{status:400});
  const email=parsed.data.email.trim().toLowerCase();const origin=process.env.APP_BASE_URL||new URL(request.url).origin;const callback=new URL("/auth/callback",origin);if(parsed.data.inviteToken)callback.searchParams.set("invite",parsed.data.inviteToken);
  const supabase=await createSupabaseServerClient();const {error}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:callback.toString()}});
  // Supabase's email sender has its own hourly limit (very low on the built-in mailer): say so instead of blaming the address.
  if(error&&(error.status===429||/rate limit|over_email_send/i.test(error.message+" "+((error as {code?:string}).code??"")))){logSecurityEvent("auth.login_email_limited",{ip_hash:clientIp(request.headers)});return NextResponse.json({error:msg("api.login.emailLimit")},{status:429});}
  if(error){logSecurityEvent("auth.login_failed",{email,ip_hash:clientIp(request.headers),reason:error.name});await withDatabase({headers:request.headers},db=>db.query("SELECT public.record_failed_login($1,$2,$3)",[email,clientIp(request.headers),request.headers.get("user-agent")||""])).catch(()=>undefined);return NextResponse.json({error:msg("api.login.weCouldnTSend2")},{status:400});}
  logSecurityEvent("auth.magic_link_requested",{email,ip_hash:clientIp(request.headers)});const ok=NextResponse.json({ok:true});
  // The invite also rides in a short-lived cookie, for email links that cannot carry it (token-hash template links).
  if(parsed.data.inviteToken)ok.cookies.set("md-invite",parsed.data.inviteToken,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/auth/callback",maxAge:60*60});
  return ok;
 }catch(error){const message=error instanceof Error?error.message:"";if(message.includes("rate limiter"))return NextResponse.json({error:msg("api.login.signInIsTemporarily")},{status:503});console.error(JSON.stringify({event:"auth.request_error",name:error instanceof Error?error.name:"unknown"}));return NextResponse.json({error:msg("api.login.weCouldnTSend")},{status:500});}
}
