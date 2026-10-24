import { AppFrame } from "@/components/AppFrame";
import { ConnectorSecretForm } from "@/components/ConnectorSecretForm";
import { requireAppPageContext } from "@/lib/context";
import { can } from "@/lib/permissions";
export const dynamic="force-dynamic";
export default async function WorkspacePage(){const context=await requireAppPageContext();return <AppFrame context={context}><div className="page-head"><div><h1>Workspace settings</h1><p>Basic workspace status and connection credentials.</p></div></div><section className="app-card"><h2>{context.tenantName}</h2><p>Workspace mode: <b>{context.isDemo?"Demo / sample data":"Customer workspace"}</b></p><p className="small muted">Role: {context.role}. Membership, tenant access, and data filters are enforced in PostgreSQL and the server APIs.</p></section>{context.role==="owner"&&<section className="app-card"><h2>Connector credentials</h2><p className="muted">Credentials are encrypted with AES-256-GCM before storage and are not returned to the browser. This foundation does not start a connector sync.</p><ConnectorSecretForm/></section>}</AppFrame>}
