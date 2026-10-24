import { LoginForm } from "@/components/LoginForm";
export const dynamic="force-dynamic";
export default async function InvitePage({params}:{params:Promise<{token:string}>}){const {token}=await params;return <main className="app-content"><section className="app-card" style={{maxWidth:650,margin:"8vh auto"}}><span className="status-chip">Workspace invitation</span><h1>Accept your invitation</h1><p className="muted">Sign in using the email address the workspace owner invited. The link is single-use and expires after seven days.</p><LoginForm inviteToken={token}/></section></main>}
