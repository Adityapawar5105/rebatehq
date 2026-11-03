"use client";
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { VaultStatus } from "@/lib/vault/protocol";
import { DATE_FORMATS, ROLES, ROLE_LABELS, kindOf, type Role, type Settings } from "@/lib/studio/formats";
import type { FileView, SourceView, StudioState } from "@/lib/studio/studio";
import styles from "./vault.module.css";
type Props = { client: VaultClient; status: VaultStatus; busy: boolean; operation: (work: () => Promise<void>) => Promise<void>; onStatus: (status: VaultStatus) => void; setMessage: (message: string) => void };
const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.xlsb,.ods,.json,.xml";
const DELIMITER_LABELS: Record<string, string> = { ",": "Comma", ";": "Semicolon", "\t": "Tab", "|": "Pipe" };
const directory = { webkitdirectory: "", directory: "" } as Record<string, string>;
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
/** Collect files from dropped folders (Chrome/Edge). Entries must be read synchronously in the drop handler. */
async function droppedFiles(entries: FileSystemEntry[]) {
  const out: File[] = [];
  async function walk(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) { out.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))); return; }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) { const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject)); if (!batch.length) break; for (const e of batch) await walk(e); }
  }
  for (const entry of entries) await walk(entry);
  return out;
}
const statusText = (f: FileView) => f.loadable ? "Ready to load" : f.role && !f.missing.length ? "Convert only" : "Needs attention";

