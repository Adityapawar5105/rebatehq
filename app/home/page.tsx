import { databaseContext, requireAppPageContext } from "@/lib/context";
import { accountLinks } from "@/lib/account-nav";
import { can } from "@/lib/permissions";
import { withDatabase } from "@/lib/db";
import { teamDirectory } from "@/lib/team";
import { VaultApp } from "@/components/local/VaultApp";
export const dynamic = "force-dynamic";
export default async function Home() {
  // Identity/workspace metadata only; no pricing or business-data query.
  const context = await requireAppPageContext();
  // The account pages this person's server role can open, listed under Settings in the sidebar (23 Nov 2026, A1).
  const account = accountLinks(context.role, process.env.NODE_ENV === "development" && process.env.DEV_IMPERSONATION_ENABLED === "true");
  // Team and roles (25 Nov 2026): members and open invitations (control-plane identity data) for the people list, read
  // here so the vault page makes no extra request. Only for a server role that may read users, as on /account/users.
  const team = can(context.role, "users.read") ? await withDatabase(databaseContext(context), async db => teamDirectory(
    (await db.query("SELECT user_id,email,role,status,created_at FROM membership WHERE tenant_id=$1 ORDER BY created_at LIMIT 500", [context.tenantId])).rows,
    (await db.query("SELECT email,role,expires_at,created_at FROM invite WHERE tenant_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 200", [context.tenantId])).rows,
    context.role === "owner")) : null;
  return <VaultApp scope={{ userId: context.userId, tenantId: context.tenantId }} email={context.email} workspace={context.tenantName} relayEnabled={process.env.RELAY_ENABLED === "true"} account={account} team={team}/>;
}
