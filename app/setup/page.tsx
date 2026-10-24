import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/context";
import { CreateTenantForm } from "@/components/CreateTenantForm";
export const dynamic="force-dynamic";
export default async function Setup(){const state=await getAuthState();if(!state)redirect("/login");if(state.memberships.length)redirect("/dashboard");return <main className="app-content"><section className="app-card" style={{maxWidth:700,margin:"8vh auto"}}><span className="status-chip">Verified account · no workspace access</span><h1>Create a new workspace</h1><p className="muted">You are not a member of an existing workspace. Create a new company workspace, or sign in using the email address that received your invitation.</p><CreateTenantForm/></section></main>}
