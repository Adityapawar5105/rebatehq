import { legacyBusinessEnabled } from "@/lib/legacy-gate";
import type { ReactNode } from "react";
import type { AppContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { GlobalSearch } from "@/components/GlobalSearch";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { Preferences } from "@/components/Preferences";
import { AccountShell, type AccountNavItem } from "@/components/AccountShell";
import { Badge } from "@/components/ui/ui";
import { serverT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/core";

const legacyLinks: ReadonlyArray<readonly [MessageKey, string]> = [["frame.dashboard","/legacy/dashboard"],["frame.priceLists","/legacy/prices"],["frame.quoting","/legacy/quoting"],["frame.rebates","/legacy/rebates"]];
const ROLE_KEY: Record<string, MessageKey> = { owner: "users.owner", manager: "users.manager", analyst: "users.analyst", rep: "users.rep" };
/** Account pages (users, audit, licence, workspace) in the vault's frame and wording (roadmap 8.12). */
export async function AppFrame({ context, children }: { context: AppContext; children: ReactNode }) {
  const t = await serverT(), role = context.role in ROLE_KEY ? t(ROLE_KEY[context.role]) : context.role;
  const legacy = legacyBusinessEnabled();
  const vaultNav: AccountNavItem[] = [{ href: "/home", label: t("shell.section.home"), icon: "home" }, { href: "/home#settings", label: t("shell.section.settings"), icon: "settings" },
    ...(legacy ? legacyLinks.map(([label, href]) => ({ href, label: t(label), icon: "flask" as const })) : [])];
  const accountNav: AccountNavItem[] = [
    ...(can(context.role, "users.read") ? [{ href: "/account/users", label: t("frame.usersInvitations"), icon: "users" as const }] : []),
    ...(can(context.role, "audit.read") ? [{ href: "/account/audit", label: t("frame.auditLog"), icon: "report" as const }] : []),
    { href: "/account/licence", label: t("shell.licenceLink"), icon: "key" },
    { href: "/account/workspace", label: t("frame.workspaceSettings"), icon: "settings" },
    ...(legacy && can(context.role, "policy.read") ? [{ href: "/legacy/account/policy", label: t("frame.marginGuardrails"), icon: "shield" as const }] : []),
    ...(legacy && context.role === "owner" ? [{ href: "/legacy/account/data", label: t("frame.dataMigrationExport"), icon: "database" as const }] : []),
    ...(process.env.NODE_ENV === "development" && process.env.DEV_IMPERSONATION_ENABLED === "true" ? [{ href: "/account/dev", label: t("frame.developmentImpersonation"), icon: "flask" as const }] : []),
  ];
  return <AccountShell workspace={context.tenantName} email={context.email} vaultNav={vaultNav} accountNav={accountNav}
    text={{ brand: t("app.name"), brandMark: t("shell.brandMark"), sidebar: t("shell.sidebar"), mainNav: t("shell.mainNav"), accountNav: t("frame.accountNav"), menu: t("shell.menu"), closeMenu: t("shell.closeMenu"), signOut: t("shell.signOut") }}
    tools={<>{legacy && <GlobalSearch />}<Badge tone="info">{role}</Badge><Preferences className="prefs"/></>}
    footer={<>
      <TenantSwitcher tenants={context.memberships} selected={context.tenantId} />
      {context.impersonated && <form action="/api/dev/impersonate/stop" method="post"><button type="submit">{t("frame.stopImpersonating")}</button></form>}
    </>}>
    {legacy && <div className="demo-ribbon">{t("frame.legacyServerBackedFoundation")}{" "}<a href="/home">{t("frame.openTheLocalVault")}</a></div>}
    {context.isDemo && <div className="demo-ribbon">{t("frame.demoWorkspaceSampleRecords")}</div>}
    {context.impersonated && <div className="impersonation-ribbon">{t("frame.developmentImpersonationActionsAre")}</div>}
    {children}
    <footer className="app-footer">{t("frame.workspaceAccessRebatehqPhase", { tenantName: context.tenantName, role })}</footer>
  </AccountShell>;
}
