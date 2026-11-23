"use client";
// The sidebar tree (23 Nov 2026, blueprint section 22, item 36): each section's sub-pages sit under it instead of a row
// of tabs above the page. Only the open section shows its sub-pages; a section with one page shows none. The vault and
// the account pages both use this, so there is one sidebar everywhere. When the sidebar is collapsed to icons, the open
// section's sub-pages appear as a flyout on hover or keyboard focus.
import { Icon, type IconName } from "@/components/ui/Icon";
import sh from "./shell.module.css";

export type SideNavChild = { href: string; label: string; current: boolean; testId?: string };
export type SideNavItem = { href: string; label: string; icon: IconName; current: boolean; children: SideNavChild[] };

export function SideNav({ label, items, collapsed = false, onNavigate }: { label: string; items: SideNavItem[]; collapsed?: boolean; onNavigate?: (href: string) => void }) {
  return <nav aria-label={label} className={sh.nav}>{items.map(item => {
    const tree = item.children.length > 1, open = item.current && tree;
    return <div key={item.href} className={sh.navGroup} data-open={open ? "yes" : undefined}>
      <a href={item.href} className={sh.navLink} data-active={item.current ? "yes" : undefined} aria-current={item.current && !open ? "page" : undefined}
        title={collapsed ? item.label : undefined} onClick={() => onNavigate?.(item.href)}>
        <Icon name={item.icon}/><span className={sh.label}>{item.label}</span>{tree && <Icon name="chevronRight" size={14} className={sh.chevron}/>}
      </a>
      {open && <ul className={sh.subnav}>
        {collapsed && <li className={sh.subnavTitle} aria-hidden="true">{item.label}</li>}
        {item.children.map(c => <li key={c.href}><a href={c.href} className={sh.subLink} aria-current={c.current ? "page" : undefined} data-testid={c.testId} title={c.label} onClick={() => onNavigate?.(c.href)}>{c.label}</a></li>)}
      </ul>}
    </div>;
  })}</nav>;
}
