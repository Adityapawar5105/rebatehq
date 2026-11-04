"use client";
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { BasisId, CostBasisView as View } from "@/lib/cost/basis";
import { BASES, BASIS_LABEL } from "@/lib/cost/basis";
import { centsText } from "@/lib/margin/decimal";
import styles from "./vault.module.css";
const money = (c: string) => centsText(BigInt(c));
/** Cost basis selector: margin under invoice, last, average and replacement cost, side by side, per product group. */
export function CostBasisView({ client, version, busy, operation, canChoose }: { client: VaultClient; version: string; busy: boolean; operation: (f: () => Promise<void>) => Promise<void>; canChoose: boolean }) {
  const [view, setView] = useState<View | null>(null), [note, setNote] = useState("");
  useEffect(() => { let on = true; void client.call("costBasis", {}).then(v => { if (on) setView(v); }).catch(() => { if (on) setNote("Could not load cost bases. Reopen Data Hub to retry."); }); return () => { on = false; }; }, [client, version]);
  if (!view) return <section className={styles.card} aria-busy="true"><h2>Cost basis</h2><p role="status">{note || "Comparing cost bases…"}</p></section>;
  const choose = (group: string, basis: BasisId | null) => void operation(async () => { setView(await client.call("costBasisSet", { group, basis })); setNote(`Cost basis for ${group}: ${basis ? BASIS_LABEL[basis] : "invoice cost"}.`); });
  const cell = (c: { margin: string; rate: string; uncostedLines: string }) => <><strong>{money(c.margin)}</strong> · {c.rate}{c.uncostedLines !== "0" && <span className={styles.small}> · {c.uncostedLines} lines unknown</span>}</>;
  return <section className={styles.card} aria-labelledby="basis-heading" data-testid="cost-basis">
    <h2 id="basis-heading">Cost basis</h2>
    <p>Which cost should margins use? Compare the same sales under each cost, then choose one per product group.</p>
    <p className={styles.small}>{view.formula}</p><p role="status">{note}</p>
    {!view.groups.length ? <p>Import sales history and costs to compare cost bases.</p> : <div className={styles.tableWrap}><table className={styles.table} aria-label="Margin by cost basis"><thead><tr><th>Product group</th><th>Lines</th><th>Invoice cost</th><th>Last cost</th><th>Average cost</th><th>Replacement cost</th><th>Use for this group</th></tr></thead>
      <tbody>{view.groups.map(g => <tr key={g.group}><td>{g.group}</td><td>{g.lines}</td><td>{cell(g.invoice)}</td><td>{cell(g.last)}</td><td>{cell(g.average)}</td><td>{cell(g.replacement)}</td>
        <td><label className={styles.small}>Cost basis for {g.group}<select disabled={busy || !canChoose} value={g.selected ?? ""} onChange={e => choose(g.group, (e.target.value || null) as BasisId | null)}><option value="">Invoice cost (default)</option>{BASES.map(b => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}</select></label>
          <span className={styles.small}> Margin: {money(g.selectedMargin)} · {g.selectedRate}</span></td></tr>)}
        <tr data-header="true"><td>All groups</td><td>{view.total.lines}</td><td>{cell(view.total.invoice)}</td><td>{cell(view.total.last)}</td><td>{cell(view.total.average)}</td><td>{cell(view.total.replacement)}</td><td>With your choices: <strong>{money(view.total.selectedMargin)}</strong> · {view.total.selectedRate}</td></tr></tbody></table></div>}
    {view.truncated && <p className={styles.small}>Showing the 200 largest product groups.</p>}
    <p className={styles.muted}>The margin waterfall, leak finder and reports keep using invoice cost, which reconciles to your ERP. Your choice here is recorded per group and used for the comparison above.</p>
  </section>;
}
