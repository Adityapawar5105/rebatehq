// Team and roles (25 Nov 2026): the workspace's members and open invitations, read by the server page and passed to the
// vault as props, so Settings › Team and roles can show one list of people without any new request from the vault page.
// Control-plane identity data only (sign-in email, workspace role, status, dates): no business data.
export type WorkspaceRole = "owner" | "manager" | "analyst" | "rep";
export type TeamMember = { userId: string; email: string; role: WorkspaceRole; status: string; joinedAt: string };
export type TeamInvite = { email: string; role: WorkspaceRole; expiresAt: string; sentAt: string };
export type TeamDirectory = { members: TeamMember[]; invites: TeamInvite[]; canInvite: boolean };

const WORKSPACE_ROLES: readonly string[] = ["owner", "manager", "analyst", "rep"];
const role = (v: unknown): WorkspaceRole => (WORKSPACE_ROLES.includes(String(v)) ? String(v) : "rep") as WorkspaceRole;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ""));

export function teamDirectory(members: Record<string, unknown>[], invites: Record<string, unknown>[], canInvite: boolean): TeamDirectory {
  return {
    members: members.map(m => ({ userId: String(m.user_id), email: String(m.email ?? ""), role: role(m.role), status: String(m.status ?? ""), joinedAt: iso(m.created_at) })),
    invites: invites.map(i => ({ email: String(i.email ?? ""), role: role(i.role), expiresAt: iso(i.expires_at), sentAt: iso(i.created_at) })),
    canInvite,
  };
}

/**
 * The workspace role a RebateHQ role needs, matching the signed-grid verifier (team sharing S2): the grid's Owner must be
 * a workspace owner, and a publisher (Owner, Pricing Owner, or the named Pricing Owner) a workspace owner or manager.
 * Returns the message key of the problem, or null when the pair is allowed.
 */
export function roleConflict(vaultRole: string, named: boolean, workspace: WorkspaceRole | null): "people.needsOwner" | "people.needsManager" | null {
  if (!workspace) return null;
  if (vaultRole === "owner" && workspace !== "owner") return "people.needsOwner";
  if ((vaultRole === "pricing_owner" || named) && workspace !== "owner" && workspace !== "manager") return "people.needsManager";
  return null;
}
