import { legacyBusinessEnabled } from "@/lib/legacy-gate";
import { notFound } from "next/navigation";
import { AppFrame } from "@/components/AppFrame";
import { QuoteForm } from "@/components/QuoteForm";
import { QuotesPanel } from "@/components/QuotesPanel";
import { requireAppPageContext } from "@/lib/context";
export const dynamic = "force-dynamic";
export default async function QuotingPage() {if (!legacyBusinessEnabled()) notFound();
  const context = await requireAppPageContext();
  return <AppFrame context={context}><div className="page-head"><div><h1>Quoting</h1><p>Create a quote with a server-recomputed margin guardrail.</p></div></div>
    <section className="app-card"><h2>Build a quote</h2><QuoteForm currency={context.currency} /></section>
    <section className="app-card"><h2>Recent quotes</h2><QuotesPanel role={context.role} currency={context.currency} /></section>
  </AppFrame>;
}
