import type { ReactNode } from "react";
import type { AppContext } from "@/lib/context";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { Preferences } from "@/components/Preferences";
import { AccountShell, type AccountNavItem } from "@/components/AccountShell";
import { Badge } from "@/components/ui/ui";
import { serverT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/core";
import { accountLinks } from "@/lib/account-nav";

const ROLE_KEY: Record<string, MessageKey> = { owner: "users.owner", manager: "users.manager", analyst: "users.analyst", rep: "users.rep" };
/** Account pages (users, audit, licence, workspace) in the vault's frame and wording (roadmap 8.12). */
export async function AppFrame({ context, children }: { context: AppContext; children: ReactNode }) {
  const t = await serverT(), role = context.role in ROLE_KEY ? t(ROLE_KEY[context.role]) : context.role;
  // One sidebar (23 Nov 2026, A1): Home, then Settings with its three pages and the account pages this role can open.
  const nav: AccountNavItem[] = [{ href: "/home", label: t("shell.section.home"), icon: "home" }, { href: "/home#settings", label: t("shell.section.settings"), icon: "settings", children: [
    { href: "/home#settings-general", label: t("nav.settings.general") }, { href: "/home#settings-security", label: t("nav.settings.security") }, { href: "/home#settings-team", label: t("roles.teamAndRoles") },
    ...accountLinks(context.role, process.env.NODE_ENV === "development" && process.env.DEV_IMPERSONATION_ENABLED === "true").map(l => ({ href: l.href, label: t(l.label) })),
  ] }];
  return <AccountShell workspace={context.tenantName} email={context.email} nav={nav}
    text={{ brand: t("app.name"), brandMark: t("shell.brandMark"), sidebar: t("shell.sidebar"), mainNav: t("shell.mainNav"), menu: t("shell.menu"), closeMenu: t("shell.closeMenu"), signOut: t("shell.signOut") }}
    tools={<><Badge tone="info">{role}</Badge><Preferences className="prefs"/></>}
    footer={<>
      <TenantSwitcher tenants={context.memberships} selected={context.tenantId} />
      {context.impersonated && <form action="/api/dev/impersonate/stop" method="post"><button type="submit">{t("frame.stopImpersonating")}</button></form>}
    </>}>
    {context.isDemo && <div className="demo-ribbon">{t("frame.demoWorkspaceSampleRecords")}</div>}
    {context.impersonated && <div className="impersonation-ribbon">{t("frame.developmentImpersonationActionsAre")}</div>}
    {children}
    <footer className="app-footer">{t("frame.workspaceAccessRebatehqPhase", { tenantName: context.tenantName, role })}</footer>
  </AccountShell>;
}
