import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withDatabase } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { logSecurityEvent } from "@/lib/secure-logger";
export const runtime="nodejs";
// Email link types Supabase may put in a token-hash link. Anything else is refused.
const OTP_TYPES=new Set<EmailOtpType>(["email","magiclink","signup","invite"]);
/**
 * Finishes an email sign-in. Two link shapes are accepted:
 * - `token_hash` + `type` (the email template's own link): verified on the server, so it works on any device or
 *   browser, including a different laptop or a phone's mail app;
 * - `code` (Supabase's default PKCE link): only works in the browser that asked for the link, because the code
 *   verifier is a cookie there.
 * A failure lands on /login with a reason the page explains, never on a silent loop.
 */
export async function GET(request:Request){
 const url=new URL(request.url),code=url.searchParams.get("code"),tokenHash=url.searchParams.get("token_hash"),type=url.searchParams.get("type") as EmailOtpType|null;
 const cookieStore=await cookies(),invite=url.searchParams.get("invite")||cookieStore.get("md-invite")?.value||null;
 const fail=(reason:"link"|"expired"|"browser"|"invite")=>NextResponse.redirect(new URL("/login?error="+reason,url.origin));
 if(url.searchParams.get("error_code")||url.searchParams.get("error"))return fail(url.searchParams.get("error_code")==="otp_expired"?"expired":"link");
 const supabase=await createSupabaseServerClient();
 if(tokenHash&&type&&OTP_TYPES.has(type)){
  const {error}=await supabase.auth.verifyOtp({token_hash:tokenHash,type});
  if(error){logSecurityEvent("auth.callback_failed",{reason:error.name});return fail("expired");}
 }else if(code){
  const {error}=await supabase.auth.exchangeCodeForSession(code);
  // No code verifier here means the link was opened in another browser or device than the one that asked for it.
  if(error){logSecurityEvent("auth.callback_failed",{reason:error.name});return fail(/verifier/i.test(error.message)?"browser":"expired");}
 }else return fail("link");
 const {data:{user}}=await supabase.auth.getUser();if(!user?.email)return fail("link");
 try{
  if(invite){const tenantId=await withDatabase({userId:user.id,headers:request.headers},async db=>(await db.query<{tenant_id:string}>("SELECT public.accept_tenant_invite($1) AS tenant_id",[invite])).rows[0]?.tenant_id);if(!tenantId)return fail("invite");cookieStore.set("md-tenant",tenantId,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:60*60*24*365});}
  await withDatabase({userId:user.id,headers:request.headers},async db=>{const memberships=await db.query<{tenant_id:string}>("SELECT tenant_id FROM membership WHERE user_id=$1 AND status='active'",[user.id]);for(const item of memberships.rows)await appendAudit(db,{tenantId:item.tenant_id,actorId:user.id,action:"auth.login_succeeded",entityType:"auth_user",entityId:user.id,after:{method:"magic_link"}});});
 }catch(error){logSecurityEvent("auth.callback_membership_error",{reason:error instanceof Error?error.name:"unknown"});return fail("invite");}
 if(invite)cookieStore.delete("md-invite");
 const state=await withDatabase({userId:user.id,headers:request.headers},db=>db.query("SELECT 1 FROM membership WHERE user_id=$1 AND status='active' LIMIT 1",[user.id]));
 return NextResponse.redirect(new URL(state.rowCount?"/home":"/setup",url.origin));
}
