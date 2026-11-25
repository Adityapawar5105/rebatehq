"use client";
import { useEffect, useState } from "react";
import type { VaultStatus } from "@/lib/vault/protocol";
import { CURRENCIES } from '@/lib/vault/currency';
import { DATE_FORMATS, ROLES, ROLE_LABELS, kindOf, type Role, type Settings, type SettingsPatch } from "@/lib/studio/formats";
import { parseBoundaries } from "@/lib/studio/layout";
import { FolderReimport } from "./FolderReimport";
import type { FileView, SourceView, StudioState } from "@/lib/studio/studio";
import type { ErpProfile, FieldSource } from "@/lib/studio/mapper";
import type { FixGroup, FixRow } from "@/lib/studio/fixlater";
import type { Health } from "@/lib/studio/health";
import type { ReconSummary } from "@/lib/margin/aggregate";
import { PLAYGROUND_PREFIX, type PlaygroundManifest } from "@/lib/studio/playground";
import { fmt, msg, say, t, type MessageKey } from "@/lib/i18n";
import { Icon } from "@/components/ui/Icon";
import styles from "./vault.module.css";
import { DataGrid } from "@/components/ui/DataGrid";
import { Badge, ButtonLink, Card, Field, Notice, Button as UiButton } from "@/components/ui/ui";
import { VaultClientError, type VaultClient } from "@/lib/vault/client";
import type { Cap } from "@/lib/roles/access";
import { useSharedLock } from "./sharedLock";
import { scrollToHeading } from "./scroll";
type Props = { client: VaultClient; status: VaultStatus; caps?: Cap[]; busy: boolean; operation: (work: () => Promise<void>) => Promise<void>; onStatus: (status: VaultStatus) => void; setMessage: (message: string) => void };
const ACCEPT = ".csv,.tsv,.txt,.prn,.xlsx,.xlsm,.xls,.xlsb,.ods,.json,.xml,.parquet,.pdf";
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

