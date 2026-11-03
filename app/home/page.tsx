import { requireAppPageContext } from "@/lib/context";
import { VaultApp } from "@/components/local/VaultApp";
export const dynamic = "force-dynamic";
export default async function Home() {
  // Identity/workspace metadata only; no pricing or business-data query.
  const context = await requireAppPageContext();
  return <VaultApp scope={{ userId: context.userId, tenantId: context.tenantId }} email={context.email} workspace={context.tenantName}/>;
}
