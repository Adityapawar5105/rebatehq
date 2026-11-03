// Import Studio orchestration inside the vault worker. Files stay in worker memory
// (File handles; bounded grids for spreadsheets/JSON/XML) and nothing is uploaded.
import JSZip from "jszip";
import type { Engine } from "../vault/engine";
import { sqlText } from "../spike/exact";
import { appendAudit } from "../vault/audit";
import { CAPS, type Tier } from "../vault/protocol";
import {
  DATE_FORMATS, DELIMITERS, LOADABLE, ROLES, ROLE_FIELDS, ROLE_LABELS, SPREADSHEET, StudioError, TEXT, align, canonicalValue, columnLetter, detectDateFormat, detectDecimal,
  detectHeader, detectRole, fingerprint, headerNames, kindOf, missingRequired, type FieldType, type Kind, type Role, type Settings, type StudioIssue,
} from "./formats";
import { bomLength, detectDelimiter, detectEncoding, sampleRows } from "./text";
import { MAX_DOC_BYTES, MAX_SHEET_BYTES, checkZip, jsonGrid, sheetGrid, sheetNames, xmlGrid, type Grid } from "./sheets";
import { CsvWriter, Normalizer, emptyStats, streamGrid, streamText, type Stats } from "./rows";
import { CODES, capUsage, commitSql, counts, createStage, finishRemovalSql, issueColumn, issueMessage, removeChildrenSql, resetStage, salesRanges, sampleIssues, stageFile, validate, type StagedFile } from "./load";

export const MAX_TEXT_BYTES = 256 * 1024 * 1024, MAX_FILES = 64, SAMPLE_BYTES = 256 * 1024;
export type Recipe = { id: string; name: string; profile: string; settings: Settings & { kind: Kind; role: Role | null } };
export type FileView = {
  id: string; name: string; bytes: string; kind: Kind; sheets: string[]; settings: Settings; role: Role | null; roleConfidence: number;
  roleScores: Record<Role, number>; headers: string[]; mapped: { field: string; header: string; column: string }[]; missing: string[]; ignored: string[];
  preview: { row: number; cells: string[] }[]; headerRowNumber: number; headerRowOptions: { index: number; row: number }[]; notices: string[];
  issues: StudioIssue[]; loadable: boolean; reason: string | null; estimatedRows: string; recipe: { id: string; name: string } | null;
  appliedRecipe: string | null; replaces: string | null; fixedLayout: boolean; textFormat: boolean; columnLabels: string[];
};
export type FileReport = { id: string; name: string; role: Role; rowsRead: string; rowsLoaded: string; rowsRejected: string; rowsSkipped: string; issueCount: string; issues: StudioIssue[]; dateRange: { from: string; to: string } | null };
export type BatchReport = { files: FileReport[]; warnings: string[]; loaded: string; rejected: string; capOk: boolean; capMessage: string | null; replaces: string | null };
export type StudioState = { files: FileView[]; report: BatchReport | null; recipes: { id: string; name: string; role: Role | null }[] };
export type SourceView = { id: string; name: string; role: string; importedAt: string; rowsLoaded: string; rowsRejected: string; issues: string };
export type Progress = (stage: string, done: string, total: string) => void;
type Entry = {
  id: string; file: File; kind: Kind; settings: Settings; role: Role | null; roleManual: boolean; sheets: string[]; zipNotices: string[];
  bytes: Uint8Array | null; grid: Grid | null; sample: string[][]; sampleBytes: number; sampleRecords: number; notices: string[]; replaces: string | null; appliedRecipe: string | null;
};
const id = () => crypto.randomUUID();
const clip = (v: string) => v.length > 120 ? v.slice(0, 117) + "..." : v;
export function safeName(name: string) { return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 120) || "converted"; }

export class Studio {
  private entries = new Map<string, Entry>();
  private order: string[] = [];
  private report: BatchReport | null = null;
  private staged: { files: StagedFile[]; stats: Map<number, Stats>; entries: Entry[]; replaces: string | null; roles: Set<Role> } | null = null;

