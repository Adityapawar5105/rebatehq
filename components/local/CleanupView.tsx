"use client";
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { VaultStatus } from "@/lib/vault/protocol";
import type { FixKind, FixView, Scan } from "@/lib/cleanup/item-master";
import styles from "./vault.module.css";
const KIND: Record<FixKind, string> = { merge_duplicates: "Merge duplicates", normalize_uom: "Unit spelling", set_category: "Missing category" };
/** Item master cleanup assistant: every one-click fix is audited and can be undone. */
export function CleanupView({ client, version, busy, operation, onStatus, setMessage }: { client: VaultClient; version: string; busy: boolean; operation: (f: () => Promise<void>) => Promise<void>; onStatus: (s: VaultStatus) => void; setMessage: (m: string) => void }) {
  const [scan, setScan] = useState<Scan | null>(null), [history, setHistory] = useState<FixView[]>([]), [note, setNote] = useState("");
  const [pick, setPick] = useState<Record<string, string>>({}), [cat, setCat] = useState<Record<string, string>>({});
  const load = async () => { setScan(await client.call("cleanupScan", {})); setHistory(await client.call("cleanupHistory", {})); };
  useEffect(() => { let on = true; void Promise.all([client.call("cleanupScan", {}), client.call("cleanupHistory", {})]).then(([s, h]) => { if (on) { setScan(s); setHistory(h); } }).catch(() => { if (on) setNote("Could not scan the item master. Reopen Data Hub to retry."); }); return () => { on = false; }; }, [client, version]);
  const apply = (kind: FixKind, key: string, target?: string | null) => void operation(async () => {
    const out = await client.call("cleanupApply", { kind, key, target: target ?? null });
    setScan(out.scan); setHistory(out.history); onStatus(out.status);
    setMessage(`${out.fix}.${out.finished ? "" : " The duplicate rows could not be removed yet; apply the merge again to finish."} You can undo it below.`); setNote(`Applied: ${out.fix}`);
  });
  const undo = (id: string) => void operation(async () => {
    const out = await client.call("cleanupUndo", { id }); setScan(out.scan); setHistory(out.history); onStatus(out.status);
    setMessage(`Undone: ${out.summary}. Restored ${out.restored}${out.skipped !== "0" ? `; left ${out.skipped} unchanged because they were edited since` : ""}.`); setNote("Fix undone.");
  });
  if (!scan) return <section className={styles.card} aria-busy="true"><h2>Item master cleanup</h2><p role="status">{note || "Scanning the item master…"}</p></section>;
  const none = !scan.duplicates.length && !scan.units.length && !scan.categories.length;
  return <section className={styles.card} aria-labelledby="cleanup-heading" data-testid="cleanup">
    <h2 id="cleanup-heading">Item master cleanup</h2>
    <p>Look-alike product IDs, unit spellings and missing categories. Each fix is one click, is recorded in the audit log, and can be undone. Invoice amounts are never changed.</p>
    <p role="status">{note}</p>
    {none && <p data-testid="cleanup-clean"><strong>✓ Nothing to clean.</strong> No duplicate SKUs, odd unit spellings or uncategorised products were found.</p>}
    {scan.duplicates.length > 0 && <><h3>Duplicate SKUs ({scan.totals.duplicateProducts} extra)</h3>
      <div className={styles.tableWrap}><table className={styles.table} aria-label="Duplicate SKUs"><thead><tr><th>Product IDs</th><th>Invoice lines</th><th>Keep</th><th>Confidence</th><th>Fix</th></tr></thead>
        <tbody>{scan.duplicates.map(g => <tr key={g.key}><td className={styles.wrap}>{g.members.map(m => m.product).join(" · ")}</td><td>{g.lines}</td><td>{g.canonical}</td>
          <td>{g.confidence === "certain" ? "✓ Same ID apart from case or spaces" : "⚠ Differ by punctuation: check"}</td>
          <td><button disabled={busy} aria-label={`Merge ${g.members.length - 1} look-alike IDs into ${g.canonical}`} onClick={() => apply("merge_duplicates", g.key)}>Merge into {g.canonical}</button></td></tr>)}</tbody></table></div></>}
    {scan.units.length > 0 && <><h3>Unit of measure ({scan.totals.unitProducts} products)</h3>
      <p className={styles.small}>Spellings of one unit are unified. A unit that is blank or unknown is never guessed: you choose it.</p>
      <div className={styles.tableWrap}><table className={styles.table} aria-label="Unit spellings"><thead><tr><th>Stored as</th><th>Products</th><th>Examples</th><th>Fix</th></tr></thead>
        <tbody>{scan.units.map(u => <tr key={u.from}><td>{u.from || "(blank)"}</td><td>{u.products}</td><td className={styles.wrap}>{u.examples.join(", ")}</td>
          <td>{u.kind === "spelling" && u.to ? <button disabled={busy} aria-label={`Spell ${u.from} as ${u.to}`} onClick={() => apply("normalize_uom", u.from)}>Spell as {u.to}</button>
            : <><label className={styles.small}>Unit for {u.from || "(blank)"}<select value={pick[u.from] ?? ""} onChange={e => setPick({ ...pick, [u.from]: e.target.value })}><option value="">Choose a unit</option>{scan.unitChoices.map(c => <option key={c}>{c}</option>)}</select></label>
              <button disabled={busy || !pick[u.from]} onClick={() => apply("normalize_uom", u.from, pick[u.from])}>Use {pick[u.from] || "…"}</button></>}</td></tr>)}</tbody></table></div></>}
    {scan.categories.length > 0 && <><h3>Missing categories ({scan.totals.uncategorised} products)</h3>
      <p className={styles.small}>Grouped by the start of the product ID. A category is suggested only when three or more categorised products with that prefix mostly agree.</p>
      <div className={styles.tableWrap}><table className={styles.table} aria-label="Missing categories"><thead><tr><th>ID prefix</th><th>Products</th><th>Examples</th><th>Suggestion</th><th>Fix</th></tr></thead>
        <tbody>{scan.categories.map(c => <tr key={c.key}><td>{c.key}</td><td>{c.products}</td><td className={styles.wrap}>{c.examples.join(", ")}</td><td>{c.suggestion ? `${c.suggestion} (${c.support} products agree)` : "Not enough evidence"}</td>
          <td>{c.suggestion && <button disabled={busy} aria-label={`Set category ${c.suggestion} for prefix ${c.key}`} onClick={() => apply("set_category", c.key)}>Set {c.suggestion}</button>}
            <label className={styles.small}>Category for {c.key}<input value={cat[c.key] ?? ""} maxLength={160} onChange={e => setCat({ ...cat, [c.key]: e.target.value })} /></label>
            <button disabled={busy || !(cat[c.key] ?? "").trim()} onClick={() => apply("set_category", c.key, cat[c.key])}>Use my category</button></td></tr>)}</tbody></table></div></>}
    {scan.truncated && <p className={styles.small}>Showing the largest groups. Apply fixes and scan again to see the rest.</p>}
    <h3>Fix history</h3>
    {!history.length ? <p className={styles.small}>No fixes applied yet.</p> : <ul data-testid="cleanup-history">{history.map(h => <li key={h.id}>{KIND[h.kind]} · {h.summary} · {h.cells} cells · {h.appliedAt.slice(0, 16).replace("T", " ")}{" "}
      {h.undoneAt ? <span className={styles.pill}>Undone {h.undoneAt.slice(0, 10)}</span> : <button disabled={busy} aria-label={`Undo: ${h.summary}`} onClick={() => undo(h.id)}>Undo</button>}</li>)}</ul>}
  </section>;
}
