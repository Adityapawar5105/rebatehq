// The account pages listed under Settings in the one sidebar (23 Nov 2026, blueprint section 22, item 36, A1).
// They are server pages, so the server's own role decides which a person sees; the vault receives the list as props.
import { can, type Role } from "@/lib/permissions";
import type { MessageKey } from "@/lib/i18n/core";

export type AccountLink = { href: string; label: MessageKey };

export function accountLinks(role: string, devImpersonation = false): AccountLink[] {
  const r = role as Role;
  return [
    ...(can(r, "users.read") ? [{ href: "/account/users", label: "frame.usersInvitations" as const }] : []),
    { href: "/account/licence", label: "shell.licenceLink" },
    { href: "/account/workspace", label: "frame.workspaceSettings" },
    ...(can(r, "audit.read") ? [{ href: "/account/audit", label: "frame.auditLog" as const }] : []),
    ...(devImpersonation ? [{ href: "/account/dev", label: "frame.developmentImpersonation" as const }] : []),
  ];
}
