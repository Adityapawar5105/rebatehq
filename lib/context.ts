import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withDatabase } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { devImpersonationEnabled, verifyImpersonation } from "@/lib/impersonation";

export type AppContext = {
  userId: string;
  email: string;
  tenantId: string;
  tenantName: string;
  currency: string;
  isDemo: boolean;
  role: Role;
  headers?: Headers;
  actorId: string;
  impersonated: boolean;
  memberships: AuthState["memberships"];
};
export type AuthState = { user: { id: string; email: string }; memberships: Array<{ tenant_id: string; name: string; currency:string; is_demo: boolean; role: Role }>; realActorId:string; impersonated:boolean };

export async function getAuthState(headers?: Headers): Promise<AuthState | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.email) return null;
  let effectiveUserId=user.id;let effectiveEmail=user.email;let realActorId=user.id;let impersonated=false;
  if(devImpersonationEnabled()){
    const cookieStore=await cookies();const token=cookieStore.get("md-dev-impersonation")?.value;const value=verifyImpersonation(token,user.id);
    if(value){effectiveUserId=value.targetUserId;realActorId=user.id;impersonated=true;}
  }
  let memberships = await withDatabase({ userId: effectiveUserId, realActorId, headers }, async (db) => {
    const result = await db.query<{tenant_id:string;name:string;currency:string;is_demo:boolean;role:Role}>(
      `SELECT m.tenant_id,t.name,t.currency,t.is_demo,m.role FROM membership m JOIN tenant t USING (tenant_id)
       WHERE m.user_id=$1 AND m.status='active' AND t.deleted_at IS NULL ORDER BY m.created_at`, [effectiveUserId]);
    return result.rows;
  });
  if(impersonated){const selected=cookieTenantId(await cookies());const match=memberships.find(item=>item.tenant_id===selected)||memberships[0];if(!match){effectiveUserId=user.id;effectiveEmail=user.email;impersonated=false;realActorId=user.id;memberships=await withDatabase({userId:user.id,headers},async db=>(await db.query<{tenant_id:string;name:string;currency:string;is_demo:boolean;role:Role}>(`SELECT m.tenant_id,t.name,t.currency,t.is_demo,m.role FROM membership m JOIN tenant t USING (tenant_id) WHERE m.user_id=$1 AND m.status='active' AND t.deleted_at IS NULL ORDER BY m.created_at`,[user.id])).rows);}else{const emailResult=await withDatabase({userId:effectiveUserId,realActorId,headers},db=>db.query<{email:string}>("SELECT email FROM membership WHERE tenant_id=$1 AND user_id=$2",[match.tenant_id,effectiveUserId]));effectiveEmail=emailResult.rows[0]?.email||"development-user";}}
  return { user: { id: effectiveUserId, email: effectiveEmail }, memberships, realActorId, impersonated };
}

export async function getAppContext(headers?: Headers): Promise<AppContext | null> {
  const state = await getAuthState(headers);
  if (!state?.memberships.length) return null;
  const cookieStore = await cookies();
  const desiredTenant = cookieStore.get("md-tenant")?.value;
  const membership = state.memberships.find((item) => item.tenant_id === desiredTenant) || state.memberships[0];
  return {
    userId: state.user.id, email: state.user.email, tenantId: membership.tenant_id,
    tenantName: membership.name, currency:membership.currency, isDemo: membership.is_demo, role: membership.role,
    headers, actorId: state.realActorId, impersonated: state.impersonated, memberships: state.memberships
  };
}

function cookieTenantId(cookieStore:Awaited<ReturnType<typeof cookies>>){return cookieStore.get("md-tenant")?.value;}

export function databaseContext(context:AppContext,headers?:Headers){return{userId:context.userId,actorId:context.actorId,realActorId:context.actorId,headers};}

export async function requireAppPageContext(): Promise<AppContext> {
  const state = await getAuthState();
  if (!state) redirect("/login");
  if (!state.memberships.length) redirect("/setup");
  const context = await getAppContext();
  if (!context) redirect("/setup");
  return context;
}