  clear() { this.entries.clear(); this.order = []; this.report = null; this.staged = null; }
  private invalidate() { this.report = null; this.staged = null; }
  private get(fileId: string) { const e = this.entries.get(fileId); if (!e) throw new StudioError("That file is no longer in the batch."); return e; }

  async add(files: File[], recipes: Recipe[], replaces: string | null = null) {
    if (!files.length) throw new StudioError("Choose at least one file.");
    if (replaces && (files.length !== 1 || this.order.length)) throw new StudioError("Replace one imported file at a time, with an empty batch.");
    if (this.order.length && [...this.entries.values()].some(e => e.replaces)) throw new StudioError("Finish or clear the replacement before adding other files.");
    if (this.order.length + files.length > MAX_FILES) throw new StudioError(`Add at most ${MAX_FILES} files to one batch.`);
    const added: Entry[] = [];
    for (const file of files) added.push(await this.inspect(file, recipes, replaces));
    for (const e of added) { this.entries.set(e.id, e); this.order.push(e.id); }
    this.invalidate();
  }
  private async inspect(file: File, recipes: Recipe[], replaces: string | null): Promise<Entry> {
    const kind = kindOf(file.name);
    if (!kind) throw new StudioError(`${file.name}: use CSV, TSV, TXT, XLSX, XLSM, XLS, XLSB, ODS, JSON or XML. Other formats are not converted.`);
    if (file.name.length > 200 || file.size < 1) throw new StudioError(`${file.name}: choose a non-empty file with a name under 200 characters.`);
    const limit = TEXT.includes(kind) ? MAX_TEXT_BYTES : SPREADSHEET.includes(kind) ? MAX_SHEET_BYTES : MAX_DOC_BYTES;
    if (file.size > limit) throw new StudioError(`${file.name} is larger than ${Math.round(limit / 1048576)} MiB.${TEXT.includes(kind) ? " Split it or import a shorter date range." : " Save it as CSV and import the CSV instead."}`);
    const entry: Entry = { id: id(), file, kind, role: null, roleManual: false, sheets: [], zipNotices: [], bytes: null, grid: null, sample: [], sampleBytes: 0, sampleRecords: 1, notices: [], replaces, appliedRecipe: null,
      settings: { sheet: null, headerRow: 0, headerDepth: 1, delimiter: kind === "tsv" ? "\t" : ",", encoding: "utf-8", decimal: "dot", dateFormat: "YYYY-MM-DD" } };
    try {
      if (TEXT.includes(kind)) {
        const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
        entry.settings.encoding = detectEncoding(head).encoding;
        const text = await this.sampleText(entry);
        entry.settings.delimiter = detectDelimiter(text, kind === "tsv" ? "\t" : undefined);
        entry.sample = sampleRows(text, entry.settings.delimiter, 60);
      } else if (SPREADSHEET.includes(kind)) {
        entry.bytes = new Uint8Array(await file.arrayBuffer());
        if (kind !== "xls") entry.zipNotices = await checkZip(entry.bytes, kind);
        entry.sheets = sheetNames(entry.bytes); entry.settings.sheet = entry.sheets[0];
        entry.grid = sheetGrid(entry.bytes, entry.sheets[0], entry.zipNotices);
      } else {
        const text = await file.text();
        entry.grid = kind === "json" ? jsonGrid(text) : xmlGrid(text);
      }
    } catch (error) {
      if (error instanceof StudioError) throw new StudioError(`${file.name}: ${error.message}`);
      throw new StudioError(`${file.name}: the file could not be read. Check that it is a valid ${kind.toUpperCase()} file.`);
    }
    this.detect(entry);
    const match = this.matchRecipe(entry, recipes);
    if (match) this.applySettings(entry, match);
    return entry;
  }
  private async sampleText(entry: Entry) {
    const head = new Uint8Array(await entry.file.slice(0, SAMPLE_BYTES).arrayBuffer());
    const text = new TextDecoder(entry.settings.encoding).decode(head.subarray(bomLength(head, entry.settings.encoding)), { stream: true });
    entry.sampleBytes = head.length; entry.sampleRecords = Math.max(1, text.split("\n").length - (text.endsWith("\n") ? 1 : 0));
    return text;
  }
  private rows(entry: Entry) { return entry.grid ? entry.grid.rows : entry.sample; }
  private rowNumber(entry: Entry, index: number) { return entry.grid ? entry.grid.rowNumbers[index] ?? index + 1 : index + 1; }
  private detect(entry: Entry) {
    const rows = this.rows(entry);
    if (entry.grid?.keyed) { entry.settings.headerRow = 0; entry.settings.headerDepth = 1; }
    else { const h = detectHeader(rows, !!entry.grid?.merged); entry.settings.headerRow = h.headerRow; entry.settings.headerDepth = h.headerDepth; }
    const data = rows.slice(entry.settings.headerRow + 1, entry.settings.headerRow + 200);
    entry.settings.decimal = detectDecimal(data, entry.grid ? "," : entry.settings.delimiter);
    const date = detectDateFormat(data);
    entry.settings.dateFormat = date.format;
    entry.notices = date.ambiguous ? [`Dates such as 03/04/2025 could be day-first or month-first. ${date.format} was assumed; confirm the date format below.`] : [];
    if (!entry.roleManual) entry.role = detectRole(entry.file.name, this.headers(entry)).role;
  }
  private headers(entry: Entry) {
    const rows = this.rows(entry);
    return rows.length ? headerNames(rows, Math.min(entry.settings.headerRow, rows.length - 1), entry.settings.headerDepth) : [];
  }
  private matchRecipe(entry: Entry, recipes: Recipe[]) {
    for (const recipe of recipes) {
      if (recipe.settings.kind !== entry.kind) continue;
      if (entry.grid && !entry.grid.keyed && recipe.settings.sheet !== entry.settings.sheet) continue;
      const rows = entry.grid ? entry.grid.rows : entry.settings.delimiter === recipe.settings.delimiter ? entry.sample : null;
      if (!rows?.length) continue;
      const headers = headerNames(rows, Math.min(recipe.settings.headerRow, rows.length - 1), recipe.settings.headerDepth);
      if (fingerprint(entry.kind, headers) === recipe.profile) return recipe;
    }
    return null;
  }
  private applySettings(entry: Entry, recipe: Recipe) {
    const { kind: _kind, role, ...settings } = recipe.settings;
    entry.settings = { ...entry.settings, ...settings, sheet: entry.settings.sheet };
    if (role) { entry.role = role; entry.roleManual = true; }
    entry.appliedRecipe = recipe.name;
  }
  async update(fileId: string, patch: Partial<Settings> & { role?: Role | null }) {
    const entry = this.get(fileId), before = entry.settings;
    const next: Settings = { ...before };
    if (patch.sheet !== undefined && entry.sheets.includes(String(patch.sheet))) next.sheet = String(patch.sheet);
    if (patch.encoding && ["utf-8", "utf-16le", "utf-16be", "windows-1252"].includes(patch.encoding)) next.encoding = patch.encoding;
    if (patch.delimiter && DELIMITERS.includes(patch.delimiter)) next.delimiter = patch.delimiter;
    if (patch.decimal === "dot" || patch.decimal === "comma") next.decimal = patch.decimal;
    if (patch.dateFormat && DATE_FORMATS.includes(patch.dateFormat)) next.dateFormat = patch.dateFormat;
    if (patch.headerDepth === 1 || patch.headerDepth === 2 || patch.headerDepth === 3) next.headerDepth = patch.headerDepth;
    if (patch.headerRow !== undefined && Number.isInteger(patch.headerRow) && patch.headerRow >= 0 && patch.headerRow < 40) next.headerRow = patch.headerRow;
    entry.settings = next;
    if (next.sheet !== before.sheet && entry.bytes) { entry.grid = sheetGrid(entry.bytes, next.sheet!, entry.zipNotices); this.detect(entry); }
    else if (TEXT.includes(entry.kind) && (next.encoding !== before.encoding || next.delimiter !== before.delimiter)) entry.sample = sampleRows(await this.sampleText(entry), next.delimiter, 60);
    if (patch.role !== undefined) { entry.role = patch.role && ROLES.includes(patch.role) ? patch.role : null; entry.roleManual = true; }
    else if (!entry.roleManual) entry.role = detectRole(entry.file.name, this.headers(entry)).role;
    entry.appliedRecipe = null; this.invalidate();
  }
  drop(fileId: string) { this.get(fileId); this.entries.delete(fileId); this.order = this.order.filter(x => x !== fileId); this.invalidate(); }

