import { requireAppPageContext } from "@/lib/context";
import { accountLinks } from "@/lib/account-nav";
import { VaultApp } from "@/components/local/VaultApp";
export const dynamic = "force-dynamic";
export default async function Home() {
  // Identity/workspace metadata only; no pricing or business-data query.
  const context = await requireAppPageContext();
  // The account pages this person's server role can open, listed under Settings in the sidebar (23 Nov 2026, A1).
  const account = accountLinks(context.role, process.env.NODE_ENV === "development" && process.env.DEV_IMPERSONATION_ENABLED === "true");
  return <VaultApp scope={{ userId: context.userId, tenantId: context.tenantId }} email={context.email} workspace={context.tenantName} relayEnabled={process.env.RELAY_ENABLED === "true"} account={account}/>;
}
