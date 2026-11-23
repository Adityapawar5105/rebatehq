"use client";
// Roadmap 8.12 (audit 4.2, "two shells"): account pages use the vault's frame: the same sidebar, top bar, brand,
// "Sign out" wording and phone drawer. Every string arrives already translated from the server page.
// Since 23 Nov 2026 (blueprint section 22, item 36, A1) the sidebar is the vault's own tree: the account pages sit under
// Settings next to its General, Security and storage, and Team and roles pages.
import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import { SideNav } from "@/components/local/SideNav";
import { Button } from "@/components/ui/ui";
import { clearOfflineCopy } from "@/components/local/OfflineMode";
import sh from "@/components/local/shell.module.css";
import vault from "@/components/local/vault.module.css";

export type AccountNavItem = { href: string; label: string; icon: IconName; children?: { href: string; label: string }[] };
export type AccountShellText = { brand: string; brandMark: string; sidebar: string; mainNav: string; menu: string; closeMenu: string; signOut: string };

export function AccountShell({ text, nav, workspace, email, tools, footer, children }: { text: AccountShellText; nav: AccountNavItem[]; workspace: string; email: string; tools?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  const [drawer, setDrawer] = useState(false), path = usePathname();
  const items = nav.map(item => { const kids = item.children ?? []; return { ...item, current: item.href === path || kids.some(c => c.href === path), children: kids.map(c => ({ ...c, current: c.href === path })) }; });
  return <div className={`${vault.shell} ${sh.frame}`} data-nav="open" data-drawer={drawer ? "open" : "closed"}>
    <aside className={sh.sidebar} id="account-sidebar" aria-label={text.sidebar}>
      <a href="/home" className={sh.brand}><span className={sh.mark} aria-hidden="true">{text.brandMark}</span><span className={sh.label}>{text.brand}</span></a>
      <SideNav label={text.mainNav} items={items} onNavigate={() => setDrawer(false)}/>
      <div className={sh.sideFoot}>
        <div className={sh.workspace}><strong translate="no">{workspace}</strong><span translate="no">{email}</span></div>
        {footer}
      </div>
    </aside>
    {drawer && <button type="button" className={sh.scrim} aria-label={text.closeMenu} onClick={() => setDrawer(false)}/>}
    <div className={sh.main}>
      <header className={sh.topbar}>
        <button type="button" className={sh.menuButton} aria-label={text.menu} aria-expanded={drawer} aria-controls="account-sidebar" onClick={() => setDrawer(true)}><Icon name="menu"/></button>
        <div className={sh.tools}>
          {tools}
          <form className={sh.signout} method="post" action="/api/auth/logout" onSubmit={e => { const form = e.currentTarget; e.preventDefault(); void clearOfflineCopy().finally(() => form.submit()); }}>
            <Button type="submit" variant="ghost" size="sm" icon="logout">{text.signOut}</Button>
          </form>
        </div>
      </header>
      <main id="account-content" className={sh.content} tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