  view(entry: Entry, recipes: Recipe[]): FileView {
    const rows = this.rows(entry), headers = this.headers(entry), detected = detectRole(entry.file.name, headers);
    const role = entry.role, alignment = role ? align(role, headers) : [];
    const used = new Set(alignment.map(a => a.index)), missing = role ? missingRequired(role, alignment) : [];
    const letter = (i: number) => entry.grid?.keyed ? headers[i] : columnLetter((entry.grid?.colOffset ?? 0) + i);
    const start = Math.max(0, entry.settings.headerRow - entry.settings.headerDepth + 1 - 2);
    const reason = !role ? "Choose what this file contains." : !LOADABLE.includes(role) ? `${ROLE_LABELS[role]} files can be converted and downloaded now; loading them arrives in Phase 2.` : missing.length ? `Missing column(s): ${missing.join(", ")}. Rename the headers to these names; mapping other header names arrives in the next chunk.` : null;
    // Text files: records in the 256 KiB sample scaled to the file size (exact for small files).
    const dataRows = entry.grid ? entry.grid.rows.length - entry.settings.headerRow - 1 : Math.round(entry.file.size * entry.sampleRecords / Math.max(1, entry.sampleBytes)) - entry.settings.headerRow - 1;
    const recipe = this.matchRecipe(entry, recipes);
    return {
      id: entry.id, name: entry.file.name, bytes: String(entry.file.size), kind: entry.kind, sheets: entry.sheets, settings: entry.settings, role,
      roleConfidence: role ? detected.scores[role] : 0, roleScores: detected.scores, headers,
      mapped: alignment.map(a => ({ field: a.field, header: headers[a.index], column: letter(a.index) })), missing,
      ignored: headers.filter((_, i) => !used.has(i)), headerRowNumber: this.rowNumber(entry, entry.settings.headerRow),
      headerRowOptions: rows.slice(0, 40).map((_, i) => ({ index: i, row: this.rowNumber(entry, i) })),
      preview: rows.slice(start, start + 22).map((cells, i) => ({ row: this.rowNumber(entry, start + i), cells: cells.slice(0, 30).map(clip) })),
      notices: [...(entry.grid?.notices ?? []), ...entry.notices, ...(entry.appliedRecipe ? [`Recipe "${entry.appliedRecipe}" was applied.`] : [])],
      issues: (entry.grid?.issues ?? []).slice(0, 50), loadable: reason === null, reason, estimatedRows: String(Math.max(0, dataRows)),
      recipe: recipe && recipe.name !== entry.appliedRecipe ? { id: recipe.id, name: recipe.name } : null, appliedRecipe: entry.appliedRecipe,
      replaces: entry.replaces, fixedLayout: !!entry.grid?.keyed, textFormat: TEXT.includes(entry.kind),
      columnLabels: Array.from({ length: Math.min(30, Math.max(0, ...rows.slice(start, start + 22).map(r => r.length))) }, (_, i) => letter(i)),
    };
  }
  state(recipes: Recipe[]): StudioState {
    return { files: this.order.map(x => this.view(this.entries.get(x)!, recipes)), report: this.report, recipes: recipes.map(r => ({ id: r.id, name: r.name, role: r.settings.role })) };
  }
  recipeFor(fileId: string, name: string): Omit<Recipe, "id"> {
    const entry = this.get(fileId), label = name.trim();
    if (!label || label.length > 80) throw new StudioError("Name the recipe after the ERP or supplier (1-80 characters).");
    return { name: label, profile: fingerprint(entry.kind, this.headers(entry)), settings: { ...entry.settings, kind: entry.kind, role: entry.role } };
  }
  apply(fileId: string, recipe: Recipe) {
    const entry = this.get(fileId);
    if (this.matchRecipe(entry, [recipe])?.id !== recipe.id) throw new StudioError("This recipe's headers do not match this file.");
    this.applySettings(entry, recipe); this.invalidate();
  }

