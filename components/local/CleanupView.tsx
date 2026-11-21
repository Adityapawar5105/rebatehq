"use client";
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { VaultStatus } from "@/lib/vault/protocol";
import type { FixKind, FixView, Scan } from "@/lib/cleanup/item-master";
import { fmt, msg, say, t, type MessageKey } from "@/lib/i18n";
import styles from "./vault.module.css";
import { DataGrid } from "@/components/ui/DataGrid";
import { Badge, Button, Card } from "@/components/ui/ui";
const KIND: Record<FixKind, MessageKey> = { merge_duplicates: "cleanup.mergeDuplicates", normalize_uom: "cleanup.unitSpelling", set_category: "cleanup.missingCategory" };
const skippedNote = (n: string) => n !== "0" ? " " + msg("cleanup.undoSkipped", { count: Number(n) }) : "";
/** Item master cleanup assistant: every one-click fix is audited and can be undone. */
export function CleanupView({ client, version, busy, operation, onStatus, setMessage }: { client: VaultClient; version: string; busy: boolean; operation: (f: () => Promise<void>) => Promise<void>; onStatus: (s: VaultStatus) => void; setMessage: (m: string) => void }) {
  const [scan, setScan] = useState<Scan | null>(null), [history, setHistory] = useState<FixView[]>([]), [note, setNote] = useState("");
  const [pick, setPick] = useState<Record<string, string>>({}), [cat, setCat] = useState<Record<string, string>>({}), [batch, setBatch] = useState<string[]>([]);
  const load = async () => { setScan(await client.call("cleanupScan", {})); setHistory(await client.call("cleanupHistory", {})); };
  useEffect(() => { let on = true; void Promise.all([client.call("cleanupScan", {}), client.call("cleanupHistory", {})]).then(([s, h]) => { if (on) { setScan(s); setHistory(h); } }).catch(() => { if (on) setNote(msg("cleanup.couldNotScanThe")); }); return () => { on = false; }; }, [client, version]);
  const apply = (kind: FixKind, key: string, target?: string | null) => void operation(async () => {
    const out = await client.call("cleanupApply", { kind, key, target: target ?? null });
    setScan(out.scan); setHistory(out.history); onStatus(out.status);
    setMessage(msg(out.finished ? "cleanup.appliedMessage" : "cleanup.appliedUnfinished", { fix: out.fix })); setNote(msg("cleanup.applied", { fix: out.fix }));
  });
  const mergeAll = () => void operation(async () => {
    const out = await client.call("cleanupMergeAll", {}); setScan(out.scan); setHistory(out.history); onStatus(out.status); setBatch(out.ids);
    const text = msg("cleanup.merged", { count: Number(out.merged) }) + (out.skipped !== "0" ? " " + msg("cleanup.mergeSkipped", { count: Number(out.skipped) }) : "") + (out.unfinished !== "0" ? " " + msg("cleanup.mergeUnfinished", { count: Number(out.unfinished) }) : "") + " " + msg("cleanup.undoWholeBatch");
    setMessage(text); setNote(text);
  });
  const undoBatch = () => void operation(async () => {
    const out = await client.call("cleanupUndoMany", { ids: batch }); setScan(out.scan); setHistory(out.history); onStatus(out.status); setBatch([]);
    const text = msg("cleanup.undid", { summary: out.summary, restored: Number(out.restored) }) + skippedNote(out.skipped); setMessage(text); setNote(text);
  });
  const undo = (id: string) => void operation(async () => {
    const out = await client.call("cleanupUndo", { id }); setScan(out.scan); setHistory(out.history); onStatus(out.status);
    setMessage(msg("cleanup.undoneMessage", { summary: out.summary, restored: Number(out.restored) }) + skippedNote(out.skipped)); setNote(msg("cleanup.fixUndone"));
  });
  if (!scan) return <Card aria-busy="true" title={t("cleanup.itemMasterCleanup2")}><p role="status">{say(note) || t("cleanup.scanningTheItemMaster")}</p></Card>;
  const none = !scan.duplicates.length && !scan.units.length && !scan.categories.length;
  return <Card headingId="cleanup-heading" data-testid="cleanup" title={t("cleanup.itemMasterCleanup")} description={t("cleanup.lookAlikeProductIds")}>
    <p role="status">{say(note)}</p>
    {none && <p data-testid="cleanup-clean"><strong>{t("cleanup.nothingToClean")}</strong>{" "}{t("cleanup.noDuplicateSkusOdd")}</p>}
    {scan.duplicates.length > 0 && <><h3>{t("cleanup.duplicateSkusExtra", { count: Number(scan.totals.duplicateProducts) })}</h3>
      {scan.duplicates.some(g => g.confidence === "certain") && <p><Button variant="primary" disabled={busy} onClick={mergeAll}>{t("cleanup.mergeAllCertainDuplicates")}</Button> <span className={styles.small}>{t("cleanup.onlyIdsThatDiffer")}</span></p>}
      {batch.length > 0 && <p><Button disabled={busy} onClick={undoBatch}>{t("cleanup.undoTheLastBatch", { count: batch.length })}</Button></p>}
      <DataGrid label={t("cleanup.duplicateSkus")} testId="cleanup-duplicates" rows={scan.duplicates} rowKey={g => g.key} columns={[
        { id: "ids", name: t("cleanup.productIds"), value: g => g.members.map(m => m.product).join(" · "), cell: g => <span className={styles.wrap} translate="no">{g.members.map(m => m.product).join(" · ")}</span> },
        { id: "lines", name: t("cleanup.invoiceLines"), type: "int", num: true, value: g => g.lines },
        { id: "keep", name: t("cleanup.keep"), value: g => g.canonical, cell: g => <span translate="no">{g.canonical}</span> },
        { id: "confidence", name: t("cleanup.confidence"), value: g => g.confidence === "certain" ? t("cleanup.sameIdApartFrom") : t("cleanup.differByPunctuationCheck") },
        { id: "fix", name: t("cleanup.fix3"), cell: g => <Button size="sm" disabled={busy} aria-label={t("cleanup.mergeLookAlikeIds", { count: g.members.length - 1, canonical: g.canonical })} onClick={() => apply("merge_duplicates", g.key)}>{t("cleanup.mergeInto", { canonical: g.canonical })}</Button> },
      ]}/></>}
    {scan.units.length > 0 && <><h3>{t("cleanup.unitOfMeasureProducts", { count: Number(scan.totals.unitProducts) })}</h3>
      <p className={styles.small}>{t("cleanup.spellingsOfOneUnit")}</p>
      <DataGrid label={t("cleanup.unitSpellings")} testId="cleanup-units" rows={scan.units} rowKey={u => u.from} columns={[
        { id: "from", name: t("cleanup.storedAs"), value: u => u.from, cell: u => <span translate="no">{u.from || <span translate="yes">{t("cleanup.blank2")}</span>}</span> },
        { id: "products", name: t("cleanup.products2"), type: "int", num: true, value: u => u.products },
        { id: "examples", name: t("cleanup.examples2"), value: u => u.examples.join(", "), cell: u => <span className={styles.wrap} translate="no">{u.examples.join(", ")}</span> },
        { id: "fix", name: t("cleanup.fix2"), cell: u => <>{u.kind === "spelling" && u.to ? <Button size="sm" disabled={busy} aria-label={t("cleanup.spellAs2", { from: u.from, to: u.to })} onClick={() => apply("normalize_uom", u.from)}>{t("cleanup.spellAs", { to: u.to })}</Button>
            : <><label className={styles.small}>{t("cleanup.unitFor")}{" "}{u.from || t("cleanup.blank")}<select value={pick[u.from] ?? ""} onChange={e => setPick({ ...pick, [u.from]: e.target.value })}><option value="">{t("cleanup.chooseAUnit")}</option>{scan.unitChoices.map(c => <option key={c}>{c}</option>)}</select></label>
              <Button size="sm" disabled={busy || !pick[u.from]} onClick={() => apply("normalize_uom", u.from, pick[u.from])}>{t("cleanup.use")}{" "}{pick[u.from] || "…"}</Button></>}</> },
      ]}/></>}
    {scan.categories.length > 0 && <><h3>{t("cleanup.missingCategoriesProducts", { count: Number(scan.totals.uncategorised) })}</h3>
      <p className={styles.small}>{t("cleanup.groupedByTheStart")}</p>
      <DataGrid label={t("cleanup.missingCategories")} testId="cleanup-categories" rows={scan.categories} rowKey={c => c.key} columns={[
        { id: "prefix", name: t("cleanup.idPrefix"), value: c => c.key, cell: c => <span translate="no">{c.key}</span> },
        { id: "products", name: t("cleanup.products"), type: "int", num: true, value: c => c.products },
        { id: "examples", name: t("cleanup.examples"), value: c => c.examples.join(", "), cell: c => <span className={styles.wrap} translate="no">{c.examples.join(", ")}</span> },
        { id: "suggestion", name: t("cleanup.suggestion"), value: c => c.suggestion ?? null, cell: c => c.suggestion ? t("cleanup.productsAgree", { suggestion: c.suggestion, count: Number(c.support) }) : t("cleanup.notEnoughEvidence") },
        { id: "fix", name: t("cleanup.fix"), cell: c => <>{c.suggestion && <Button size="sm" disabled={busy} aria-label={t("cleanup.setCategoryForPrefix", { suggestion: c.suggestion, key: c.key })} onClick={() => apply("set_category", c.key)}>{t("cleanup.set", { suggestion: c.suggestion })}</Button>}
            <label className={styles.small}>{t("cleanup.categoryFor", { key: c.key })}<input value={cat[c.key] ?? ""} maxLength={160} onChange={e => setCat({ ...cat, [c.key]: e.target.value })} /></label>
            <Button size="sm" disabled={busy || !(cat[c.key] ?? "").trim()} onClick={() => apply("set_category", c.key, cat[c.key])}>{t("cleanup.useMyCategory")}</Button></> },
      ]}/></>}
    {scan.truncated && <p className={styles.small}>{t("cleanup.showingTheLargestGroups")}</p>}
    <h3>{t("cleanup.fixHistory")}</h3>
    {!history.length ? <p className={styles.small}>{t("cleanup.noFixesAppliedYet")}</p> : <ul data-testid="cleanup-history">{history.map(h => <li key={h.id}>{t(KIND[h.kind])} · {say(h.summary)} · {t("cleanup.cells", { count: Number(h.cells) })} · {fmt.dateTime(h.appliedAt)}{" "}
      {h.undoneAt ? <Badge tone="info">{t("cleanup.undone", { undoneAt: fmt.date(h.undoneAt.slice(0, 10)) })}</Badge> : <Button size="sm" disabled={busy} aria-label={t("cleanup.undo2", { summary: say(h.summary) })} onClick={() => undo(h.id)}>{t("cleanup.undo")}</Button>}</li>)}</ul>}
  </Card>;
}
