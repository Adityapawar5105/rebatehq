import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/context";
import { LoginForm } from "@/components/LoginForm";
export const dynamic="force-dynamic";
export default async function Login(){const state=await getAuthState();if(state?.memberships.length)redirect("/home");return <main className="app-content"><section className="app-card" style={{maxWidth:640,margin:"10vh auto"}}><div className="brand"><span className="mark">M</span>MarginDesk</div><h1>Sign in to your workspace</h1><p className="muted">Use a verified email address. Only invited users can join an existing company workspace.</p><LoginForm/></section></main>}