  private async run(entry: Entry, normalizer: Normalizer, signal: AbortSignal, progress?: (bytes: number) => void) {
    if (entry.grid) streamGrid(entry.grid, normalizer, signal);
    else await streamText(entry.file, entry.settings, normalizer, signal, progress);
  }
  /** Clean, formula-safe UTF-8 CSV of one file for download. */
  async download(fileId: string, signal: AbortSignal) {
    const entry = this.get(fileId), writer = new CsvWriter("download");
    let headed = false, types: (FieldType | null)[] = [];
    const normalizer = new Normalizer(entry.settings, (cells, row) => {
      if (!headed) {
        writer.header(normalizer.headers!); headed = true;
        const fields = entry.role ? ROLE_FIELDS[entry.role] : [], at = entry.role ? align(entry.role, normalizer.headers!) : [];
        types = normalizer.headers!.map((_, i) => fields.find(f => f.name === at.find(a => a.index === i)?.field)?.type ?? null);
      }
      writer.row(cells.map((v, i) => types[i] ? canonicalValue(types[i]!, v, entry.settings) : v), row);
    });
    await this.run(entry, normalizer, signal);
    if (!headed && normalizer.headers) writer.header(normalizer.headers);
    const base = entry.file.name.replace(/\.[^.]+$/, ""), sheet = entry.sheets.length > 1 ? ` - ${entry.settings.sheet}` : "";
    return { name: safeName(base + sheet) + ".csv", blob: writer.blob(), rows: String(writer.rows), rejected: String(normalizer.stats.rejected) };
  }
  async zip(signal: AbortSignal) {
    if (!this.order.length) throw new StudioError("Add files to convert first.");
    const zip = new JSZip(), names = new Set<string>();
    for (const x of this.order) {
      const file = await this.download(x, signal);
      let name = file.name; for (let n = 2; names.has(name.toLowerCase()); n++) name = file.name.replace(/\.csv$/, ` (${n}).csv`);
      names.add(name.toLowerCase()); zip.file(name, file.blob);
    }
    return { name: "margindesk-converted.zip", blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }) };
  }

  async plan(engine: Engine, tier: Tier, signal: AbortSignal, progress: Progress) {
    this.invalidate();
    const entries = this.order.map(x => this.entries.get(x)!);
    if (!entries.length) throw new StudioError("Add files to import first.");
    const warnings: string[] = [], replaces = entries.find(e => e.replaces)?.replaces ?? null;
    for (const e of entries) {
      if (!e.role) throw new StudioError(`${e.file.name}: choose what this file contains before importing.`);
      const missing = missingRequired(e.role, align(e.role, this.headers(e)));
      if (LOADABLE.includes(e.role) && missing.length) throw new StudioError(`${e.file.name}: missing column(s) ${missing.join(", ")}. Rename the headers to these names, or remove the file from the batch. Mapping other header names arrives in the next chunk.`);
    }
    const load = entries.filter(e => LOADABLE.includes(e.role!));
    for (const e of entries.filter(x => !LOADABLE.includes(x.role!))) warnings.push(`${e.file.name}: ${ROLE_LABELS[e.role!]} files are converted only; loading them arrives in Phase 2.`);
    if (!load.length) throw new StudioError("No file in this batch can be loaded yet. Download the converted CSVs instead.");
    if (replaces) {
      const role = (await engine.conn.query(`SELECT role FROM source_files WHERE id=${sqlText(replaces)}`)).toArray()[0]?.role;
      if (!role) throw new StudioError("The file being replaced is no longer in the vault.");
      if (role !== load[0].role) throw new StudioError(`The replacement must also be a ${ROLE_LABELS[role as Role] ?? role} file.`);
    }
    const roles = new Set(load.map(e => e.role!)), files: StagedFile[] = [], stats = new Map<number, Stats>();
    try {
      await resetStage(engine);
      for (const role of roles) await createStage(engine, role);
      for (let ord = 0; ord < load.length; ord++) {
        const e = load[ord], writer = new CsvWriter("internal");
        progress(`Converting ${e.file.name} (${ord + 1} of ${load.length})`, "0", String(e.file.size));
        const letter = (i: number) => e.grid?.keyed ? (this.headers(e)[i] ?? "") : columnLetter((e.grid?.colOffset ?? 0) + i);
        let headed = false;
        const normalizer = new Normalizer(e.settings, (cells, row) => { if (!headed) { writer.header(normalizer.headers!); headed = true; } writer.row(cells, row); }, emptyStats(), letter);
        await this.run(e, normalizer, signal, bytes => progress(`Converting ${e.file.name} (${ord + 1} of ${load.length})`, String(bytes), String(e.file.size)));
        const headers = normalizer.headers ?? [];
        if (!headed) writer.header(headers);
        for (const issue of e.grid?.issues ?? []) normalizer.stats.issues.push(issue);
        normalizer.stats.issueCount += e.grid?.issues.length ?? 0;
        const staged: StagedFile = { ord, role: e.role!, name: e.file.name, bytes: e.file.size, fingerprint: `${e.file.name}|${e.file.size}|${e.file.lastModified}`, alignment: align(e.role!, headers), settings: e.settings, keyed: !!e.grid?.keyed, headers, colOffset: e.grid?.colOffset ?? 0 };
        signal.throwIfAborted();
        await stageFile(engine, staged, writer.blob(), headers.length);
        files.push(staged); stats.set(ord, normalizer.stats);
      }
      progress("Checking values, duplicates and plan limits", "0", "1");
      for (const role of roles) { signal.throwIfAborted(); await validate(engine, role as Exclude<Role, "rebate_agreement">, files, replaces); }
      const reports: FileReport[] = [];
      let loaded = BigInt(0), rejected = BigInt(0);
      for (const role of roles) for (const c of await counts(engine, role)) {
        const file = files[c.ord], st = stats.get(c.ord)!, sampled = await sampleIssues(engine, role, c.ord);
        const issues = [...st.issues.slice(0, 50), ...sampled.map(s => ({ row: s.row, column: issueColumn(s.code, file), message: issueMessage(s.code, file.settings) }))].sort((a, b) => a.row - b.row).slice(0, 100);
        const bad = BigInt(c.bad) + BigInt(st.rejected);
        loaded += BigInt(c.ok); rejected += bad;
        reports.push({ id: load[c.ord].id, name: file.name, role, rowsRead: String(st.read), rowsLoaded: c.ok, rowsRejected: String(bad), rowsSkipped: String(st.skipped), issueCount: String(BigInt(c.bad) + BigInt(st.issueCount)), issues, dateRange: null });
      }
      for (const f of files) if (!reports.some(r => r.id === load[f.ord].id)) {
        const st = stats.get(f.ord)!; rejected += BigInt(st.rejected);
        reports.push({ id: load[f.ord].id, name: f.name, role: f.role, rowsRead: String(st.read), rowsLoaded: "0", rowsRejected: String(st.rejected), rowsSkipped: String(st.skipped), issueCount: String(st.issueCount), issues: st.issues.slice(0, 100), dateRange: null });
      }
      if (roles.has("sales_history")) {
        const ranges = await salesRanges(engine, replaces);
        for (const r of ranges.batch) { const rep = reports.find(x => x.id === load[r.ord].id); if (rep) rep.dateRange = { from: r.from, to: r.to }; }
        for (let i = 0; i < ranges.batch.length; i++) {
          const a = ranges.batch[i];
          for (const b of ranges.batch.slice(i + 1)) if (a.from <= b.to && b.from <= a.to) warnings.push(`${files[a.ord].name} and ${files[b.ord].name} cover overlapping dates (${a.from} to ${a.to} and ${b.from} to ${b.to}). Check that they are not the same invoices.`);
          for (const v of ranges.vault) if (a.from <= v.to && v.from <= a.to) warnings.push(`${files[a.ord].name} overlaps the dates of ${v.name}, already in the vault (${v.from} to ${v.to}).`);
        }
      }
      const prints = files.map(f => sqlText(f.fingerprint)).join(",");
      for (const r of (await engine.conn.query(`SELECT b.fingerprint, s.name, s.imported_at FROM import_batches b JOIN source_files s ON s.id=b.source_id WHERE b.fingerprint IN (${prints})${replaces ? ` AND s.id<>${sqlText(replaces)}` : ""}`)).toArray())
        warnings.push(`${String(r.name)} looks identical to a file already imported on ${String(r.imported_at).slice(0, 10)}. Duplicate rows will be rejected.`);
      const usage = await capUsage(engine, roles, replaces), cap = CAPS[tier];
      const capOk = usage.lines <= BigInt(cap.lines) && usage.products <= BigInt(cap.products);
      this.report = { files: reports.sort((a, b) => load.findIndex(e => e.id === a.id) - load.findIndex(e => e.id === b.id)), warnings, loaded: loaded.toString(), rejected: rejected.toString(), capOk,
        capMessage: capOk ? null : `This import exceeds your ${tier} limit of ${cap.lines.toLocaleString("en-US")} invoice lines or ${cap.products.toLocaleString("en-US")} products (it would hold ${usage.lines.toString()} lines and ${usage.products.toString()} products). Remove files or filter them first.`, replaces };
      this.staged = { files, stats, entries: load, replaces, roles };
      return this.report;
    } catch (error) { await resetStage(engine).catch(() => undefined); throw error; }
  }
  /** Commit the planned batch. The caller made the engine writable and saves afterwards. */
  async commit(engine: Engine, acknowledge: boolean) {
    const staged = this.staged, report = this.report;
    if (!staged || !report) throw new StudioError("Review the batch again before importing.");
    if (report.loaded === "0") throw new StudioError("No valid rows to load. Fix the issues listed and review again.");
    if (report.rejected !== "0" && !acknowledge) throw new StudioError("Confirm that rejected rows will not be loaded.");
    if (!report.capOk) throw new StudioError(report.capMessage!);
    const now = new Date().toISOString(), sources = staged.files.map(() => id());
    const values = staged.files.map((f, i) => `(${f.ord},${sqlText(sources[i])},${sqlText(f.name)})`).join(",");
    const messages = staged.files.flatMap(f => CODES(f.role).map(code => `(${f.ord},${sqlText(code)},${sqlText(issueColumn(code, f))},${sqlText(issueMessage(code, f.settings))})`)).join(",");
    await engine.conn.query("BEGIN");
    try {
      if (staged.replaces) await engine.conn.query(removeChildrenSql(staged.replaces));
      await engine.conn.query(`CREATE TEMP TABLE studio_files AS SELECT * FROM (VALUES ${values}) v(file_ord, source_id, name);
CREATE TEMP TABLE studio_messages AS SELECT * FROM (VALUES ${messages}) v(file_ord, code, column_name, message)`);
      for (const [i, f] of staged.files.entries()) {
        const r = report.files.find(x => x.id === staged.entries[f.ord].id)!;
        await engine.conn.query(`INSERT INTO source_files VALUES (${sqlText(sources[i])},${sqlText(f.name)},${sqlText(f.role)},${f.bytes},${sqlText(now)});
INSERT INTO import_batches(id,source_id,rows_loaded,rows_rejected,imported_at,content_sha256,fingerprint,rows_skipped) VALUES (${sqlText(id())},${sqlText(sources[i])},${r.rowsLoaded},${r.rowsRejected},${sqlText(now)},NULL,${sqlText(f.fingerprint)},${r.rowsSkipped})`);
      }
      await engine.conn.query(commitSql(staged.roles));
      for (const [i, f] of staged.files.entries()) {
        const issues = staged.stats.get(f.ord)!.issues;
        for (let at = 0; at < issues.length; at += 500) await engine.conn.query(`INSERT INTO import_issues VALUES ${issues.slice(at, at + 500).map(x => `(${sqlText(id())},${sqlText(sources[i])},${Math.max(1, x.row)},${sqlText(x.column)},${sqlText(x.message)},'open')`).join(",")}`);
        const r = report.files.find(x => x.id === staged.entries[f.ord].id)!;
        await appendAudit(engine, "import.committed", { source_id: sources[i], file_name: f.name, role: f.role, rows_loaded: r.rowsLoaded, rows_rejected: r.rowsRejected, ...(staged.replaces ? { replaces: staged.replaces } : {}) });
      }
      await engine.conn.query("COMMIT");
    } catch (error) { await engine.conn.query("ROLLBACK").catch(() => undefined); throw error; }
    let cleanup = true;
    if (staged.replaces) {
      try { await engine.conn.query(`BEGIN; ${finishRemovalSql(staged.replaces)} COMMIT`); } catch { await engine.conn.query("ROLLBACK").catch(() => undefined); cleanup = false; }
    }
    await resetStage(engine).catch(() => undefined);
    const result = { loaded: report.loaded, rejected: report.rejected, files: String(staged.files.length), cleanup };
    this.clear(); return result;
  }
}
/** Remove one imported file and exactly its rows (two transactions; see finishRemovalSql). */
export async function removeSource(engine: Engine, source: string) {
  const row = (await engine.conn.query(`SELECT name FROM source_files WHERE id=${sqlText(source)}`)).toArray()[0];
  if (!row) throw new StudioError("That file is no longer in the vault.");
  await engine.conn.query("BEGIN");
  try {
    await engine.conn.query(removeChildrenSql(source));
    await appendAudit(engine, "import.removed", { source_id: source, file_name: String(row.name) });
    await engine.conn.query("COMMIT");
  } catch (error) { await engine.conn.query("ROLLBACK").catch(() => undefined); throw error; }
  try { await engine.conn.query(`BEGIN; ${finishRemovalSql(source)} COMMIT`); return true; }
  catch { await engine.conn.query("ROLLBACK").catch(() => undefined); return false; }
}
export async function listSources(engine: Engine): Promise<SourceView[]> {
  return (await engine.conn.query(`SELECT s.id, s.name, s.role, s.imported_at, coalesce(b.rows_loaded,0)::VARCHAR AS loaded, coalesce(b.rows_rejected,0)::VARCHAR AS rejected,
(SELECT count(*) FROM import_issues i WHERE i.source_id=s.id)::VARCHAR AS issues FROM source_files s LEFT JOIN import_batches b ON b.source_id=s.id ORDER BY s.imported_at DESC, s.name`)).toArray()
    .map(r => ({ id: String(r.id), name: String(r.name), role: String(r.role), importedAt: String(r.imported_at), rowsLoaded: String(r.loaded), rowsRejected: String(r.rejected), issues: String(r.issues) }));
}
export async function loadRecipes(engine: Engine): Promise<Recipe[]> {
  const rows = (await engine.conn.query("SELECT id, name, profile, settings FROM converter_recipes ORDER BY name LIMIT 200")).toArray();
  return rows.flatMap(r => {
    try {
      const s = JSON.parse(String(r.settings));
      const valid = DELIMITERS.includes(s.delimiter) && DATE_FORMATS.includes(s.dateFormat) && ["dot", "comma"].includes(s.decimal) && [1, 2, 3].includes(s.headerDepth) && Number.isInteger(s.headerRow) && kindOf("x." + s.kind) === s.kind && (s.role === null || ROLES.includes(s.role));
      return valid ? [{ id: String(r.id), name: String(r.name), profile: String(r.profile), settings: s }] : [];
    } catch { return []; }
  });
}
export function recipeSql(recipe: Omit<Recipe, "id">) {
  const now = new Date().toISOString();
  return `DELETE FROM converter_recipes WHERE name=${sqlText(recipe.name)} AND profile=${sqlText(recipe.profile)};
INSERT INTO converter_recipes VALUES (${sqlText(id())},${sqlText(recipe.name)},${sqlText(recipe.profile)},${sqlText(JSON.stringify(recipe.settings))},${sqlText(now)})`;
}