export function ImportStudio({ part = "import", client, status, caps = [], busy, operation, onStatus, setMessage }: Props & { part?: "import" | "fix" }) {
  const [studio, setStudio] = useState<StudioState | null>(null), [sources, setSources] = useState<SourceView[]>([]);
  // S3c: on a receiving seat, an import that would overwrite shared rows (or the Playground) is disabled with the reason.
  const lock = useSharedLock(), importLock = lock("studioCommit", studio?.files.map(f => f.role) ?? []), playLock = lock("playgroundLoad");
  const [open, setOpen] = useState<string | null>(null), [ack, setAck] = useState(false), [over, setOver] = useState(false);
  const [recipeName, setRecipeName] = useState(""), [removing, setRemoving] = useState<string | null>(null), [losing, setLosing] = useState<{ products: string; customers: string } | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => void Promise.all([client.call("studioState", {}), client.call("sources", {})]).then(([s, list]) => { if (active) { setStudio(s); setSources(list); } }).catch(() => undefined);
    load();
    // Roadmap 15.1: a scheduled folder pickup added or imported files while this screen is open.
    window.addEventListener("vault-pickup", load);
    return () => { active = false; window.removeEventListener("vault-pickup", load); };
  }, [client]);
  const refreshSources = async () => setSources(await client.call("sources", {}));
  // The sample banner can remove the Playground from any screen: re-read the file list when the vault changes.
  useEffect(() => { void client.call("sources", {}).then(setSources).catch(() => undefined); }, [client, status.generation, status.lines]);
  // After an import, lead the user to the number (20 Nov 2026).
  const [after, setAfter] = useState<{ loaded: string; rejected: string } | null>(null);
  // 8.6: the name of a fully scanned PDF that could not be added, and whether other files in the same drop were held back with it.
  const [scanned, setScanned] = useState<{ name: string; others: boolean } | null>(null);
  const [version, setVersion] = useState(0), bump = () => setVersion(v => v + 1);
  const shared = { client, busy, operation, onStatus, setMessage, version, bump };
  async function add(files: File[], replaces: string | null = null) {
    const supported = files.filter(f => kindOf(f.name)), skipped = files.length - supported.length;
    if (!supported.length) { await operation(async () => { throw new Error(msg("studio.noneOfTheseFiles")); }); return; }
    setAfter(null); setScanned(null);
    await operation(async () => {
      let next: StudioState;
      try { next = await client.call("studioAdd", { files: supported, replaces }); }
      catch (error) {
        const pdf = error instanceof VaultClientError && error.code === "SCANNED_PDF" ? supported.find(x => error.message.startsWith(x.name + ": ")) : undefined;
        if (!pdf) throw error;
        setScanned({ name: pdf.name, others: supported.length > 1 }); return;
      }
      setStudio(next); setAck(false); setOpen(next.files.at(-1)?.id ?? null);
      setMessage(msg("studio.filesAdded", { count: supported.length }) + (skipped ? " " + msg("studio.filesIgnored", { count: skipped }) : ""));
    });
  }
  const update = (id: string, settings: SettingsPatch, role?: Role | null) => {
    const work = async () => { setStudio(await client.call("studioUpdate", { id, settings, ...(role !== undefined ? { role } : {}) })); setAck(false); };
    // Rate typing is cheap staging metadata. Do not disable/blur the input per
    // keystroke; the worker queue applies all edits before a subsequent review.
    return Object.keys(settings).length === 1 && settings.fxRate !== undefined
      ? work().catch(error => operation(async () => { throw error; })) : operation(work);
  };
  const files = studio?.files ?? [], report = studio?.report ?? null, current = files.find(f => f.id === open) ?? null;
  const canCommit = !!report && report.loaded !== "0" && report.capOk && ((report.rejected === "0" && !report.rebateTerms && !report.skippedPages) || ack);
  return <>
    {part === "fix" ? <>
      <FixLater {...shared} onSources={refreshSources}/>
      <Reconciliation {...shared}/>
      <HealthCard {...shared}/>
    </> : <>
    {after && <Notice tone="ok" data-testid="after-import" actions={caps.includes("cost") ? <>
      <ButtonLink size="sm" variant="primary" icon="coins" href="#home">{t("studio.after.seeLeak")}</ButtonLink>
      <ButtonLink size="sm" variant="ghost" icon="chart" href="#margin">{t("home.openMargin")}</ButtonLink>
    </> : <UiButton size="sm" onClick={() => { location.hash = "data-hub-fix"; scrollToHeading("fix-heading"); }}>{t("studio.after.reviewFix")}</UiButton>}>
      {t(after.rejected === "0" ? "studio.after.imported" : "studio.after.importedFix", { loaded: fmt.int(after.loaded), rejected: fmt.int(after.rejected) })}
    </Notice>}
    <Card headingId="studio-heading" title={t("studio.importStudio")}>
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
        <p className={styles.muted}>{t("layout.formats")}</p>
      </div>
      {scanned && <Notice tone="bad" role="alert" data-testid="scanned-pdf" title={t("studio.scanned.title", { name: scanned.name })}
        actions={<UiButton size="sm" onClick={() => setScanned(null)}>{t("studio.scanned.remove")}</UiButton>}>
        <p>{t("studio.scanned.body")}</p>
        <ul><li>{t("studio.scanned.option1")}</li><li>{t("studio.scanned.option2")}</li></ul>
        {scanned.others && <p>{t("studio.scanned.others")}</p>}
      </Notice>}
      {status.sample === "empty" && !files.length && <p className={styles.small} data-testid="studio-try-playground">{t("studio.noFileHandy")}{" "}
        <UiButton size="sm" variant="ghost" disabled={busy || !!playLock} title={playLock ?? undefined} onClick={() => void operation(async () => { const out = await client.call("playgroundLoad", {}); onStatus(out.status); await refreshSources(); bump(); setMessage(msg("studio.playgroundLoadedInvoiceLines", { lines: out.manifest.lines, count: out.manifest.leaks.length })); })}>{t("home.start.sampleButton")}</UiButton></p>}
      <FolderReimport client={client} busy={busy} operation={operation} setMessage={setMessage} onAdded={next => { setStudio(next); setAck(false); setOpen(next.files.at(-1)?.id ?? null); }}/>
    </Card>
    {files.length > 0 && <Card headingId="batch-heading" title={t("studio.filesInThisBatch")}>
      {files.some(f => f.replaces) && <Notice tone="warn">{t("studio.thisBatchReplacesAn")}</Notice>}
      <DataGrid label={t("studio.filesInThisBatch")} testId="studio-batch" rows={files} rowKey={f => f.id} columns={[
        { id: "file", name: t("studio.file4"), value: f => f.name, cell: f => <span className={styles.wrap}><strong translate="no">{f.name}</strong>{f.skippedPages > 0 && <> <Badge tone="warn" data-testid="pages-skipped">{t("studio.pagesSkipped", { count: f.skippedPages })}</Badge></>}<br/><span className={styles.small}>{t("studio.fileKindBytes", { kind: f.kind.toUpperCase(), bytes: Number(f.bytes) })}</span></span> },
        { id: "contains", name: t("studio.contains"), value: f => f.role ? say(ROLE_LABELS[f.role]) : null, cell: f => <><select aria-label={t("studio.roleFor", { name: f.name })} value={f.role ?? ""} disabled={busy} onChange={event => void update(f.id, {}, (event.target.value || null) as Role | null)}><option value="">{t("studio.choose")}</option>{ROLES.map(r => <option key={r} value={r}>{say(ROLE_LABELS[r])}</option>)}</select>
            {f.role && <span className={styles.small}>{t("studio.headerMatch", { match: fmt.percent(Math.round(f.roleConfidence * 100)) })}</span>}</> },
        { id: "status", name: t("studio.status"), value: f => statusText(f), cell: f => <Badge tone={f.loadable ? "ok" : "bad"}>{statusText(f)}</Badge> },
        { id: "rows", name: t("studio.rowsAbout"), type: "int", value: f => String(f.estimatedRows) },
        { id: "actions", name: t("studio.actions3"), cell: f => <div className={styles.row}>
            <UiButton size="sm" variant="ghost" aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? t("studio.hidePreview") : t("studio.previewAndFix2")}</UiButton>
            <UiButton size="sm" variant="ghost" aria-label={t("studio.downloadAsCsv", { name: f.name })} disabled={busy} onClick={() => void operation(async () => { const out = await client.call("studioDownload", { id: f.id }); save(out.blob, out.name); setMessage(msg("studio.convertedTo", { name: f.name, name2: out.name })); })}>{t("studio.downloadCsv")}</UiButton>
            <UiButton size="sm" variant="ghost" aria-label={t("studio.removeFromBatch", { name: f.name })} disabled={busy} onClick={() => void operation(async () => { setStudio(await client.call("studioDrop", { id: f.id })); })}>{t("studio.remove2")}</UiButton>
          </div> },
      ]}/>
      <div className={styles.row}>
        <UiButton variant="primary" disabled={busy || !!importLock} title={importLock ?? undefined} data-testid="studio-plan" onClick={() => void operation(async () => { const next = await client.call("studioPlan", {}); setStudio(next); setAck(false); setMessage(msg("studio.batchReviewedCheckThe")); })}>{t("studio.reviewImport")}</UiButton>
        <UiButton disabled={busy} onClick={() => void operation(async () => { const out = await client.call("studioZip", {}); save(out.blob, out.name); setMessage(msg("studio.downloadedConvertedCsvFile", { count: files.length, name: out.name })); })}>{t("studio.downloadAllAsZip")}</UiButton>
        <UiButton disabled={busy} onClick={() => void operation(async () => { setStudio(await client.call("studioClear", {})); setOpen(null); })}>{t("studio.clearBatch")}</UiButton>
      </div>
    </Card>}
    {current && <FilePanel currency={status.currency} file={current} busy={busy} studio={studio!} recipeName={recipeName} setRecipeName={setRecipeName} update={update}
      patch={data => operation(async () => { setStudio(await client.call("studioUpdate", { id: current.id, ...data })); setAck(false); })}
      apply={recipeId => operation(async () => { setStudio(await client.call("recipeApply", { id: current.id, recipeId })); })}
      saveRecipe={() => operation(async () => { setStudio(await client.call("recipeSave", { id: current.id, name: recipeName })); setMessage(msg("studio.recipeSavedInYour", { recipeName: recipeName.trim() })); setRecipeName(""); })}/>}
    {report && <Card headingId="report-heading" title={t("studio.batchReport")}>
      <p><strong>{fmt.int(report.loaded)}</strong>{" "}{t("studio.rowsReadyToLoad")}{" "}<strong>{fmt.int(report.rejected)}</strong>{" "}{t("studio.rowsRejected")}</p>
      {!report.capOk && <Notice tone="bad" role="alert">{say(report.capMessage)}</Notice>}
      {report.warnings.map(w => <Notice key={w} tone="warn">{say(w)}</Notice>)}
      <DataGrid label={t("studio.batchReport")} testId="studio-report" rows={report.files} rowKey={r => r.id} columns={[
        { id: "file", name: t("studio.file3"), value: r => r.name, cell: r => <span className={styles.wrap}><span translate="no">{r.name}</span><small>{t('fx.provenance',{source:r.fx.sourceCurrency,workspace:r.fx.workspaceCurrency,rate:fmt.decimal(r.fx.fxRate)})}</small></span> },
        { id: "role", name: t("studio.role2"), value: r => say(ROLE_LABELS[r.role]) },
        { id: "read", name: t("studio.rowsRead"), type: "int", value: r => String(r.rowsRead) },
        { id: "loaded", name: t("studio.loaded2"), type: "int", value: r => String(r.rowsLoaded) },
        { id: "rejected", name: t("studio.rejected2"), type: "int", value: r => String(r.rowsRejected) },
        { id: "skipped", name: t("studio.skipped"), type: "int", value: r => String(r.rowsSkipped) },
        { id: "issues", name: t("studio.issues"), type: "int", value: r => String(r.issueCount) },
        { id: "dates", name: t("studio.dates"), type: "date", value: r => r.dateRange ? r.dateRange.from : null, cell: r => r.dateRange ? t("studio.to2", { from: fmt.date(r.dateRange.from), to: fmt.date(r.dateRange.to) }) : "—" },
      ]}/>
      <p className={styles.muted}>{t("studio.skippedRowsAreBlank")}</p>
      {report.files.filter(r => r.cleaned.length).map(r => <p key={r.id} className={styles.small}><strong>{t("studio.cleanedIn", { name: r.name })}</strong> {r.cleaned.map(c => t("studio.cleanedNote", { field: c.field, note: say(c.note), count: Number(c.count) })).join(" · ")}</p>)}
      {report.files.filter(r => r.issues.length).map(r => <details key={r.id} open={report.files.length === 1}>
        <summary>{t("studio.issuesIn", { name: r.name, count: Number(r.issueCount) })}</summary>
        <ul className={styles.small}>{r.issues.map((i, n) => <li key={n}>{t(i.column ? "studio.issueAtCell" : "studio.issueAtRow", { row: Number(i.row), column: i.column, message: say(i.message) })}</li>)}</ul>
        {Number(r.issueCount) > r.issues.length && <p className={styles.small}>{t("studio.showingTheFirstAll", { count: r.issues.length })}</p>}
      </details>)}
      {(report.rejected !== "0" || report.rebateTerms || report.skippedPages) && report.loaded !== "0" && <label className={styles.row}><input type="checkbox" data-testid="studio-ack" style={{ width: "auto" }} checked={ack} onChange={event => setAck(event.target.checked)}/>{" "}<span>{report.rejected!=="0"&&<span>{t("studio.ackRejected", { loaded: fmt.int(report.loaded), rejected: fmt.int(report.rejected) })} </span>}{report.rebateTerms&&<span>{t("rebate.confirm")}</span>}{report.skippedPages&&<span> {t("studio.skippedPagesAck")}</span>}</span></label>}
      {report.loaded === "0" && <Notice tone="bad" role="alert">{t("studio.noValidRowsTo")}</Notice>}
      <UiButton variant="primary" disabled={busy || !canCommit || status.dirty || !!importLock} title={importLock ?? undefined} onClick={() => void operation(async () => {
        const out = await client.call("studioCommit", { acknowledge: ack }); onStatus(out.status); setStudio(out.studio); setAck(false); setOpen(null); await refreshSources(); bump();
        setAfter({ loaded: out.result.loaded, rejected: out.result.rejected }); window.scrollTo({ top: 0 });
        setMessage(msg("studio.imported", { rows: fmt.int(out.result.loaded), count: Number(out.result.files) }) + (out.result.cleanup ? "" : " " + msg("studio.cleanupHarmless")));
      })}>{t("studio.confirmAndImportLocally")}</UiButton>
    </Card>}
    <Playground {...shared} sources={sources} onSources={refreshSources}/>
    <Card headingId="sources-heading" title={t("studio.importedFiles")}>
      {!sources.length ? <p className={styles.muted}>{t("studio.noFilesImportedYet")}</p> : <DataGrid label={t("studio.importedFiles")} testId="studio-sources" rows={sources} rowKey={s => s.id} columns={[
        { id: "file", name: t("studio.file2"), value: s => s.name, cell: s => <span className={styles.wrap}><span translate="no">{s.name}</span><small>{t('fx.provenance',{source:s.sourceCurrency,workspace:s.workspaceCurrency,rate:fmt.decimal(s.fxRate)})}</small>{s.headerFx !== '[]' && <small>{t('fx.headerProvenance',{details:s.headerFx})}</small>}</span> },
        { id: "role", name: t("studio.role"), value: s => ROLE_LABELS[s.role as Role] ? say(ROLE_LABELS[s.role as Role]) : s.role },
        { id: "loaded", name: t("studio.loaded"), type: "int", value: s => String(s.rowsLoaded) },
        { id: "rejected", name: t("studio.rejected"), type: "int", value: s => String(s.rowsRejected) },
        { id: "issues", name: t("studio.openIssues"), type: "int", value: s => String(s.issues) },
        { id: "imported", name: t("studio.imported2"), type: "date", value: s => String(s.importedAt) },
        { id: "actions", name: t("studio.actions2"), cell: s => <div className={styles.row}>
            <label className={styles.linkish}>{t("studio.replace2")}<input type="file" aria-label={t("studio.replace", { name: s.name })} accept={ACCEPT} disabled={busy} style={{ display: "none" }} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void add([file], s.id); }}/></label>
            {removing === s.id
              ? <><UiButton size="sm" variant="ghost" disabled={busy} onClick={() => void operation(async () => { const out = await client.call("sourceRemove", { id: s.id }); onStatus(out.status); setRemoving(null); await refreshSources(); bump(); setMessage(msg("studio.removedAndExactlyIts", { name: s.name })); })}>{t("studio.confirmRemove")}</UiButton><UiButton size="sm" variant="ghost" onClick={() => setRemoving(null)}>{t("studio.keep")}</UiButton></>
              : <UiButton size="sm" variant="ghost" aria-label={t("studio.removeImported", { name: s.name })} disabled={busy} onClick={() => { setRemoving(s.id); setLosing(null); void client.call("sourceRemovePreview", { id: s.id }).then(setLosing).catch(() => setLosing(null)); }}>{t("studio.remove")}</UiButton>}
            {removing === s.id && losing && (losing.products !== "0" || losing.customers !== "0") && <Notice tone="warn" role="alert" data-testid="remove-notes-warning">{t("notes.removeWarning", { products: fmt.int(losing.products), customers: fmt.int(losing.customers) })}</Notice>}
          </div> },
      ]}/>}
    </Card>
  </>}
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
  // Say at a glance what is left before Review can succeed (20 Nov 2026).
  const required = file.fields.filter(m => m.required), unmatched = required.filter(m => m.source.kind === "none");
  return <div>
    <h3>{t("studio.columnMapping")}</h3>
    {required.length > 0 && <p className={styles.small} data-testid="studio-mapping-summary" data-unmatched={unmatched.length}>{unmatched.length ? t("studio.mapping.summary", { matched: required.length - unmatched.length, total: required.length }) : t("studio.mapping.allMatched")}
      {unmatched.length > 0 && <>{" "}{t("studio.mapping.unmatched")}{" "}{unmatched.map(m => <Badge key={m.field} tone="bad" translate="no">{m.field}</Badge>)}</>}</p>}
    <div className={styles.grid}>
      <Field label={t("studio.erpProfile")}><select value={file.erp} disabled={busy} onChange={e => void patch({ erp: e.target.value as ErpProfile })}>{file.erpOptions.map(o => <option key={o.id} value={o.id}>{say(o.label)}</option>)}</select></Field>
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
        <td><Badge tone={m.confidence >= 0.9 ? "ok" : "bad"}>{m.source.kind === "none" && m.required ? t("studio.missing") : fmt.percent(Math.round(m.confidence * 100))}</Badge></td>
        <td className={styles.wrap}>{say(m.reason)}</td>
      </tr>)}</tbody>
    </table></div>
    {file.needsConfirmation && <label className={styles.row}><input type="checkbox" style={{ width: "auto" }} checked={confirmed} disabled={busy || file.missing.length > 0} onChange={e => { setConfirmed(e.target.checked); void patch({ confirmed: e.target.checked }); }}/>{" "}{t("studio.iCheckedThisMapping")}{file.missing.length ? t("studio.mapFirst", { missing: file.missing.join(", ") }) : ""}</label>}
  </div>;
}
function FilePanel({ currency, file, busy, studio, recipeName, setRecipeName, update, patch, apply, saveRecipe }: { currency: string; file: FileView; busy: boolean; studio: StudioState; recipeName: string; setRecipeName: (v: string) => void; update: (id: string, settings: SettingsPatch, role?: Role | null) => Promise<void>; patch: (data: Patch) => Promise<void>; apply: (recipeId: string) => Promise<void>; saveRecipe: () => Promise<void> }) {
  const s = file.settings, set = (patch: SettingsPatch) => void update(file.id, patch);
  const [rate, setRate] = useState(s.fxRate ?? '1');
  // Ignore intermediate worker responses while typing. A new file/source resets the draft.
  useEffect(() => { setRate(s.fxRate ?? '1'); }, [file.id, s.sourceCurrency]);
  const width = Math.max(0, ...file.preview.map(r => r.cells.length));
  return <Card headingId="panel-heading" title={t("studio.previewAndFix", { name: file.name })}>
    {file.reason && <Notice tone="warn">{say(file.reason)}</Notice>}
    {file.recipe && <Notice actions={<UiButton size="sm" disabled={busy} onClick={() => void apply(file.recipe!.id)}>{t("studio.applyRecipe")}</UiButton>}>{t("studio.aSavedRecipeMatches")}{" "}<strong translate="no">{file.recipe.name}</strong>{t("roles.sentenceEnd")}</Notice>}
    {file.notices.map(n => <Notice key={n}>{say(n)}</Notice>)}
    <p>{t('fx.importHelp')}</p><p>{t('fx.rounding')}</p>
    <div className={styles.grid}>
      <Field label={t('fx.source')}><select value={s.sourceCurrency ?? 'USD'} disabled={busy} onChange={e => set({ sourceCurrency: e.target.value, fxRate: e.target.value === currency ? "1" : "" })}>{CURRENCIES.map(code => <option key={code}>{code}</option>)}</select></Field>
      <Field label={t('fx.rate')}><input inputMode="decimal" value={rate} disabled={busy} onChange={e => { setRate(e.target.value); set({ fxRate: e.target.value }); }}/></Field>
      {file.sheets.length > 1 && <Field label={t("studio.sheet")}><select value={s.sheet ?? ""} disabled={busy} onChange={e => set({ sheet: e.target.value })}>{file.sheets.map(n => <option key={n} translate="no">{n}</option>)}</select></Field>}
      {!file.fixedLayout && <Field label={t("studio.headerRow")}><select value={s.headerRow} disabled={busy} onChange={e => set({ headerRow: Number(e.target.value) })}><option value={-1}>{t("studio.noHeaderRow")}</option>{file.headerRowOptions.map(o => <option key={o.index} value={o.index}>{t("studio.row3", { row: Number(o.row) })}</option>)}</select></Field>}
      {!file.fixedLayout && <Field label={t("studio.headerRows")}><select value={s.headerDepth} disabled={busy} onChange={e => set({ headerDepth: Number(e.target.value) as 1 | 2 | 3 })}><option value={1}>{t("studio.1Row")}</option><option value={2}>{t("studio.2Rows")}</option><option value={3}>{t("studio.3Rows")}</option></select></Field>}
      {file.textFormat && <Field label={t("studio.delimiter")}><select value={s.delimiter} disabled={busy} onChange={e => set({ delimiter: e.target.value as Settings["delimiter"] })}>{Object.entries(DELIMITER_LABELS).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select></Field>}
      {file.textFormat && <Field label={t("studio.encoding")}><select value={s.encoding} disabled={busy} onChange={e => set({ encoding: e.target.value as Settings["encoding"] })}><option value="utf-8">UTF-8</option><option value="windows-1252">{t("studio.windows1252Western")}</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></Field>}
      {file.layout && file.layout.mode !== "pdf" && <Field label={t("layout.layout")}><select data-testid="studio-layout" value={file.layout.mode} disabled={busy} onChange={e => set({ layout: e.target.value as "delimited" | "fixed" })}><option value="delimited">{t("layout.delimited")}</option><option value="fixed">{t("layout.fixed")}</option></select></Field>}
      <Field label={t("studio.decimalSymbol")}><select value={s.decimal} disabled={busy} onChange={e => set({ decimal: e.target.value as Settings["decimal"] })}><option value="dot">{t("studio.dot1250")}</option><option value="comma">{t("studio.comma1250")}</option></select></Field>
      <Field label={t("studio.dateFormat")}><select value={s.dateFormat} disabled={busy} onChange={e => set({ dateFormat: e.target.value as Settings["dateFormat"] })}>{DATE_FORMATS.map(d => <option key={d}>{d}</option>)}</select></Field>
    </div>
    {file.layout && file.layout.mode !== "delimited" && <Boundaries key={file.id + file.layout.boundaries.join(",")} file={file} busy={busy} set={set}/>}
    {file.role === "sales_history" && <div className={styles.grid}>
      <Field label={t("studio.importDatesFrom")}><input type="date" value={file.range.from ?? ""} disabled={busy} onChange={e => void patch({ range: { from: e.target.value || null, to: file.range.to } })}/></Field>
      <Field label={t("studio.to")}><input type="date" value={file.range.to ?? ""} disabled={busy} onChange={e => void patch({ range: { from: file.range.from, to: e.target.value || null } })}/></Field>
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
      <Field label={t("studio.recipeNameErpOr")}><input value={recipeName} maxLength={80} onChange={e => setRecipeName(e.target.value)} disabled={busy}/></Field>
      <UiButton disabled={busy || !recipeName.trim()} onClick={() => void saveRecipe()}>{t("studio.saveAsRecipe")}</UiButton>
    </div>
    {studio.recipes.length > 0 && <p className={styles.small}>{t("studio.savedRecipes", { value: fmt.list(studio.recipes.map(r => r.name)) })}</p>}
  </Card>;
}

/** 7F-2: column boundaries of a fixed-width file or PDF table, with a ruler over the raw lines of a fixed-width file. */
function Boundaries({ file, busy, set }: { file: FileView; busy: boolean; set: (patch: SettingsPatch) => void }) {
  const layout = file.layout!, [text, setText] = useState(layout.boundaries.join(", ")), [error, setError] = useState("");
  const width = Math.min(240, Math.max(0, ...layout.raw.map(l => l.length)));
  const ruler = Array.from({ length: width }, (_, i) => i % 10 === 0 ? String(i / 10 % 10) : i % 5 === 0 ? "+" : "·").join("");
  const marks = Array.from({ length: width }, (_, i) => layout.boundaries.includes(i) ? "|" : " ").join("");
  return <div data-testid="studio-columns">
    <form className={styles.row} onSubmit={e => { e.preventDefault(); try { set({ boundaries: parseBoundaries(text) }); setError(""); } catch (x) { setError(x instanceof Error ? x.message : msg("common.operationFailed")); } }}>
      <Field label={t(layout.mode === "pdf" ? "layout.boundariesPdf" : "layout.boundaries")}><input data-testid="studio-boundaries" value={text} disabled={busy} onChange={e => setText(e.target.value)} inputMode="numeric" aria-describedby="boundaries-help"/></Field>
      <UiButton type="submit" disabled={busy} data-testid="studio-boundaries-apply">{t("layout.apply")}</UiButton>
      <UiButton type="button" disabled={busy} data-testid="studio-boundaries-detect" onClick={() => set({ boundaries: null })}>{t("layout.detect")}</UiButton>
    </form>
    <p id="boundaries-help" className={styles.small}>{t(layout.mode === "pdf" ? "layout.helpPdf" : "layout.help")}</p>
    {error && <Notice tone="bad" role="alert">{say(error)}</Notice>}
    {layout.raw.length > 0 && <div className={styles.tableWrap}><pre className={styles.ruler} aria-label={t("layout.rawLines")} translate="no">{[ruler, marks, ...layout.raw].join("\n")}</pre></div>}
  </div>;
}

type Shared = { client: VaultClient; busy: boolean; operation: (work: () => Promise<void>) => Promise<void>; onStatus: (status: VaultStatus) => void; setMessage: (message: string) => void; version: number; bump: () => void };
/** Fix Later: rejected rows grouped by file and problem; bulk-correct, re-check one group, or dismiss. */
function FixLater({ client, busy, operation, onStatus, setMessage, version, bump, onSources }: Shared & { onSources: () => Promise<void> }) {
  const [groups, setGroups] = useState<FixGroup[]>([]), [open, setOpen] = useState<string | null>(null), [rows, setRows] = useState<FixRow[]>([]), [value, setValue] = useState<Record<string, string>>({});
  useEffect(() => { let active = true; void client.call("fixGroups", {}).then(g => { if (active) setGroups(g); }).catch(() => undefined); return () => { active = false; }; }, [client, version]);
  const key = (g: FixGroup) => `${g.sourceId}|${g.code}`;
  async function show(g: FixGroup) { if (open === key(g)) { setOpen(null); return; } setRows(await client.call("fixRows", { sourceId: g.sourceId, code: g.code })); setOpen(key(g)); }
  if (!groups.length) return <Card headingId="fix-heading" title={t("studio.fixLater2")}><p className={styles.muted}>{t("studio.noRejectedRowsAre")}</p></Card>;
  return <Card headingId="fix-heading" title={t("studio.fixLater")}>
    <p className={styles.muted}>{t("studio.rejectedRowsWaitHere")}</p>
    <DataGrid label={t("studio.fixLater")} testId="fix-groups" rows={groups} rowKey={key} columns={[
      { id: "file", name: t("studio.file"), value: g => g.sourceName, cell: g => <span className={styles.wrap} translate="no">{g.sourceName}</span> },
      { id: "problem", name: t("studio.problem"), value: g => say(g.message), cell: g => <span className={styles.wrap}>{say(g.message)}</span> },
      { id: "rows", name: t("studio.rows"), type: "int", value: g => String(g.count) },
      { id: "actions", name: t("studio.actions"), cell: g => <div className={styles.row}>
          <UiButton size="sm" variant="ghost" aria-expanded={open === key(g)} onClick={() => void operation(() => show(g))}>{open === key(g) ? t("studio.hideRows") : t("studio.showRows")}</UiButton>
          {g.fixable && g.field && <><input aria-label={t("studio.newForAllRows", { field: g.field })} placeholder={t("studio.new", { field: g.field })} style={{ width: 160 }} value={value[key(g)] ?? ""} onChange={e => setValue({ ...value, [key(g)]: e.target.value })}/>
            <UiButton size="sm" variant="ghost" aria-label={t("studio.setForAllRows", { field: g.field })} disabled={busy || !(value[key(g)] ?? "").trim()} onClick={() => void operation(async () => { setGroups(await client.call("fixSet", { sourceId: g.sourceId, code: g.code, field: g.field!, value: value[key(g)] })); setMessage(msg("studio.setOnRowsRe", { field: g.field, count: Number(g.count) })); })}>{t("studio.setForAll")}</UiButton></>}
          {g.fixable && <UiButton size="sm" variant="ghost" aria-label={g.code === "duplicate_row" ? t("studio.loadDuplicateRowsOf", { sourceName: g.sourceName }) : t("studio.reCheckAndLoad2", { value: g.field ?? g.code })} disabled={busy} onClick={() => void operation(async () => { const out = await client.call("fixRecheck", { sourceId: g.sourceId, code: g.code }); onStatus(out.status); setGroups(out.groups); setOpen(null); await onSources(); bump(); setMessage(msg("studio.reCheckedRowsLoaded", { loaded: Number(out.loaded), still: Number(out.stillRejected) })); })}>{g.code === "duplicate_row" ? t("studio.loadAnyway") : t("studio.reCheckAndLoad")}</UiButton>}
          {g.credits && <UiButton size="sm" variant="ghost" aria-label={t("studio.loadNegativeQuantityRows", { sourceName: g.sourceName })} disabled={busy} onClick={() => void operation(async () => { const out = await client.call("creditsLoad", { sourceId: g.sourceId }); onStatus(out.status); setGroups(out.groups); setOpen(null); await onSources(); bump(); setMessage(msg("studio.loadedReturnsCreditsAs", { loaded: Number(out.loaded), still: Number(out.stillRejected) })); })}>{t("studio.loadAsReturnsAnd")}</UiButton>}
          <UiButton size="sm" variant="ghost" aria-label={t("studio.dismissRows", { value: g.field ?? g.code })} disabled={busy} onClick={() => void operation(async () => { const out = await client.call("fixDismiss", { sourceId: g.sourceId, code: g.code }); onStatus(out.status); setGroups(out.groups); setOpen(null); bump(); setMessage(msg("studio.dismissedRowsTheyWill", { count: Number(g.count) })); })}>{t("studio.dismissAll")}</UiButton>
        </div> },
    ]}/>
    {open && rows.length > 0 && <DataGrid label={t("studio.rejectedRows")} testId="fix-rows" rows={rows} rowKey={r => String(r.sourceRow)} columns={[
      { id: "row", name: t("studio.row"), type: "int", value: r => String(r.sourceRow) },
      ...rows[0].values.map((v, i) => ({ id: `v${i}`, name: v.field, value: (r: FixRow) => r.values[i]?.value ?? null, cell: (r: FixRow) => <span translate="no">{r.values[i]?.value}</span> })),
    ]}/>}
    {open && <p className={styles.small}>{t("studio.showingTheFirstRows", { count: rows.length })}</p>}
  </Card>;
}
/** Reconciliation (4D): waterfall totals vs imported lines per invoice, customer x month and in total. Differences are listed, never adjusted. */
function Reconciliation({ client, busy, operation, onStatus, setMessage, version, bump }: Shared) {
  const [recon, setRecon] = useState<ReconSummary | null>(null);
  useEffect(() => { let active = true; void client.call("reconcile", {}).then(r => { if (active) setRecon(r); }).catch(() => undefined); return () => { active = false; }; }, [client, version]);
  if (!recon || recon.lines === "0") return null;
  return <Card headingId="recon-heading" title={t("studio.reconciliation")}>
    {recon.reconciled ? <p role="status" data-testid="recon-ok">{t("studio.reconciled", { invoices: fmt.int(recon.invoices), months: fmt.int(recon.customerMonths) })}{recon.accepted !== "0" ? " " + t("studio.acceptedDifferenceSAre", { count: Number(recon.accepted) }) : ""}</p>
      : <><Notice tone="warn">{t("studio.differenceSBetweenThe", { count: recon.open.length })}</Notice>
        <DataGrid label={t("studio.reconciliationDifferences")} testId="recon-open" rows={recon.open} rowKey={i => i.id} columns={[
          { id: "level", name: t("studio.level"), value: i => t(RECON_LEVEL[i.level]) },
          { id: "difference", name: t("studio.difference"), value: i => say(i.message), cell: i => <span className={styles.wrap}>{say(i.message)}</span> },
          { id: "imported", name: t("rebate.expectedInput"), type: "money", value: i => i.imported, cell: i => i.imported === null ? t("common.none") : fmt.currency(i.imported) },
          { id: "waterfall", name: t("studio.waterfall"), type: "money", value: i => i.waterfall, cell: i => i.waterfall === null ? t("common.none") : fmt.currency(i.waterfall) },
          { id: "row", name: t("studio.firstSourceRow"), type: "int", value: i => i.sourceRow ? String(i.sourceRow) : null, cell: i => i.sourceRow ? fmt.int(i.sourceRow) : "" },
          { id: "actions", name: t("margin.col.actions"), cell: i => <UiButton size="sm" variant="ghost" disabled={busy} aria-label={t("studio.acceptDifference", { scopeKey: i.scopeKey, component: i.component })} onClick={() => void operation(async () => { const out = await client.call("reconAccept", { id: i.id }); onStatus(out.status); setRecon(out.recon); bump(); setMessage(msg("studio.differenceAcceptedAndRecorded")); })}>{t("studio.accept")}</UiButton> },
        ]}/>
        <UiButton disabled={busy} onClick={() => void operation(async () => { const out = await client.call("reconAccept", { id: null }); onStatus(out.status); setRecon(out.recon); bump(); setMessage(msg("studio.allOpenDifferencesAccepted")); })}>{t("studio.acceptAllDifferences")}</UiButton>{" "}
        <UiButton disabled={busy} onClick={() => void operation(async () => { const out = await client.call("reconRebuild", {}); onStatus(out.status); setRecon(out.recon); bump(); setMessage(msg(out.recon.reconciled ? "studio.marginTotalsRebuiltFrom" : "studio.totalsRebuiltSomeDifferences")); })}>{t("studio.rebuildTotalsFromThe")}</UiButton></>}
  </Card>;
}
/** Data health: equal-weight components with their formula and the next step for each. */
function HealthCard({ client, version }: Shared) {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => { let active = true; void client.call("health", {}).then(h => { if (active) setHealth(h); }).catch(() => undefined); return () => { active = false; }; }, [client, version]);
  if (!health) return null;
  return <Card headingId="health-heading" title={health.score === null ? t("studio.dataHealth") : t("studio.dataHealthScore", { score: fmt.percent(health.score) })}>
    <p className={styles.small}>{say(health.formula)}</p>
    <div className={styles.tableWrap}><table className={styles.table}>
      <thead><tr><th scope="col">{t("studio.check")}</th><th scope="col">{t("studio.score")}</th><th scope="col">{t("studio.whatWeFound")}</th><th scope="col">{t("studio.nextStep")}</th></tr></thead>
      <tbody>{health.components.map(c => <tr key={c.key}><td>{say(c.label)}</td><td>{c.score === null ? t("common.notApplicable") : fmt.percent(c.score)}</td><td className={styles.wrap}>{say(c.detail)}</td><td className={styles.wrap}>{say(c.step)}</td></tr>)}</tbody>
    </table></div>
    <p className={styles.small}>{t("studio.healthFooter", { below: fmt.int(health.linesBelowCost), waiting: fmt.int(health.openFixLater) })}</p>
  </Card>;
}
/** Playground: fictional sample data with planted leaks, only in a vault without real files. */
function Playground({ client, busy, operation, onStatus, setMessage, bump, sources, onSources }: Shared & { sources: SourceView[]; onSources: () => Promise<void> }) {
  const [manifest, setManifest] = useState<PlaygroundManifest | null>(null), playLock = useSharedLock()("playgroundLoad");
  const loaded = sources.some(s => s.name.startsWith(PLAYGROUND_PREFIX)), real = sources.some(s => !s.name.startsWith(PLAYGROUND_PREFIX));
  if (real && !loaded) return null;
  return <Card headingId="playground-heading" title={t("studio.playground")}>
    <p>{t("studio.aFictionalIndustrialValve")}</p>
    {!loaded ? <UiButton variant="primary" disabled={busy || !!playLock} title={playLock ?? undefined} onClick={() => void operation(async () => { const out = await client.call("playgroundLoad", {}); onStatus(out.status); setManifest(out.manifest); await onSources(); bump(); setMessage(msg("studio.playgroundLoadedInvoiceLines", { lines: out.manifest.lines, count: out.manifest.leaks.length })); })}>{t("studio.loadThePlayground")}</UiButton>
      : <UiButton disabled={busy} onClick={() => void operation(async () => { const out = await client.call("playgroundRemove", {}); onStatus(out.status); setManifest(null); await onSources(); bump(); setMessage(msg("studio.removedPlaygroundFilesAnd", { count: Number(out.removed) })); })}>{t("studio.removePlaygroundData")}</UiButton>}
    {manifest && <ul className={styles.small}>{manifest.leaks.map(l => <li key={l.id}>{t("studio.plantedLeak", { id: l.id, description: l.id in PLANTED ? t(PLANTED[l.id],{minimum:fmt.currency("10000"),freight:fmt.currency("1500")}) : l.description, count: l.lines, dollars: fmt.currency(l.cents) })}</li>)}</ul>}
  </Card>;
}
