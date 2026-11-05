import { legacyBusinessEnabled } from "@/lib/legacy-gate";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AppContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { GlobalSearch } from "@/components/GlobalSearch";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { Preferences } from "@/components/Preferences";
import { serverT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/core";

const links: ReadonlyArray<readonly [MessageKey, string]> = [["frame.dashboard","/legacy/dashboard"],["frame.priceLists","/legacy/prices"],["frame.quoting","/legacy/quoting"],["frame.rebates","/legacy/rebates"]];
const ROLE_KEY: Record<string, MessageKey> = { owner: "users.owner", manager: "users.manager", analyst: "users.analyst", rep: "users.rep" };
export async function AppFrame({ context, children }: { context: AppContext; children: ReactNode }) {
  const t = await serverT(), role = context.role in ROLE_KEY ? t(ROLE_KEY[context.role]) : context.role;
  const legacy = legacyBusinessEnabled();
  return <>
    <header className="topbar">
      <Link className="brand" href="/home"><span className="mark" aria-hidden="true">{t("shell.brandMark")}</span>{t("app.name")}</Link>
      {legacy && <GlobalSearch />}
      <span className="status-chip">{role}</span><Preferences className="prefs"/>
      <details className="account-menu"><summary className="status-chip">{context.email} ▾</summary><div className="account-panel">
        {can(context.role,"users.read") && <Link href="/account/users">{t("frame.usersInvitations")}</Link>}
        {can(context.role,"audit.read") && <Link href="/account/audit">{t("frame.auditLog")}</Link>}
        {legacy && can(context.role,"policy.read") && <Link href="/legacy/account/policy">{t("frame.marginGuardrails")}</Link>}
        {legacy && context.role === "owner" && <Link href="/legacy/account/data">{t("frame.dataMigrationExport")}</Link>}
        <Link href="/account/workspace">{t("frame.workspaceSettings")}</Link>
        <TenantSwitcher tenants={context.memberships} selected={context.tenantId} />
        {process.env.NODE_ENV === "development" && process.env.DEV_IMPERSONATION_ENABLED === "true" && <Link href="/account/dev">{t("frame.developmentImpersonation")}</Link>}
        {context.impersonated && <form action="/api/dev/impersonate/stop" method="post"><button type="submit">{t("frame.stopImpersonating")}</button></form>}
        <form action="/api/auth/logout" method="post"><button type="submit">{t("frame.logOutEverywhere")}</button></form>
      </div></details>
    </header>
    <nav className="nav" aria-label={t("frame.mainNavigation")}>{(legacy ? links : [["frame.localVault","/home"] as const]).map(([label,href])=><Link key={href} href={href} className="top-nav-link">{t(label)}</Link>)}</nav>
    <main className="app-content">{legacy && <div className="demo-ribbon">{t("frame.legacyServerBackedFoundation")}{" "}<a href="/home">{t("frame.openTheLocalVault")}</a></div>}
      {context.isDemo && <div className="demo-ribbon">{t("frame.demoWorkspaceSampleRecords")}</div>}
      {context.impersonated && <div className="impersonation-ribbon">{t("frame.developmentImpersonationActionsAre")}</div>}
      {children}
      <footer className="app-footer">{t("frame.workspaceAccessRebatehqPhase", { tenantName: context.tenantName, role })}</footer>
    </main>
  </>;
}
