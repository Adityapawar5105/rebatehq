import { legacyBusinessEnabled } from "@/lib/legacy-gate";
import { notFound } from "next/navigation";
import { AppFrame } from "@/components/AppFrame";
import { MarginPolicyForm } from "@/components/MarginPolicyForm";
import { requireAppPageContext } from "@/lib/context";
export const dynamic="force-dynamic";
export default async function PolicyPage(){if (!legacyBusinessEnabled()) notFound();const context=await requireAppPageContext();return <AppFrame context={context}><div className="page-head"><div><h1>Margin guardrails</h1><p>Set the thresholds the quote service applies on the server.</p></div></div><section className="app-card"><MarginPolicyForm/></section></AppFrame>}
