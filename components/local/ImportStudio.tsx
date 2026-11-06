"use client";
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { VaultStatus } from "@/lib/vault/protocol";
import { DATE_FORMATS, ROLES, ROLE_LABELS, kindOf, type Role, type Settings } from "@/lib/studio/formats";
import type { FileView, SourceView, StudioState } from "@/lib/studio/studio";
import type { ErpProfile, FieldSource } from "@/lib/studio/mapper";
import type { FixGroup, FixRow } from "@/lib/studio/fixlater";
import type { Health } from "@/lib/studio/health";
import type { ReconSummary } from "@/lib/margin/aggregate";
import { PLAYGROUND_PREFIX, type PlaygroundManifest } from "@/lib/studio/playground";
import { fmt, msg, say, t, type MessageKey } from "@/lib/i18n";
import { Icon } from "@/components/ui/Icon";
import styles from "./vault.module.css";
type Props = { client: VaultClient; status: VaultStatus; busy: boolean; operation: (work: () => Promise<void>) => Promise<void>; onStatus: (status: VaultStatus) => void; setMessage: (message: string) => void };
const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.xlsb,.ods,.json,.xml";
const DELIMITER_LABELS: Record<string, MessageKey> = { ",": "studio.comma", ";": "studio.semicolon", "\t": "studio.tab", "|": "studio.pipe" };
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
const RECON_LEVEL: Record<ReconSummary["open"][number]["level"], MessageKey> = { invoice: "studio.level.invoice", customer_month: "studio.level.customerMonth", total: "studio.level.total" };
// The Playground's planted leaks are fixed test data (tests/fixtures/playground-manifest.json); only their display text is translated.
const PLANTED: Record<string, MessageKey> = { L1: "studio.planted.L1", L2: "studio.planted.L2", L3: "studio.planted.L3", L4: "studio.planted.L4", L5: "studio.planted.L5" };
const statusText = (f: FileView) => f.loadable ? t("studio.readyToLoad") : f.role && !f.missing.length ? t("studio.convertOnly") : t("studio.needsAttention");

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
  const [version, setVersion] = useState(0), bump = () => setVersion(v => v + 1);
  const shared = { client, busy, operation, onStatus, setMessage, version, bump };
  async function add(files: File[], replaces: string | null = null) {
    const supported = files.filter(f => kindOf(f.name)), skipped = files.length - supported.length;
    if (!supported.length) { await operation(async () => { throw new Error(msg("studio.noneOfTheseFiles")); }); return; }
    await operation(async () => {
      const next = await client.call("studioAdd", { files: supported, replaces });
      setStudio(next); setAck(false); setOpen(next.files.at(-1)?.id ?? null);
      setMessage(msg("studio.filesAdded", { count: supported.length }) + (skipped ? " " + msg("studio.filesIgnored", { count: skipped }) : ""));
    });
  }
  const update = (id: string, settings: Partial<Settings>, role?: Role | null) => operation(async () => { setStudio(await client.call("studioUpdate", { id, settings, ...(role !== undefined ? { role } : {}) })); setAck(false); });
  const files = studio?.files ?? [], report = studio?.report ?? null, current = files.find(f => f.id === open) ?? null;
  const canCommit = !!report && report.loaded !== "0" && report.capOk && (report.rejected === "0" || ack);
  return <>
    <section className={styles.card} aria-labelledby="studio-heading">
      <h2 id="studio-heading">{t("studio.importStudio")}</h2>
      <p>{t("studio.dropTheFilesYou")}</p>
      <div className={styles.drop} data-over={over || undefined} onDragOver={event => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={event => { event.preventDefault(); setOver(false); if (busy) return; const entries = [...event.dataTransfer.items].map(i => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e); void (entries.length ? droppedFiles(entries) : Promise.resolve([...event.dataTransfer.files])).then(list => add(list)); }}>
        <span className={styles.dropIcon}><Icon name="upload" size={22}/></span>
        <p><strong>{t("studio.dropFilesOrA")}</strong></p>
        <div className={styles.row} style={{ justifyContent: "center" }}>
          <label>{t("studio.chooseFiles")}<input data-testid="studio-files" type="file" multiple accept={ACCEPT} disabled={busy} onChange={event => { const list = [...(event.target.files ?? [])]; event.target.value = ""; void add(list); }}/></label>
          <label>{t("studio.chooseAFolder")}<input data-testid="studio-folder" type="file" {...directory} disabled={busy} onChange={event => { const list = [...(event.target.files ?? [])]; event.target.value = ""; void add(list); }}/></label>
        </div>
        <p className={styles.muted}>{t("studio.csvTsvTxtXlsx")}</p>
      </div>
    </section>
    {files.length > 0 && <section className={styles.card} aria-labelledby="batch-heading">
      <h2 id="batch-heading">{t("studio.filesInThisBatch")}</h2>
      {files.some(f => f.replaces) && <p className={styles.warning}>{t("studio.thisBatchReplacesAn")}</p>}
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th scope="col">{t("studio.file4")}</th><th scope="col">{t("studio.contains")}</th><th scope="col">{t("studio.status")}</th><th scope="col">{t("studio.rowsAbout")}</th><th scope="col">{t("studio.actions3")}</th></tr></thead>
        <tbody>{files.map(f => <tr key={f.id}>
          <td className={styles.wrap}><strong translate="no">{f.name}</strong><br/><span className={styles.small}>{t("studio.fileKindBytes", { kind: f.kind.toUpperCase(), bytes: Number(f.bytes) })}</span></td>
          <td><select aria-label={t("studio.roleFor", { name: f.name })} value={f.role ?? ""} disabled={busy} onChange={event => void update(f.id, {}, (event.target.value || null) as Role | null)}><option value="">{t("studio.choose")}</option>{ROLES.map(r => <option key={r} value={r}>{say(ROLE_LABELS[r])}</option>)}</select>
            {f.role && <span className={styles.small}>{t("studio.headerMatch", { match: fmt.percent(Math.round(f.roleConfidence * 100)) })}</span>}</td>
          <td><span className={`${styles.pill} ${f.loadable ? styles.ok : styles.bad}`}>{statusText(f)}</span></td>
          <td>{fmt.int(f.estimatedRows)}</td>
          <td><div className={styles.row}>
            <button className={styles.linkish} aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? t("studio.hidePreview") : t("studio.previewAndFix2")}</button>
            <button className={styles.linkish} aria-label={t("studio.downloadAsCsv", { name: f.name })} disabled={busy} onClick={() => void operation(async () => { const out = await client.call("studioDownload", { id: f.id }); save(out.blob, out.name); setMessage(msg("studio.convertedTo", { name: f.name, name2: out.name })); })}>{t("studio.downloadCsv")}</button>
            <button className={styles.linkish} aria-label={t("studio.removeFromBatch", { name: f.name })} disabled={busy} onClick={() => void operation(async () => { setStudio(await client.call("studioDrop", { id: f.id })); })}>{t("studio.remove2")}</button>
          </div></td>
        </tr>)}</tbody>
      </table></div>
      <div className={styles.row}>
        <button className={styles.primary} disabled={busy} onClick={() => void operation(async () => { const next = await client.call("studioPlan", {}); setStudio(next); setAck(false); setMessage(msg("studio.batchReviewedCheckThe")); })}>{t("studio.reviewImport")}</button>
        <button disabled={busy} onClick={() => void operation(async () => { const out = await client.call("studioZip", {}); save(out.blob, out.name); setMessage(msg("studio.downloadedConvertedCsvFile", { count: files.length, name: out.name })); })}>{t("studio.downloadAllAsZip")}</button>
        <button disabled={busy} onClick={() => void operation(async () => { setStudio(await client.call("studioClear", {})); setOpen(null); })}>{t("studio.clearBatch")}</button>
      </div>
    </section>}
    {current && <FilePanel file={current} busy={busy} studio={studio!} recipeName={recipeName} setRecipeName={setRecipeName} update={update}
      patch={data => operation(async () => { setStudio(await client.call("studioUpdate", { id: current.id, ...data })); setAck(false); })}
      apply={recipeId => operation(async () => { setStudio(await client.call("recipeApply", { id: current.id, recipeId })); })}
      saveRecipe={() => operation(async () => { setStudio(await client.call("recipeSave", { id: current.id, name: recipeName })); setMessage(msg("studio.recipeSavedInYour", { recipeName: recipeName.trim() })); setRecipeName(""); })}/>}
    {report && <section className={styles.card} aria-labelledby="report-heading">
      <h2 id="report-heading">{t("studio.batchReport")}</h2>
      <p><strong>{fmt.int(report.loaded)}</strong>{" "}{t("studio.rowsReadyToLoad")}{" "}<strong>{fmt.int(report.rejected)}</strong>{" "}{t("studio.rowsRejected")}</p>
      {!report.capOk && <p role="alert" className={styles.error}>{t("common.warningMark", { text: say(report.capMessage) })}</p>}
      {report.warnings.map(w => <p key={w} className={styles.warning}>{t("common.warningMark", { text: say(w) })}</p>)}
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th scope="col">{t("studio.file3")}</th><th scope="col">{t("studio.role2")}</th><th scope="col">{t("studio.rowsRead")}</th><th scope="col">{t("studio.loaded2")}</th><th scope="col">{t("studio.rejected2")}</th><th scope="col">{t("studio.skipped")}</th><th scope="col">{t("studio.issues")}</th><th scope="col">{t("studio.dates")}</th></tr></thead>
        <tbody>{report.files.map(r => <tr key={r.id}><td className={styles.wrap} translate="no">{r.name}</td><td>{say(ROLE_LABELS[r.role])}</td><td>{fmt.int(r.rowsRead)}</td><td>{fmt.int(r.rowsLoaded)}</td><td>{fmt.int(r.rowsRejected)}</td><td>{fmt.int(r.rowsSkipped)}</td><td>{fmt.int(r.issueCount)}</td><td>{r.dateRange ? t("studio.to2", { from: fmt.date(r.dateRange.from), to: fmt.date(r.dateRange.to) }) : "—"}</td></tr>)}</tbody>
      </table></div>
      <p className={styles.muted}>{t("studio.skippedRowsAreBlank")}</p>
      {report.files.filter(r => r.cleaned.length).map(r => <p key={r.id} className={styles.small}><strong>{t("studio.cleanedIn", { name: r.name })}</strong> {r.cleaned.map(c => t("studio.cleanedNote", { field: c.field, note: say(c.note), count: Number(c.count) })).join(" · ")}</p>)}
      {report.files.filter(r => r.issues.length).map(r => <details key={r.id} open={report.files.length === 1}>
        <summary>{t("studio.issuesIn", { name: r.name, count: Number(r.issueCount) })}</summary>
        <ul className={styles.small}>{r.issues.map((i, n) => <li key={n}>{t(i.column ? "studio.issueAtCell" : "studio.issueAtRow", { row: Number(i.row), column: i.column, message: say(i.message) })}</li>)}</ul>
        {Number(r.issueCount) > r.issues.length && <p className={styles.small}>{t("studio.showingTheFirstAll", { count: r.issues.length })}</p>}
      </details>)}
      {report.rejected !== "0" && report.loaded !== "0" && <label className={styles.row}><input type="checkbox" style={{ width: "auto" }} checked={ack} onChange={event => setAck(event.target.checked)}/>{" "}{t("studio.ackRejected", { loaded: fmt.int(report.loaded), rejected: fmt.int(report.rejected) })}</label>}
      {report.loaded === "0" && <p role="alert" className={styles.error}>{t("studio.noValidRowsTo")}</p>}
      <button className={styles.primary} disabled={busy || !canCommit || status.dirty} onClick={() => void operation(async () => {
        const out = await client.call("studioCommit", { acknowledge: ack }); onStatus(out.status); setStudio(out.studio); setAck(false); setOpen(null); await refreshSources(); bump();
        setMessage(msg("studio.imported", { rows: fmt.int(out.result.loaded), count: Number(out.result.files) }) + (out.result.cleanup ? "" : " " + msg("studio.cleanupHarmless")));
      })}>{t("studio.confirmAndImportLocally")}</button>
    </section>}
    <FixLater {...shared} onSources={refreshSources}/>
    <Reconciliation {...shared}/>
    <HealthCard {...shared}/>
    <Playground {...shared} sources={sources} onSources={refreshSources}/>
    <section className={styles.card} aria-labelledby="sources-heading">
      <h2 id="sources-heading">{t("studio.importedFiles")}</h2>
      {!sources.length ? <p className={styles.muted}>{t("studio.noFilesImportedYet")}</p> : <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th scope="col">{t("studio.file2")}</th><th scope="col">{t("studio.role")}</th><th scope="col">{t("studio.loaded")}</th><th scope="col">{t("studio.rejected")}</th><th scope="col">{t("studio.openIssues")}</th><th scope="col">{t("studio.imported2")}</th><th scope="col">{t("studio.actions2")}</th></tr></thead>
        <tbody>{sources.map(s => <tr key={s.id}>
          <td className={styles.wrap} translate="no">{s.name}</td><td>{ROLE_LABELS[s.role as Role] ? say(ROLE_LABELS[s.role as Role]) : s.role}</td><td>{fmt.int(s.rowsLoaded)}</td><td>{fmt.int(s.rowsRejected)}</td><td>{fmt.int(s.issues)}</td><td>{fmt.dateTime(s.importedAt)}</td>
          <td><div className={styles.row}>
            <label className={styles.linkish}>{t("studio.replace2")}<input type="file" aria-label={t("studio.replace", { name: s.name })} accept={ACCEPT} disabled={busy} style={{ display: "none" }} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void add([file], s.id); }}/></label>
            {removing === s.id
              ? <><button className={styles.linkish} disabled={busy} onClick={() => void operation(async () => { const out = await client.call("sourceRemove", { id: s.id }); onStatus(out.status); setRemoving(null); await refreshSources(); bump(); setMessage(msg("studio.removedAndExactlyIts", { name: s.name })); })}>{t("studio.confirmRemove")}</button><button className={styles.linkish} onClick={() => setRemoving(null)}>{t("studio.keep")}</button></>
              : <button className={styles.linkish} aria-label={t("studio.removeImported", { name: s.name })} disabled={busy} onClick={() => setRemoving(s.id)}>{t("studio.remove")}</button>}
          </div></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </>;
}
type Patch = { erp?: ErpProfile; field?: { name: string; source: FieldSource }; confirmed?: boolean; range?: { from: string | null; to: string | null } };
const sourceValue = (s: FieldSource) => s.kind === "column" || s.kind === "unit" || s.kind === "percent" || s.kind === "fraction" ? `${s.kind}:${s.index}` : s.kind === "generate" ? `generate:${s.lineNo ?? ""}` : s.kind;
function parseSource(v: string): FieldSource {
  const [kind, rest] = v.split(":");
  if (kind === "column" || kind === "unit" || kind === "percent" || kind === "fraction") return { kind, index: Number(rest) };
  if (kind === "generate") return { kind, lineNo: rest === "" ? null : Number(rest) };
  return { kind: kind as "zero" | "none" | "header" | "item_cost" };
}
/** Column mapping: one source per canonical field, with confidence and the reason it was suggested. */
function MappingEditor({ file, busy, patch }: { file: FileView; busy: boolean; patch: (data: Patch) => Promise<void> }) {
  // Show the tick at once; the worker's reply (file.confirmed) wins once it arrives, e.g. after a failed save.
  const [confirmed, setConfirmed] = useState(file.confirmed);
  useEffect(() => { setConfirmed(file.confirmed); }, [file.confirmed, file.id]);
  const erp = file.erpOptions.find(o => o.id === file.erp);
  const columns = file.headers.map((h, i) => ({ i, label: `${file.columnLabels[i] && !file.fixedLayout ? file.columnLabels[i] + " · " : ""}${h}` }));
  return <div>
    <h3>{t("studio.columnMapping")}</h3>
    <div className={styles.grid}>
      <label>{t("studio.erpProfile")}<select value={file.erp} disabled={busy} onChange={e => void patch({ erp: e.target.value as ErpProfile })}>{file.erpOptions.map(o => <option key={o.id} value={o.id}>{say(o.label)}</option>)}</select></label>
    </div>
    {erp && <p className={styles.small}>{say(erp.note)}</p>}
    <div className={styles.tableWrap}><table className={styles.table} aria-label={t("studio.columnMappingFor", { name: file.name })}>
      <thead><tr><th scope="col">{t("studio.rebatehqField")}</th><th scope="col">{t("studio.comesFrom")}</th><th scope="col">{t("studio.match")}</th><th scope="col">{t("studio.why")}</th></tr></thead>
      <tbody>{file.fields.map(m => <tr key={m.field}>
        <td><span translate="no">{m.field}</span>{m.required ? t("studio.required") : ""}</td>
        <td><select aria-label={t("studio.sourceFor", { field: m.field })} value={sourceValue(m.source)} disabled={busy} onChange={e => void patch({ field: { name: m.field, source: parseSource(e.target.value) } })}>
          {(!m.required || m.source.kind === "none") && <option value="none">{m.options.includes("none") ? t("studio.notInFileLeave") : m.required ? t("studio.chooseAColumn") : t("studio.notInFile")}</option>}
          {m.options.includes("zero") && <option value="zero">{t("studio.notInFileUse")}</option>}
          {m.options.includes("header") && <option value="header">{t(m.field === "freight_amount" ? "studio.fromHeaderSpread" : "studio.fromHeader")}</option>}
          {m.options.includes("item_cost") && <option value="item_cost">{t("studio.notInFileQuantity")}</option>}
          {m.options.includes("generate") && <option value={m.source.kind === "generate" ? sourceValue(m.source) : "generate:"}>{t(m.source.kind === "generate" && m.source.lineNo !== null ? "studio.generateFromInvoiceAndLine" : "studio.generateFromInvoiceNumber")}</option>}
          {columns.map(c => <option key={`c${c.i}`} value={`column:${c.i}`}>{c.label}</option>)}
          {m.options.includes("unit") && columns.map(c => <option key={`u${c.i}`} value={`unit:${c.i}`}>{t("studio.quantity", { label: c.label })}</option>)}
          {m.options.includes("percent") && columns.map(c => <option key={`p${c.i}`} value={`percent:${c.i}`}>{t("studio.asOfList30", { label: c.label })}</option>)}
          {m.options.includes("fraction") && columns.map(c => <option key={`f${c.i}`} value={`fraction:${c.i}`}>{t("studio.asShareOfList", { label: c.label })}</option>)}
        </select></td>
        <td><span className={`${styles.pill} ${m.confidence >= 0.9 ? styles.ok : styles.bad}`}>{m.source.kind === "none" && m.required ? t("studio.missing") : fmt.percent(Math.round(m.confidence * 100))}</span></td>
        <td className={styles.wrap}>{say(m.reason)}</td>
      </tr>)}</tbody>
    </table></div>
    {file.needsConfirmation && <label className={styles.row}><input type="checkbox" style={{ width: "auto" }} checked={confirmed} disabled={busy || file.missing.length > 0} onChange={e => { setConfirmed(e.target.checked); void patch({ confirmed: e.target.checked }); }}/>{" "}{t("studio.iCheckedThisMapping")}{file.missing.length ? t("studio.mapFirst", { missing: file.missing.join(", ") }) : ""}</label>}
  </div>;
}
function FilePanel({ file, busy, studio, recipeName, setRecipeName, update, patch, apply, saveRecipe }: { file: FileView; busy: boolean; studio: StudioState; recipeName: string; setRecipeName: (v: string) => void; update: (id: string, settings: Partial<Settings>, role?: Role | null) => Promise<void>; patch: (data: Patch) => Promise<void>; apply: (recipeId: string) => Promise<void>; saveRecipe: () => Promise<void> }) {
  const s = file.settings, set = (patch: Partial<Settings>) => void update(file.id, patch);
  const width = Math.max(0, ...file.preview.map(r => r.cells.length));
  return <section className={styles.card} aria-labelledby="panel-heading">
    <h2 id="panel-heading">{t("studio.previewAndFix", { name: file.name })}</h2>
    {file.reason && <p className={styles.warning}>{t("common.warningMark", { text: say(file.reason) })}</p>}
    {file.recipe && <p className={styles.notice}>{t("studio.aSavedRecipeMatches")}{" "}<strong translate="no">{file.recipe.name}</strong>{t("roles.sentenceEnd")} <button disabled={busy} onClick={() => void apply(file.recipe!.id)}>{t("studio.applyRecipe")}</button></p>}
    {file.notices.map(n => <p key={n} className={styles.notice}>{say(n)}</p>)}
    <div className={styles.grid}>
      {file.sheets.length > 1 && <label>{t("studio.sheet")}<select value={s.sheet ?? ""} disabled={busy} onChange={e => set({ sheet: e.target.value })}>{file.sheets.map(n => <option key={n} translate="no">{n}</option>)}</select></label>}
      {!file.fixedLayout && <label>{t("studio.headerRow")}<select value={s.headerRow} disabled={busy} onChange={e => set({ headerRow: Number(e.target.value) })}><option value={-1}>{t("studio.noHeaderRow")}</option>{file.headerRowOptions.map(o => <option key={o.index} value={o.index}>{t("studio.row3", { row: Number(o.row) })}</option>)}</select></label>}
      {!file.fixedLayout && <label>{t("studio.headerRows")}<select value={s.headerDepth} disabled={busy} onChange={e => set({ headerDepth: Number(e.target.value) as 1 | 2 | 3 })}><option value={1}>{t("studio.1Row")}</option><option value={2}>{t("studio.2Rows")}</option><option value={3}>{t("studio.3Rows")}</option></select></label>}
      {file.textFormat && <label>{t("studio.delimiter")}<select value={s.delimiter} disabled={busy} onChange={e => set({ delimiter: e.target.value as Settings["delimiter"] })}>{Object.entries(DELIMITER_LABELS).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select></label>}
      {file.textFormat && <label>{t("studio.encoding")}<select value={s.encoding} disabled={busy} onChange={e => set({ encoding: e.target.value as Settings["encoding"] })}><option value="utf-8">UTF-8</option><option value="windows-1252">{t("studio.windows1252Western")}</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label>}
      <label>{t("studio.decimalSymbol")}<select value={s.decimal} disabled={busy} onChange={e => set({ decimal: e.target.value as Settings["decimal"] })}><option value="dot">{t("studio.dot1250")}</option><option value="comma">{t("studio.comma1250")}</option></select></label>
      <label>{t("studio.dateFormat")}<select value={s.dateFormat} disabled={busy} onChange={e => set({ dateFormat: e.target.value as Settings["dateFormat"] })}>{DATE_FORMATS.map(d => <option key={d}>{d}</option>)}</select></label>
    </div>
    {file.role === "sales_history" && <div className={styles.grid}>
      <label>{t("studio.importDatesFrom")}<input type="date" value={file.range.from ?? ""} disabled={busy} onChange={e => void patch({ range: { from: e.target.value || null, to: file.range.to } })}/></label>
      <label>{t("studio.to")}<input type="date" value={file.range.to ?? ""} disabled={busy} onChange={e => void patch({ range: { from: file.range.from, to: e.target.value || null } })}/></label>
    </div>}
    {file.role === "sales_history" && <p className={styles.small}>{t("studio.leaveTheDatesEmpty")}</p>}
    {file.fields.length > 0 && <MappingEditor file={file} busy={busy} patch={patch}/>}
    {file.ignored.length > 0 && <p className={styles.small}><strong>{t("studio.columnsNotUsed")}</strong> <span translate="no">{file.ignored.join(", ")}</span></p>}
    <div className={styles.tableWrap}><table className={styles.table} aria-label={t("studio.firstRowsOf", { name: file.name })}>
      <thead><tr><th scope="col">{t("studio.row2")}</th>{Array.from({ length: width }, (_, i) => <th key={i} scope="col" translate="no">{file.columnLabels[i] ?? ""}</th>)}</tr></thead>
      <tbody>{file.preview.map(r => <tr key={r.row} data-header={r.row === file.headerRowNumber || undefined}><td>{fmt.int(r.row)}{r.row === file.headerRowNumber ? t("studio.header") : ""}</td>{Array.from({ length: width }, (_, i) => <td key={i} translate="no">{r.cells[i] ?? ""}</td>)}</tr>)}</tbody>
    </table></div>
    {file.issues.length > 0 && <details><summary>{t("studio.cellsThatNeedAttention", { count: file.issues.length })}</summary><ul className={styles.small}>{file.issues.map((i, n) => <li key={n}>{t("studio.rowColumn", { row: Number(i.row), column: i.column, message: say(i.message) })}</li>)}</ul></details>}
    <div className={styles.row}>
      <label>{t("studio.recipeNameErpOr")}<input value={recipeName} maxLength={80} onChange={e => setRecipeName(e.target.value)} disabled={busy}/></label>
      <button disabled={busy || !recipeName.trim()} onClick={() => void saveRecipe()}>{t("studio.saveAsRecipe")}</button>
    </div>
    {studio.recipes.length > 0 && <p className={styles.small}>{t("studio.savedRecipes", { value: fmt.list(studio.recipes.map(r => r.name)) })}</p>}
  </section>;
}

type Shared = { client: VaultClient; busy: boolean; operation: (work: () => Promise<void>) => Promise<void>; onStatus: (status: VaultStatus) => void; setMessage: (message: string) => void; version: number; bump: () => void };
/** Fix Later: rejected rows grouped by file and problem; bulk-correct, re-check one group, or dismiss. */
function FixLater({ client, busy, operation, onStatus, setMessage, version, bump, onSources }: Shared & { onSources: () => Promise<void> }) {
  const [groups, setGroups] = useState<FixGroup[]>([]), [open, setOpen] = useState<string | null>(null), [rows, setRows] = useState<FixRow[]>([]), [value, setValue] = useState<Record<string, string>>({});
  useEffect(() => { let active = true; void client.call("fixGroups", {}).then(g => { if (active) setGroups(g); }).catch(() => undefined); return () => { active = false; }; }, [client, version]);
  const key = (g: FixGroup) => `${g.sourceId}|${g.code}`;
  async function show(g: FixGroup) { if (open === key(g)) { setOpen(null); return; } setRows(await client.call("fixRows", { sourceId: g.sourceId, code: g.code })); setOpen(key(g)); }
  if (!groups.length) return <section className={styles.card} aria-labelledby="fix-heading"><h2 id="fix-heading">{t("studio.fixLater2")}</h2><p className={styles.muted}>{t("studio.noRejectedRowsAre")}</p></section>;
  return <section className={styles.card} aria-labelledby="fix-heading">
    <h2 id="fix-heading">{t("studio.fixLater")}</h2>
    <p className={styles.muted}>{t("studio.rejectedRowsWaitHere")}</p>
    <div className={styles.tableWrap}><table className={styles.table}>
      <thead><tr><th scope="col">{t("studio.file")}</th><th scope="col">{t("studio.problem")}</th><th scope="col">{t("studio.rows")}</th><th scope="col">{t("studio.actions")}</th></tr></thead>
      <tbody>{groups.map(g => <tr key={key(g)}>
        <td className={styles.wrap} translate="no">{g.sourceName}</td><td className={styles.wrap}>{say(g.message)}</td><td>{fmt.int(g.count)}</td>
        <td><div className={styles.row}>
          <button className={styles.linkish} aria-expanded={open === key(g)} onClick={() => void operation(() => show(g))}>{open === key(g) ? t("studio.hideRows") : t("studio.showRows")}</button>
          {g.fixable && g.field && <><input aria-label={t("studio.newForAllRows", { field: g.field })} placeholder={t("studio.new", { field: g.field })} style={{ width: 160 }} value={value[key(g)] ?? ""} onChange={e => setValue({ ...value, [key(g)]: e.target.value })}/>
            <button className={styles.linkish} aria-label={t("studio.setForAllRows", { field: g.field })} disabled={busy || !(value[key(g)] ?? "").trim()} onClick={() => void operation(async () => { setGroups(await client.call("fixSet", { sourceId: g.sourceId, code: g.code, field: g.field!, value: value[key(g)] })); setMessage(msg("studio.setOnRowsRe", { field: g.field, count: Number(g.count) })); })}>{t("studio.setForAll")}</button></>}
          {g.fixable && <button className={styles.linkish} aria-label={g.code === "duplicate_row" ? t("studio.loadDuplicateRowsOf", { sourceName: g.sourceName }) : t("studio.reCheckAndLoad2", { value: g.field ?? g.code })} disabled={busy} onClick={() => void operation(async () => { const out = await client.call("fixRecheck", { sourceId: g.sourceId, code: g.code }); onStatus(out.status); setGroups(out.groups); setOpen(null); await onSources(); bump(); setMessage(msg("studio.reCheckedRowsLoaded", { loaded: Number(out.loaded), still: Number(out.stillRejected) })); })}>{g.code === "duplicate_row" ? t("studio.loadAnyway") : t("studio.reCheckAndLoad")}</button>}
          {g.credits && <button className={styles.linkish} aria-label={t("studio.loadNegativeQuantityRows", { sourceName: g.sourceName })} disabled={busy} onClick={() => void operation(async () => { const out = await client.call("creditsLoad", { sourceId: g.sourceId }); onStatus(out.status); setGroups(out.groups); setOpen(null); await onSources(); bump(); setMessage(msg("studio.loadedReturnsCreditsAs", { loaded: Number(out.loaded), still: Number(out.stillRejected) })); })}>{t("studio.loadAsReturnsAnd")}</button>}
          <button className={styles.linkish} aria-label={t("studio.dismissRows", { value: g.field ?? g.code })} disabled={busy} onClick={() => void operation(async () => { const out = await client.call("fixDismiss", { sourceId: g.sourceId, code: g.code }); onStatus(out.status); setGroups(out.groups); setOpen(null); bump(); setMessage(msg("studio.dismissedRowsTheyWill", { count: Number(g.count) })); })}>{t("studio.dismissAll")}</button>
        </div></td>
      </tr>)}</tbody>
    </table></div>
    {open && rows.length > 0 && <div className={styles.tableWrap}><table className={styles.table} aria-label={t("studio.rejectedRows")}>
      <thead><tr><th scope="col">{t("studio.row")}</th>{rows[0].values.map(v => <th key={v.field} scope="col" translate="no">{v.field}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.sourceRow}><td>{fmt.int(r.sourceRow)}</td>{r.values.map(v => <td key={v.field} translate="no">{v.value}</td>)}</tr>)}</tbody>
    </table></div>}
    {open && <p className={styles.small}>{t("studio.showingTheFirstRows", { count: rows.length })}</p>}
  </section>;
}
/** Reconciliation (4D): waterfall totals vs imported lines per invoice, customer x month and in total. Differences are listed, never adjusted. */
function Reconciliation({ client, busy, operation, onStatus, setMessage, version, bump }: Shared) {
  const [recon, setRecon] = useState<ReconSummary | null>(null);
  useEffect(() => { let active = true; void client.call("reconcile", {}).then(r => { if (active) setRecon(r); }).catch(() => undefined); return () => { active = false; }; }, [client, version]);
  if (!recon || recon.lines === "0") return null;
  return <section className={styles.card} aria-labelledby="recon-heading">
    <h2 id="recon-heading">{t("studio.reconciliation")}</h2>
    {recon.reconciled ? <p role="status" data-testid="recon-ok">{t("studio.reconciled", { invoices: fmt.int(recon.invoices), months: fmt.int(recon.customerMonths) })}{recon.accepted !== "0" ? " " + t("studio.acceptedDifferenceSAre", { count: Number(recon.accepted) }) : ""}</p>
      : <><p className={styles.warning}>{t("studio.differenceSBetweenThe", { count: recon.open.length })}</p>
        <div className={styles.tableWrap}><table className={styles.table} aria-label={t("studio.reconciliationDifferences")}><thead><tr><th scope="col">{t("studio.level")}</th><th scope="col">{t("studio.difference")}</th><th scope="col">{t("studio.imported")}</th><th scope="col">{t("studio.waterfall")}</th><th scope="col">{t("studio.firstSourceRow")}</th><th scope="col"><span className={styles.srOnly}>{t("margin.col.actions")}</span></th></tr></thead>
          <tbody>{recon.open.map(i => <tr key={i.id}><td>{t(RECON_LEVEL[i.level])}</td><td className={styles.wrap}>{say(i.message)}</td><td>{i.imported === null ? t("common.none") : fmt.money(i.imported)}</td><td>{i.waterfall === null ? t("common.none") : fmt.money(i.waterfall)}</td><td>{i.sourceRow ? fmt.int(i.sourceRow) : ""}</td>
            <td><button className={styles.linkish} disabled={busy} aria-label={t("studio.acceptDifference", { scopeKey: i.scopeKey, component: i.component })} onClick={() => void operation(async () => { const out = await client.call("reconAccept", { id: i.id }); onStatus(out.status); setRecon(out.recon); bump(); setMessage(msg("studio.differenceAcceptedAndRecorded")); })}>{t("studio.accept")}</button></td></tr>)}</tbody></table></div>
        <button disabled={busy} onClick={() => void operation(async () => { const out = await client.call("reconAccept", { id: null }); onStatus(out.status); setRecon(out.recon); bump(); setMessage(msg("studio.allOpenDifferencesAccepted")); })}>{t("studio.acceptAllDifferences")}</button>{" "}
        <button disabled={busy} onClick={() => void operation(async () => { const out = await client.call("reconRebuild", {}); onStatus(out.status); setRecon(out.recon); bump(); setMessage(msg(out.recon.reconciled ? "studio.marginTotalsRebuiltFrom" : "studio.totalsRebuiltSomeDifferences")); })}>{t("studio.rebuildTotalsFromThe")}</button></>}
  </section>;
}
/** Data health: equal-weight components with their formula and the next step for each. */
function HealthCard({ client, version }: Shared) {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => { let active = true; void client.call("health", {}).then(h => { if (active) setHealth(h); }).catch(() => undefined); return () => { active = false; }; }, [client, version]);
  if (!health) return null;
  return <section className={styles.card} aria-labelledby="health-heading">
    <h2 id="health-heading">{health.score === null ? t("studio.dataHealth") : t("studio.dataHealthScore", { score: fmt.percent(health.score) })}</h2>
    <p className={styles.small}>{say(health.formula)}</p>
    <div className={styles.tableWrap}><table className={styles.table}>
      <thead><tr><th scope="col">{t("studio.check")}</th><th scope="col">{t("studio.score")}</th><th scope="col">{t("studio.whatWeFound")}</th><th scope="col">{t("studio.nextStep")}</th></tr></thead>
      <tbody>{health.components.map(c => <tr key={c.key}><td>{say(c.label)}</td><td>{c.score === null ? t("common.notApplicable") : fmt.percent(c.score)}</td><td className={styles.wrap}>{say(c.detail)}</td><td className={styles.wrap}>{say(c.step)}</td></tr>)}</tbody>
    </table></div>
    <p className={styles.small}>{t("studio.healthFooter", { below: fmt.int(health.linesBelowCost), waiting: fmt.int(health.openFixLater) })}</p>
  </section>;
}
/** Playground: fictional sample data with planted leaks, only in a vault without real files. */
function Playground({ client, busy, operation, onStatus, setMessage, bump, sources, onSources }: Shared & { sources: SourceView[]; onSources: () => Promise<void> }) {
  const [manifest, setManifest] = useState<PlaygroundManifest | null>(null);
  const loaded = sources.some(s => s.name.startsWith(PLAYGROUND_PREFIX)), real = sources.some(s => !s.name.startsWith(PLAYGROUND_PREFIX));
  if (real && !loaded) return null;
  return <section className={styles.card} aria-labelledby="playground-heading">
    <h2 id="playground-heading">{t("studio.playground")}</h2>
    <p>{t("studio.aFictionalIndustrialValve")}</p>
    {!loaded ? <button className={styles.primary} disabled={busy} onClick={() => void operation(async () => { const out = await client.call("playgroundLoad", {}); onStatus(out.status); setManifest(out.manifest); await onSources(); bump(); setMessage(msg("studio.playgroundLoadedInvoiceLines", { lines: out.manifest.lines, count: out.manifest.leaks.length })); })}>{t("studio.loadThePlayground")}</button>
      : <button disabled={busy} onClick={() => void operation(async () => { const out = await client.call("playgroundRemove", {}); onStatus(out.status); setManifest(null); await onSources(); bump(); setMessage(msg("studio.removedPlaygroundFilesAnd", { count: Number(out.removed) })); })}>{t("studio.removePlaygroundData")}</button>}
    {manifest && <ul className={styles.small}>{manifest.leaks.map(l => <li key={l.id}>{t("studio.plantedLeak", { id: l.id, description: l.id in PLANTED ? t(PLANTED[l.id]) : l.description, count: l.lines, dollars: fmt.currency(String(Math.round(Number(l.dollars) * 100))) })}</li>)}</ul>}
  </section>;
}