export function ImportStudio({ client, status, busy, operation, onStatus, setMessage }: Props) {
  const [studio, setStudio] = useState<StudioState | null>(null), [sources, setSources] = useState<SourceView[]>([]);
  const [open, setOpen] = useState<string | null>(null), [ack, setAck] = useState(false), [over, setOver] = useState(false);
  const [recipeName, setRecipeName] = useState(""), [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([client.call("studioState", {}), client.call("sources", {})]).then(([s, list]) => { if (active) { setStudio(s); setSources(list); } }).catch(() => undefined);
    return () => { active = false; };
  }, [client]);
  const refreshSources = async () => setSources(await client.call("sources", {}));
  async function add(files: File[], replaces: string | null = null) {
    const supported = files.filter(f => kindOf(f.name)), skipped = files.length - supported.length;
    if (!supported.length) { await operation(async () => { throw new Error("None of these files is a supported business data format (CSV, TSV, TXT, XLSX, XLSM, XLS, XLSB, ODS, JSON or XML)."); }); return; }
    await operation(async () => {
      const next = await client.call("studioAdd", { files: supported, replaces });
      setStudio(next); setAck(false); setOpen(next.files.at(-1)?.id ?? null);
      setMessage(`${supported.length} file(s) added for review. Nothing is uploaded.${skipped ? ` ${skipped} unsupported file(s) were ignored.` : ""}`);
    });
  }
  const update = (id: string, settings: Partial<Settings>, role?: Role | null) => operation(async () => { setStudio(await client.call("studioUpdate", { id, settings, ...(role !== undefined ? { role } : {}) })); setAck(false); });
  const files = studio?.files ?? [], report = studio?.report ?? null, current = files.find(f => f.id === open) ?? null;
  const canCommit = !!report && report.loaded !== "0" && report.capOk && (report.rejected === "0" || ack);
  return <>
    <section className={styles.card}>
      <h2>Import Studio</h2>
      <p>Drop the files you have: sales history, item master, customer list, vendor cost sheets, price lists or rebate agreements. They are converted to clean CSV in this browser and loaded into your encrypted vault. Nothing is uploaded.</p>
      <div className={styles.drop} data-over={over || undefined} onDragOver={event => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={event => { event.preventDefault(); setOver(false); if (busy) return; const entries = [...event.dataTransfer.items].map(i => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e); void (entries.length ? droppedFiles(entries) : Promise.resolve([...event.dataTransfer.files])).then(list => add(list)); }}>
        <p><strong>Drop files or a whole folder here</strong></p>
        <div className={styles.row} style={{ justifyContent: "center" }}>
          <label>Choose files<input data-testid="studio-files" type="file" multiple accept={ACCEPT} disabled={busy} onChange={event => { const list = [...(event.target.files ?? [])]; event.target.value = ""; void add(list); }}/></label>
          <label>Choose a folder<input data-testid="studio-folder" type="file" {...directory} disabled={busy} onChange={event => { const list = [...(event.target.files ?? [])]; event.target.value = ""; void add(list); }}/></label>
        </div>
        <p className={styles.muted}>CSV, TSV, TXT, XLSX, XLSM, XLS, XLSB, ODS, JSON and XML. Formulas are never calculated and macros never run. Spreadsheets up to 300,000 rows; use CSV for larger exports.</p>
      </div>
    </section>
    {files.length > 0 && <section className={styles.card} aria-labelledby="batch-heading">
      <h2 id="batch-heading">Files in this batch</h2>
      {files.some(f => f.replaces) && <p className={styles.warning}>This batch replaces an imported file. Its rows are removed and the new file's rows loaded in one step.</p>}
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th scope="col">File</th><th scope="col">Contains</th><th scope="col">Status</th><th scope="col">Rows (about)</th><th scope="col">Actions</th></tr></thead>
        <tbody>{files.map(f => <tr key={f.id}>
          <td className={styles.wrap}><strong>{f.name}</strong><br/><span className={styles.small}>{f.kind.toUpperCase()} · {Number(f.bytes).toLocaleString("en-US")} bytes</span></td>
          <td><select aria-label={`Role for ${f.name}`} value={f.role ?? ""} disabled={busy} onChange={event => void update(f.id, {}, (event.target.value || null) as Role | null)}><option value="">Choose…</option>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
            {f.role && <span className={styles.small}>Header match {Math.round(f.roleConfidence * 100)}%</span>}</td>
          <td><span className={`${styles.pill} ${f.loadable ? styles.ok : styles.bad}`}>{statusText(f)}</span></td>
          <td>{Number(f.estimatedRows).toLocaleString("en-US")}</td>
          <td><div className={styles.row}>
            <button className={styles.linkish} aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? "Hide preview" : "Preview and fix"}</button>
            <button className={styles.linkish} aria-label={`Download ${f.name} as CSV`} disabled={busy} onClick={() => void operation(async () => { const out = await client.call("studioDownload", { id: f.id }); save(out.blob, out.name); setMessage(`Converted ${f.name} to ${out.name}.`); })}>Download CSV</button>
            <button className={styles.linkish} aria-label={`Remove ${f.name} from batch`} disabled={busy} onClick={() => void operation(async () => { setStudio(await client.call("studioDrop", { id: f.id })); })}>Remove</button>
          </div></td>
        </tr>)}</tbody>
      </table></div>
      <div className={styles.row}>
        <button className={styles.primary} disabled={busy} onClick={() => void operation(async () => { const next = await client.call("studioPlan", {}); setStudio(next); setAck(false); setMessage("Batch reviewed. Check the report before importing."); })}>Review import</button>
        <button disabled={busy} onClick={() => void operation(async () => { const out = await client.call("studioZip", {}); save(out.blob, out.name); setMessage(`Downloaded ${files.length} converted CSV file(s) as ${out.name}.`); })}>Download all as ZIP</button>
        <button disabled={busy} onClick={() => void operation(async () => { setStudio(await client.call("studioClear", {})); setOpen(null); })}>Clear batch</button>
      </div>
    </section>}
    {current && <FilePanel file={current} busy={busy} studio={studio!} recipeName={recipeName} setRecipeName={setRecipeName} update={update}
      apply={recipeId => operation(async () => { setStudio(await client.call("recipeApply", { id: current.id, recipeId })); })}
      saveRecipe={() => operation(async () => { setStudio(await client.call("recipeSave", { id: current.id, name: recipeName })); setMessage(`Recipe "${recipeName.trim()}" saved in your vault.`); setRecipeName(""); })}/>}
    {report && <section className={styles.card} aria-labelledby="report-heading">
      <h2 id="report-heading">Batch report</h2>
      <p><strong>{Number(report.loaded).toLocaleString("en-US")}</strong> rows ready to load · <strong>{Number(report.rejected).toLocaleString("en-US")}</strong> rows rejected</p>
      {!report.capOk && <p role="alert" className={styles.error}>⚠ {report.capMessage}</p>}
      {report.warnings.map(w => <p key={w} className={styles.warning}>⚠ {w}</p>)}
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th scope="col">File</th><th scope="col">Role</th><th scope="col">Rows read</th><th scope="col">Loaded</th><th scope="col">Rejected</th><th scope="col">Skipped</th><th scope="col">Issues</th><th scope="col">Dates</th></tr></thead>
        <tbody>{report.files.map(r => <tr key={r.id}><td className={styles.wrap}>{r.name}</td><td>{ROLE_LABELS[r.role]}</td><td>{r.rowsRead}</td><td>{r.rowsLoaded}</td><td>{r.rowsRejected}</td><td>{r.rowsSkipped}</td><td>{r.issueCount}</td><td>{r.dateRange ? `${r.dateRange.from} to ${r.dateRange.to}` : "—"}</td></tr>)}</tbody>
      </table></div>
      <p className={styles.muted}>Skipped rows are blank, total, subtotal or page/footer lines. Rejected rows stay out of the vault; their locations are kept as open issues for the Fix Later queue.</p>
      {report.files.filter(r => r.issues.length).map(r => <details key={r.id} open={report.files.length === 1}>
        <summary>Issues in {r.name} ({r.issueCount})</summary>
        <ul className={styles.small}>{r.issues.map((i, n) => <li key={n}>Row {i.row}{i.column ? `, column ${i.column}` : ""}: {i.message}</li>)}</ul>
        {Number(r.issueCount) > r.issues.length && <p className={styles.small}>Showing the first {r.issues.length}. All are saved with the import.</p>}
      </details>)}
      {report.rejected !== "0" && report.loaded !== "0" && <label className={styles.row}><input type="checkbox" style={{ width: "auto" }} checked={ack} onChange={event => setAck(event.target.checked)}/> Load the {Number(report.loaded).toLocaleString("en-US")} valid rows; the {Number(report.rejected).toLocaleString("en-US")} rejected rows will not be loaded.</label>}
      {report.loaded === "0" && <p role="alert" className={styles.error}>⚠ No valid rows to load. Fix the issues listed and review again.</p>}
      <button className={styles.primary} disabled={busy || !canCommit || status.dirty} onClick={() => void operation(async () => {
        const out = await client.call("studioCommit", { acknowledge: ack }); onStatus(out.status); setStudio(out.studio); setAck(false); setOpen(null); await refreshSources();
        setMessage(`Imported ${Number(out.result.loaded).toLocaleString("en-US")} rows from ${out.result.files} file(s); audited and saved as an encrypted snapshot.${out.result.cleanup ? "" : " Some unused products or customers could not be tidied up; they are harmless."}`);
      })}>Confirm and import locally</button>
    </section>}
    <section className={styles.card} aria-labelledby="sources-heading">
      <h2 id="sources-heading">Imported files</h2>
      {!sources.length ? <p className={styles.muted}>No files imported yet.</p> : <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th scope="col">File</th><th scope="col">Role</th><th scope="col">Loaded</th><th scope="col">Rejected</th><th scope="col">Open issues</th><th scope="col">Imported</th><th scope="col">Actions</th></tr></thead>
        <tbody>{sources.map(s => <tr key={s.id}>
          <td className={styles.wrap}>{s.name}</td><td>{ROLE_LABELS[s.role as Role] ?? s.role}</td><td>{s.rowsLoaded}</td><td>{s.rowsRejected}</td><td>{s.issues}</td><td>{s.importedAt.slice(0, 16).replace("T", " ")}</td>
          <td><div className={styles.row}>
            <label className={styles.linkish}>Replace…<input type="file" aria-label={`Replace ${s.name}`} accept={ACCEPT} disabled={busy} style={{ display: "none" }} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void add([file], s.id); }}/></label>
            {removing === s.id
              ? <><button className={styles.linkish} disabled={busy} onClick={() => void operation(async () => { const out = await client.call("sourceRemove", { id: s.id }); onStatus(out.status); setRemoving(null); await refreshSources(); setMessage(`Removed ${s.name} and exactly its rows; audited and saved.`); })}>Confirm remove</button><button className={styles.linkish} onClick={() => setRemoving(null)}>Keep</button></>
              : <button className={styles.linkish} aria-label={`Remove imported ${s.name}`} disabled={busy} onClick={() => setRemoving(s.id)}>Remove</button>}
          </div></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </>;
}
function FilePanel({ file, busy, studio, recipeName, setRecipeName, update, apply, saveRecipe }: { file: FileView; busy: boolean; studio: StudioState; recipeName: string; setRecipeName: (v: string) => void; update: (id: string, settings: Partial<Settings>, role?: Role | null) => Promise<void>; apply: (recipeId: string) => Promise<void>; saveRecipe: () => Promise<void> }) {
  const s = file.settings, set = (patch: Partial<Settings>) => void update(file.id, patch);
  const width = Math.max(0, ...file.preview.map(r => r.cells.length));
  return <section className={styles.card} aria-labelledby="panel-heading">
    <h2 id="panel-heading">Preview and fix: {file.name}</h2>
    {file.reason && <p className={styles.warning}>⚠ {file.reason}</p>}
    {file.recipe && <p className={styles.notice}>A saved recipe matches these headers: <strong>{file.recipe.name}</strong>. <button disabled={busy} onClick={() => void apply(file.recipe!.id)}>Apply recipe</button></p>}
    {file.notices.map(n => <p key={n} className={styles.notice}>{n}</p>)}
    <div className={styles.grid}>
      {file.sheets.length > 1 && <label>Sheet<select value={s.sheet ?? ""} disabled={busy} onChange={e => set({ sheet: e.target.value })}>{file.sheets.map(n => <option key={n}>{n}</option>)}</select></label>}
      {!file.fixedLayout && <label>Header row<select value={s.headerRow} disabled={busy} onChange={e => set({ headerRow: Number(e.target.value) })}>{file.headerRowOptions.map(o => <option key={o.index} value={o.index}>Row {o.row}</option>)}</select></label>}
      {!file.fixedLayout && <label>Header rows<select value={s.headerDepth} disabled={busy} onChange={e => set({ headerDepth: Number(e.target.value) as 1 | 2 | 3 })}><option value={1}>1 row</option><option value={2}>2 rows</option><option value={3}>3 rows</option></select></label>}
      {file.textFormat && <label>Delimiter<select value={s.delimiter} disabled={busy} onChange={e => set({ delimiter: e.target.value as Settings["delimiter"] })}>{Object.entries(DELIMITER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
      {file.textFormat && <label>Encoding<select value={s.encoding} disabled={busy} onChange={e => set({ encoding: e.target.value as Settings["encoding"] })}><option value="utf-8">UTF-8</option><option value="windows-1252">Windows-1252 (Western)</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label>}
      <label>Decimal symbol<select value={s.decimal} disabled={busy} onChange={e => set({ decimal: e.target.value as Settings["decimal"] })}><option value="dot">Dot (12.50)</option><option value="comma">Comma (12,50)</option></select></label>
      <label>Date format<select value={s.dateFormat} disabled={busy} onChange={e => set({ dateFormat: e.target.value as Settings["dateFormat"] })}>{DATE_FORMATS.map(d => <option key={d}>{d}</option>)}</select></label>
    </div>
    {file.mapped.length > 0 && <p className={styles.small}><strong>Aligned columns:</strong> {file.mapped.map(m => `${m.field} ← ${m.column} (${m.header})`).join(" · ")}</p>}
    {file.ignored.length > 0 && <p className={styles.small}><strong>Not used:</strong> {file.ignored.join(", ")}</p>}
    <div className={styles.tableWrap}><table className={styles.table} aria-label={`First rows of ${file.name}`}>
      <thead><tr><th scope="col">Row</th>{Array.from({ length: width }, (_, i) => <th key={i} scope="col">{file.columnLabels[i] ?? ""}</th>)}</tr></thead>
      <tbody>{file.preview.map(r => <tr key={r.row} data-header={r.row === file.headerRowNumber || undefined}><td>{r.row}{r.row === file.headerRowNumber ? " (header)" : ""}</td>{Array.from({ length: width }, (_, i) => <td key={i}>{r.cells[i] ?? ""}</td>)}</tr>)}</tbody>
    </table></div>
    {file.issues.length > 0 && <details><summary>Cells that need attention ({file.issues.length})</summary><ul className={styles.small}>{file.issues.map((i, n) => <li key={n}>Row {i.row}, column {i.column}: {i.message}</li>)}</ul></details>}
    <div className={styles.row}>
      <label>Recipe name (ERP or supplier)<input value={recipeName} maxLength={80} onChange={e => setRecipeName(e.target.value)} disabled={busy}/></label>
      <button disabled={busy || !recipeName.trim()} onClick={() => void saveRecipe()}>Save as recipe</button>
    </div>
    {studio.recipes.length > 0 && <p className={styles.small}>Saved recipes: {studio.recipes.map(r => r.name).join(", ")}</p>}
  </section>;
}
