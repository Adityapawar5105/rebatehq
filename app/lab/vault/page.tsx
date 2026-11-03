import { notFound } from "next/navigation";
import { VaultApp } from "@/components/local/VaultApp";
export const dynamic = "force-dynamic";
export default function VaultLab() {
  if (process.env.VAULT_LAB_ENABLED !== "true") notFound();
  return <VaultApp scope={{ userId: "synthetic-lab-user", tenantId: "synthetic-lab-workspace" }} email="Synthetic local harness" workspace="Synthetic vault" lab/>;
}
