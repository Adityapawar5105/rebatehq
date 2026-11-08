"use client";
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { BasisId, CostBasisView as View } from "@/lib/cost/basis";
import { BASES, BASIS_LABEL, NO_CATEGORY } from "@/lib/cost/basis";
import { fmt, msg, say, t } from "@/lib/i18n";
import styles from "./vault.module.css";
const money = (c: string) => fmt.currency(c);
const groupName = (g: string) => g === NO_CATEGORY ? t("basis.noCategory") : g;
/** Cost basis selector: margin under invoice, last, average and replacement cost, side by side, per product group. */
export function CostBasisView({ client, version, busy, operation, canChoose }: { client: VaultClient; version: string; busy: boolean; operation: (f: () => Promise<void>) => Promise<void>; canChoose: boolean }) {
  const [view, setView] = useState<View | null>(null), [note, setNote] = useState("");
  useEffect(() => { let on = true; void client.call("costBasis", {}).then(v => { if (on) setView(v); }).catch(() => { if (on) setNote(msg("basis.couldNotLoadCost")); }); return () => { on = false; }; }, [client, version]);
  if (!view) return <section className={styles.card} aria-busy="true"><h2>{t("basis.costBasis2")}</h2><p role="status">{say(note) || t("basis.comparingCostBases")}</p></section>;
  const choose = (group: string, basis: BasisId | null) => void operation(async () => { setView(await client.call("costBasisSet", { group, basis })); setNote(msg("basis.chosen", { group, basis: basis ? BASIS_LABEL[basis] : BASIS_LABEL.invoice })); });
  const cell = (c: { margin: string; rate: string; uncostedLines: string }) => <><strong>{money(c.margin)}</strong> · {fmt.percent(c.rate)}{c.uncostedLines !== "0" && <span className={styles.small}>{" "}{t("basis.linesUnknown", { count: Number(c.uncostedLines) })}</span>}</>;
  return <section className={styles.card} aria-labelledby="basis-heading" data-testid="cost-basis">
    <h2 id="basis-heading">{t("basis.costBasis")}</h2>
    <p>{t("basis.whichCostShouldMargins")}</p>
    <p className={styles.small}>{say(view.formula)}</p><p role="status">{say(note)}</p>
    {!view.groups.length ? <p>{t("basis.importSalesHistoryAnd")}</p> : <div className={styles.tableWrap}><table className={styles.table} aria-label={t("basis.marginByCostBasis")}><thead><tr><th scope="col">{t("basis.productGroup")}</th><th scope="col">{t("basis.lines")}</th><th scope="col">{t("basis.invoiceCost")}</th><th scope="col">{t("basis.lastCost")}</th><th scope="col">{t("basis.averageCost")}</th><th scope="col">{t("basis.replacementCost")}</th><th scope="col">{t("basis.useForThisGroup")}</th></tr></thead>
      <tbody>{view.groups.map(g => <tr key={g.group}><td translate="no">{groupName(g.group)}</td><td>{fmt.int(g.lines)}</td><td>{cell(g.invoice)}</td><td>{cell(g.last)}</td><td>{cell(g.average)}</td><td>{cell(g.replacement)}</td>
        <td><label className={styles.small}>{t("basis.costBasisFor", { group: groupName(g.group) })}<select disabled={busy || !canChoose} value={g.selected ?? ""} onChange={e => choose(g.group, (e.target.value || null) as BasisId | null)}><option value="">{t("basis.invoiceCostDefault")}</option>{BASES.map(b => <option key={b} value={b}>{say(BASIS_LABEL[b])}</option>)}</select></label>
          <span className={styles.small}>{" "}{t("basis.margin", { selectedMargin: money(g.selectedMargin), selectedRate: fmt.percent(g.selectedRate) })}</span></td></tr>)}
        <tr data-header="true"><td>{t("basis.allGroups")}</td><td>{fmt.int(view.total.lines)}</td><td>{cell(view.total.invoice)}</td><td>{cell(view.total.last)}</td><td>{cell(view.total.average)}</td><td>{cell(view.total.replacement)}</td><td>{t("basis.withYourChoices")}{" "}<strong>{money(view.total.selectedMargin)}</strong> · {fmt.percent(view.total.selectedRate)}</td></tr></tbody></table></div>}
    {view.truncated && <p className={styles.small}>{t("basis.showingThe200Largest")}</p>}
    <p className={styles.muted}>{t("basis.theMarginWaterfallLeak")}</p>
  </section>;
}
