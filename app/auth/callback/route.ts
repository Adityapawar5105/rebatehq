import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withDatabase } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { logSecurityEvent } from "@/lib/secure-logger";
export const runtime="nodejs";
export async function GET(request:Request){
 const url=new URL(request.url),code=url.searchParams.get("code"),invite=url.searchParams.get("invite");const fail=new URL("/login?error=link",url.origin);
 if(!code)return NextResponse.redirect(fail);
 const supabase=await createSupabaseServerClient();const {error}=await supabase.auth.exchangeCodeForSession(code);if(error){logSecurityEvent("auth.callback_failed",{reason:error.name});return NextResponse.redirect(fail)}
 const {data:{user}}=await supabase.auth.getUser();if(!user?.email)return NextResponse.redirect(fail);
 const cookieStore=await cookies();
 try{
  if(invite){const tenantId=await withDatabase({userId:user.id,headers:request.headers},async db=>(await db.query<{tenant_id:string}>("SELECT public.accept_tenant_invite($1) AS tenant_id",[invite])).rows[0]?.tenant_id);if(!tenantId)return NextResponse.redirect(new URL("/login?error=invite",url.origin));cookieStore.set("md-tenant",tenantId,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:60*60*24*365});}
  await withDatabase({userId:user.id,headers:request.headers},async db=>{const memberships=await db.query<{tenant_id:string}>("SELECT tenant_id FROM membership WHERE user_id=$1 AND status='active'",[user.id]);for(const item of memberships.rows)await appendAudit(db,{tenantId:item.tenant_id,actorId:user.id,action:"auth.login_succeeded",entityType:"auth_user",entityId:user.id,after:{method:"magic_link"}});});
 }catch(error){logSecurityEvent("auth.callback_membership_error",{reason:error instanceof Error?error.name:"unknown"});return NextResponse.redirect(new URL("/login?error=invite",url.origin));}
 const state=await withDatabase({userId:user.id,headers:request.headers},db=>db.query("SELECT 1 FROM membership WHERE user_id=$1 AND status='active' LIMIT 1",[user.id]));
 return NextResponse.redirect(new URL(state.rowCount?"/home":"/setup",url.origin));
}
