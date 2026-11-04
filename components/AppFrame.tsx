import { legacyBusinessEnabled } from "@/lib/legacy-gate";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AppContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { GlobalSearch } from "@/components/GlobalSearch";
import { TenantSwitcher } from "@/components/TenantSwitcher";

const links = [["Dashboard","/legacy/dashboard"],["Price Lists","/legacy/prices"],["Quoting","/legacy/quoting"],["Rebates","/legacy/rebates"]] as const;
export function AppFrame({ context, children }: { context: AppContext; children: ReactNode }) {
  const legacy = legacyBusinessEnabled();
  return <>
    <header className="topbar">
      <Link className="brand" href="/home"><span className="mark">M</span>RebateHQ</Link>
      {legacy && <GlobalSearch />}
      <span className="status-chip">{context.role}</span>
      <details className="account-menu"><summary className="status-chip">{context.email} ▾</summary><div className="account-panel">
        {can(context.role,"users.read") && <Link href="/account/users">Users & invitations</Link>}
        {can(context.role,"audit.read") && <Link href="/account/audit">Audit log</Link>}
        {legacy && can(context.role,"policy.read") && <Link href="/legacy/account/policy">Margin guardrails</Link>}
        {legacy && context.role === "owner" && <Link href="/legacy/account/data">Data migration & export</Link>}
        <Link href="/account/workspace">Workspace settings</Link>
        <TenantSwitcher tenants={context.memberships} selected={context.tenantId} />
        {process.env.NODE_ENV === "development" && process.env.DEV_IMPERSONATION_ENABLED === "true" && <Link href="/account/dev">Development impersonation</Link>}
        {context.impersonated && <form action="/api/dev/impersonate/stop" method="post"><button type="submit">Stop impersonating</button></form>}
        <form action="/api/auth/logout" method="post"><button type="submit">Log out everywhere</button></form>
      </div></details>
    </header>
    <nav className="nav" aria-label="Main navigation">{(legacy ? links : [["Local vault","/home"]] as const).map(([label,href])=><Link key={href} href={href} className="top-nav-link">{label}</Link>)}</nav>
    <main className="app-content">{legacy && <div className="demo-ribbon">LEGACY · Server-backed foundation. Business data on these pages is stored in Supabase. <a href="/home">Open the local vault</a></div>}
      {context.isDemo && <div className="demo-ribbon">DEMO WORKSPACE · Sample records only. Do not upload live customer data.</div>}
      {context.impersonated && <div className="impersonation-ribbon">DEVELOPMENT IMPERSONATION · Actions are recorded with the real actor.</div>}
      {children}
      <footer className="app-footer">Workspace: {context.tenantName} · {context.role} access · RebateHQ Phase 1 foundation</footer>
    </main>
  </>;
}
