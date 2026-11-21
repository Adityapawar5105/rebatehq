"use client";
import { useState } from "react";
import { Button, Notice } from "@/components/ui/ui";
import { useVaultQuery } from "./useVaultQuery";
import type { VaultClient } from "@/lib/vault/client";
import type { BasisId, CostBasisView as View } from "@/lib/cost/basis";
import { BASES, BASIS_LABEL, NO_CATEGORY } from "@/lib/cost/basis";
import { fmt, msg, say, t } from "@/lib/i18n";
import styles from "./vault.module.css";
import { DataGrid } from "@/components/ui/DataGrid";
const money = (c: string) => fmt.currency(c);
const groupName = (g: string) => g === NO_CATEGORY ? t("basis.noCategory") : g;
/** Cost basis selector: margin under invoice, last, average and replacement cost, side by side, per product group. */
export function CostBasisView({ client, version, busy, operation, canChoose }: { client: VaultClient; version: string; busy: boolean; operation: (f: () => Promise<void>) => Promise<void>; canChoose: boolean }) {
  // 9.5: the shared query hook; a failed load now says so and offers Retry instead of staying "comparing" forever.
  const query = useVaultQuery(() => client.call("costBasis", {}), [client, version], msg("basis.couldNotLoadCost")), view = query.data, setView = query.set;
  const [note, setNote] = useState("");
  if (!view) return <section className={styles.card} aria-busy={query.status === "loading"} data-testid="basis-loading" data-status={query.status}><h2>{t("basis.costBasis2")}</h2>
    {query.status === "failed" ? <Notice tone="warn" role="alert" actions={<Button size="sm" onClick={query.reload}>{t("common.retry")}</Button>}>{say(query.error)}</Notice> : <p role="status">{t("basis.comparingCostBases")}</p>}</section>;
  const choose = (group: string, basis: BasisId | null) => void operation(async () => { setView(await client.call("costBasisSet", { group, basis })); setNote(msg("basis.chosen", { group, basis: basis ? BASIS_LABEL[basis] : BASIS_LABEL.invoice })); });
  const cell = (c: { margin: string; rate: string; uncostedLines: string }) => <><strong>{money(c.margin)}</strong> · {fmt.percent(c.rate)}{c.uncostedLines !== "0" && <span className={styles.small}>{" "}{t("basis.linesUnknown", { count: Number(c.uncostedLines) })}</span>}</>;
  return <section className={styles.card} aria-labelledby="basis-heading" data-testid="cost-basis">
    <h2 id="basis-heading">{t("basis.costBasis")}</h2>
    <p>{t("basis.whichCostShouldMargins")}</p>
    <p className={styles.small}>{say(view.formula)}</p><p role="status">{say(note)}</p>
    {!view.groups.length ? <p>{t("basis.importSalesHistoryAnd")}</p> : <DataGrid label={t("basis.marginByCostBasis")} testId="cost-basis-grid" rows={view.groups} rowKey={g => g.group} columns={[
      { id: "group", name: t("basis.productGroup"), value: g => groupName(g.group), cell: g => <span translate="no">{groupName(g.group)}</span> },
      { id: "lines", name: t("basis.lines"), type: "int", num: true, value: g => g.lines },
      { id: "invoice", name: t("basis.invoiceCost"), type: "money", value: g => g.invoice.margin, cell: g => cell(g.invoice) },
      { id: "last", name: t("basis.lastCost"), type: "money", value: g => g.last.margin, cell: g => cell(g.last) },
      { id: "average", name: t("basis.averageCost"), type: "money", value: g => g.average.margin, cell: g => cell(g.average) },
      { id: "replacement", name: t("basis.replacementCost"), type: "money", value: g => g.replacement.margin, cell: g => cell(g.replacement) },
      { id: "use", name: t("basis.useForThisGroup"), type: "money", value: g => g.selectedMargin, cell: g => <><label className={styles.small}>{t("basis.costBasisFor", { group: groupName(g.group) })}<select disabled={busy || !canChoose} value={g.selected ?? ""} onChange={e => choose(g.group, (e.target.value || null) as BasisId | null)}><option value="">{t("basis.invoiceCostDefault")}</option>{BASES.map(b => <option key={b} value={b}>{say(BASIS_LABEL[b])}</option>)}</select></label>
          <span className={styles.small}>{" "}{t("basis.margin", { selectedMargin: money(g.selectedMargin), selectedRate: fmt.percent(g.selectedRate) })}</span></> },
    ]} footer={<tr data-header="true">{<td/>}<td>{t("basis.allGroups")}</td><td>{fmt.int(view.total.lines)}</td><td>{cell(view.total.invoice)}</td><td>{cell(view.total.last)}</td><td>{cell(view.total.average)}</td><td>{cell(view.total.replacement)}</td><td>{t("basis.withYourChoices")}{" "}<strong>{money(view.total.selectedMargin)}</strong> · {fmt.percent(view.total.selectedRate)}</td></tr>}/>}
    {view.truncated && <p className={styles.small}>{t("basis.showingThe200Largest")}</p>}
    <p className={styles.muted}>{t("basis.theMarginWaterfallLeak")}</p>
  </section>;
}
