import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withDatabase } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { logSecurityEvent } from "@/lib/secure-logger";
import { seeOther } from "@/lib/see-other";
export const runtime="nodejs";
// Email link types Supabase may put in a token-hash link. Anything else is refused.
const OTP_TYPES=new Set<EmailOtpType>(["email","magiclink","signup","invite"]);
type Reason="link"|"expired"|"browser"|"invite";
const fail=(reason:Reason)=>seeOther("/login?error="+reason);
/**
 * Finishes an email sign-in. Two link shapes are accepted:
 * - `token_hash` + `type` (the email template's own link). It works on any device or browser, so a plain GET never
 *   signs anyone in: it shows /auth/confirm, and only that page's same-origin POST (proxy-checked Origin) verifies the
 *   token. Mail scanners that prefetch links cannot use up the link, and a crafted link cannot sign a visitor into
 *   someone else's account without a deliberate click.
 * - `code` (Supabase's default PKCE link). It needs the code-verifier cookie of the browser that asked for the link,
 *   which already ties it to that browser.
 * A failure lands on /login with a reason the page explains, never on a silent loop. Every redirect is relative
 * (lib/see-other.ts): behind Netlify, request.url names the deploy host, not the address the user opened.
 */
export async function GET(request:Request){
 const url=new URL(request.url),code=url.searchParams.get("code"),tokenHash=url.searchParams.get("token_hash"),type=url.searchParams.get("type");
 if(url.searchParams.get("error_code")||url.searchParams.get("error"))return fail(url.searchParams.get("error_code")==="otp_expired"?"expired":"link");
 if(tokenHash&&type){const next=new URLSearchParams({token_hash:tokenHash,type});const invite=url.searchParams.get("invite");if(invite)next.set("invite",invite);return seeOther("/auth/confirm?"+next.toString());}
 if(!code)return fail("link");
 const supabase=await createSupabaseServerClient();
 const {error}=await supabase.auth.exchangeCodeForSession(code);
 // No code verifier here means the link was opened in another browser or device than the one that asked for it.
 if(error){logSecurityEvent("auth.callback_failed",{reason:error.name});return fail(/verifier/i.test(error.message)?"browser":"expired");}
 return finish(request,url.searchParams.get("invite"));
}
/** The confirm page's button: verify the token-hash link, then continue exactly like a code link. */
export async function POST(request:Request){
 let form:FormData;try{form=await request.formData();}catch{return fail("link");}
 const tokenHash=form.get("token_hash"),type=form.get("type"),invite=form.get("invite");
 if(typeof tokenHash!=="string"||!tokenHash||tokenHash.length>512||typeof type!=="string"||!OTP_TYPES.has(type as EmailOtpType))return fail("link");
 const supabase=await createSupabaseServerClient();
 const {error}=await supabase.auth.verifyOtp({token_hash:tokenHash,type:type as EmailOtpType});
 if(error){logSecurityEvent("auth.callback_failed",{reason:error.name});return fail("expired");}
 return finish(request,typeof invite==="string"&&invite?invite:null);
}
async function finish(request:Request,inviteParam:string|null){
 const cookieStore=await cookies(),invite=inviteParam||cookieStore.get("md-invite")?.value||null;
 const supabase=await createSupabaseServerClient();
 const {data:{user}}=await supabase.auth.getUser();if(!user?.email)return fail("link");
 try{
  if(invite){const tenantId=await withDatabase({userId:user.id,headers:request.headers},async db=>(await db.query<{tenant_id:string}>("SELECT public.accept_tenant_invite($1) AS tenant_id",[invite])).rows[0]?.tenant_id);if(!tenantId)return fail("invite");cookieStore.set("md-tenant",tenantId,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:60*60*24*365});}
  await withDatabase({userId:user.id,headers:request.headers},async db=>{const memberships=await db.query<{tenant_id:string}>("SELECT tenant_id FROM membership WHERE user_id=$1 AND status='active'",[user.id]);for(const item of memberships.rows)await appendAudit(db,{tenantId:item.tenant_id,actorId:user.id,action:"auth.login_succeeded",entityType:"auth_user",entityId:user.id,after:{method:"magic_link"}});});
 }catch(error){logSecurityEvent("auth.callback_membership_error",{reason:error instanceof Error?error.name:"unknown"});return fail("invite");}
 if(invite)cookieStore.delete("md-invite");
 const state=await withDatabase({userId:user.id,headers:request.headers},db=>db.query("SELECT 1 FROM membership WHERE user_id=$1 AND status='active' LIMIT 1",[user.id]));
 return seeOther(state.rowCount?"/home":"/setup");
}
