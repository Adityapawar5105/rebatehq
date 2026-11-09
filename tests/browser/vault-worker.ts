import { plainText } from "../../lib/i18n/core";
import { backupConfig, storeBackupConfig } from "../../lib/vault/backup";
import { dispatch } from "../../lib/vault/dispatch";
// Test-only worker, bundled under test-results and intercepted by Playwright.
// It is never included by the production asset build or exposed by app routes.
import { VaultService as ProductionVaultService } from "../../lib/vault/service";
import { VaultStorage, storageStatus } from "../../lib/vault/storage";
import { openMemory, snapshotBytes, closeMemory, makeWritable } from "../../lib/vault/engine";
import { appendAudit, GENESIS, verifyAudit } from "../../lib/vault/audit";
import { V1_SQL } from "../../lib/vault/schema";
import { sqlText } from "../../lib/spike/exact";
import { deriveKey, encrypt, decrypt } from "../../lib/vault/crypto";
import { ingest } from "../../lib/vault/ingest";
import * as duckdb from "@duckdb/duckdb-wasm";
import JSZip from "jszip";
import * as fx from "../helpers/studio-fixtures";
import { lineFromCents } from "../../lib/margin/engine";
import { rha } from "../../lib/margin/decimal";
import { findLeaks, hitKinds, hitRows } from "../../lib/margin/leaks";
import { REBUILD_SQL, findDifferences } from "../../lib/margin/aggregate";
import { moneyText } from "../../lib/spike/exact";
// Test-only signed metadata. Private test key is injected into this intercepted test bundle only.
class VaultService extends ProductionVaultService {
 override async init(scope:import('../../lib/vault/protocol').Scope){
  await super.init(scope);
  const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(process.env.TEST_LICENCE_PRIVATE_KEY!),c=>c.charCodeAt(0)),'Ed25519',false,['sign']);
  const issued=Math.floor(Date.now()/1000),payload=JSON.stringify({v:1,sub:scope.userId,workspace:scope.tenantId,device:'test-only',tier:'scale',state:'active',issued,expires:issued+3600,offlineUntil:issued+86400,reason:''});
  const bytes=new Uint8Array(await crypto.subtle.sign('Ed25519',key,new TextEncoder().encode(payload)));
  return this.licenceSet({payload,signature:btoa(String.fromCharCode(...bytes))},'test-only',false);
 }
}
const labScope = { userId: "synthetic-lab-user", tenantId: "synthetic-lab-workspace" };
const fixtureScope = { userId: "synthetic-v1-fixture-user", tenantId: "synthetic-v1-fixture-workspace" };
const secret = "synthetic-local-vault-passphrase";
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
async function reset(scope: typeof labScope) {
  const storage = await VaultStorage.open(scope);
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("rebatehq-vaults");
  await root.removeEntry(storage.scope, { recursive: true });
}
async function fixture() {
  const storage = await VaultStorage.open(fixtureScope), engine = await openMemory();
  await engine.conn.query(`${V1_SQL} INSERT INTO vault_meta VALUES (1,1,'starter',${sqlText(storage.scope)},${sqlText(GENESIS)},0)`);
  await appendAudit(engine, "vault.created", { schema_version: "1", fixture: "committed synthetic compatibility fixture" });
  const file = new File(["line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount\n1,1,1,2025-01-01,1,12.50,0.50,0.25,0.00,8.00\n"], "synthetic-v1.csv");
  await ingest(engine, file, "starter", new AbortController().signal, () => undefined);
  const plain = await snapshotBytes(engine), chunks: Uint8Array<ArrayBuffer>[] = [];
  await encrypt(plain, { async write(b) { chunks.push(new Uint8Array(b)); }, async close() {}, async abort() {} }, await deriveKey(secret), storage.scope, "1");
  plain.fill(0); await closeMemory(engine);
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}
async function testFixture(bytes: Uint8Array) {
  await reset(fixtureScope);
  const storage = await VaultStorage.open(fixtureScope), name = "snapshot-00000000-0000-4000-8000-000000000001.enc";
  const stream = await (await storage.directory.getFileHandle(name, { create: true })).createWritable(); await stream.write(new Uint8Array(bytes)); await stream.close();
  const head = await (await storage.directory.getFileHandle("head.json", { create: true })).createWritable(); await head.write(JSON.stringify({ format: 1, current: name, previous: null, sequence: "1", savedAt: "2026-11-03T00:00:00Z" })); await head.close();
  const preflight = await decrypt(new Blob([new Uint8Array(bytes)]), secret, storage.scope);
  const probe = await openMemory(preflight.bytes);
  assert((await probe.conn.query("SELECT schema_version FROM vault_meta")).toArray()[0].schema_version === 1, "Committed fixture is not v1");
  assert((await verifyAudit(probe)).valid, "Committed v1 fixture audit failed");
  await closeMemory(probe);
  const service = new VaultService(() => undefined); await service.init(fixtureScope);
  const result = await service.unlock(secret);
  assert(result.schemaVersion === "17" && result.lines === "1", "V1 snapshot did not upgrade with its row intact");
  const agg = (await service.engine!.conn.query("SELECT count(*)::VARCHAR AS n, sum(list_cents)::VARCHAR AS l, max(line_kind) AS k FROM agg_cpm")).toArray()[0];
  assert(agg.n === "1" && agg.l === "1250" && agg.k === "sale", "V1 upgrade must build the margin pre-aggregate from existing lines");
  assert((await service.marginWaterfall()).margin === "375", "Upgraded v1 line waterfall wrong");
  assert((await service.verify()).valid, "V1 upgraded chain failed"); await service.lock(); await service.unlock(secret); await service.lock(); await reset(fixtureScope); return result;
}
async function seed(rows: number) {
  assert(rows === 1_000_000 || rows === 2_000_000, "benchmark scope");
  await reset(labScope);
  const service = new VaultService(() => undefined); await service.init(labScope); await service.create(secret, "professional");
  const engine = service.engine!, source = crypto.randomUUID(), start = performance.now();
  await engine.conn.query(`BEGIN;
INSERT INTO products(product_id) SELECT (i+1)::VARCHAR FROM range(100000)t(i);
INSERT INTO customers(customer_id) SELECT (i+1)::VARCHAR FROM range(2000)t(i);
INSERT INTO source_files VALUES('${source}','synthetic-benchmark.csv','sales_history',0,'2026-11-03');
INSERT INTO import_batches(id,source_id,rows_loaded,rows_rejected,imported_at) VALUES('${crypto.randomUUID()}','${source}',${rows},0,'2026-11-03')`);
  for (let at = 0; at < rows; at += 50_000) await engine.conn.query(`INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row) SELECT '${source}',i+1,((i%100000)+1)::VARCHAR,((i*13%2000)+1)::VARCHAR,(DATE '2024-01-01'+INTERVAL (least(23,(i*24)//${rows})) MONTH)::DATE,(i%5)+1,10000+(i%997)*29,(i%21)*50,100+i%599,CASE WHEN i%7=0 THEN 200 ELSE 0 END,6000+(i%991)*23,i+2 FROM range(${at},${Math.min(rows, at + 50_000)})t(i) ORDER BY 4,5,2`);
  await appendAudit(engine, "fixture.synthetic_benchmark", { rows: String(rows) }); await engine.conn.query("COMMIT");
  // As in the product (commit, then derived totals): rebuilding inside the 2M-line insert transaction cannot spill and exceeds the 512 MB guardrail.
  await engine.conn.query(`BEGIN; ${REBUILD_SQL} COMMIT`);
  (service as unknown as { dirty: boolean }).dirty = true;
  await service.save(); const status = await service.status(); await service.lock();
  return { rows: status.lines, seedAndSaveMs: String(Math.round(performance.now() - start)), storage: await storageStatus() };
}
async function integrity() {
  const scope = { userId: "test-" + crypto.randomUUID(), tenantId: "test-" + crypto.randomUUID() };
  let idle = false;
  // Background warm-up is off here so the injected copy failure hits the synchronous path.
  const service = new VaultService(() => { void service.lock().then(() => { idle = true; }); }, 150, undefined, false);
  await service.init(scope); await service.create(secret, "starter");
  await new Promise(resolve => setTimeout(resolve, 400)); assert(idle && (await service.status()).state === "locked", "Auto-lock failed");
  (service as unknown as { idleMs: number }).idleMs = 10000;
  await service.unlock(secret);
  const query = service.engine!.conn.query.bind(service.engine!.conn);
  let injected = false;
  service.engine!.conn.query = async function(sql: string) { if (!injected && sql.startsWith("INSERT INTO products SELECT")) { injected = true; throw new Error("simulated first-change copy failure"); } return query(sql); } as typeof query;
  let copyFailed = false; try { await makeWritable(service.engine!); } catch { copyFailed = true; }
  service.engine!.conn.query = query;
  assert(copyFailed && !service.engine!.writable && (await service.verify()).valid, "Failed first-change copy altered the readable snapshot");
  await makeWritable(service.engine!);
  const extra = new VaultService(() => undefined, undefined, 500); await extra.init(scope);
  let blocked = false; try { await extra.unlock(secret); } catch (e) { blocked = (e as { code: string }).code === "OTHER_TAB"; }
  assert(blocked, "Second writer was not blocked");
  // A tab reopened right after another closes or crashes waits for the lease instead of failing.
  const waiting = new VaultService(() => undefined, undefined, 5000); await waiting.init(scope);
  const takeover = waiting.unlock(secret); await new Promise(resolve => setTimeout(resolve, 200)); await service.lock();
  await takeover; assert((await waiting.status()).state === "unlocked", "Waiting writer did not take over after the lease was released");
  await waiting.lock(); await service.unlock(secret); await makeWritable(service.engine!);
  await service.engine!.conn.query("UPDATE audit_log SET details='tampered' WHERE sequence=1");
  assert(!(await verifyAudit(service.engine!)).valid, "Audit tampering was not detected");
  await service.lock();
  let wrong = false; try { await service.unlock("deliberately-wrong-passphrase"); } catch { wrong = true; }
  assert(wrong && (await service.status()).state === "locked", "Wrong passphrase was accepted");
  await service.unlock(secret); assert((await service.verify()).valid, "Unsaved tamper altered encrypted snapshot"); await service.lock();
  await service.unlock(secret);
  await makeWritable(service.engine!); await service.engine!.conn.query("BEGIN");
  await appendAudit(service.engine!, "fixture.recovery", { synthetic: "true" }); await service.engine!.conn.query("COMMIT");
  (service as unknown as { dirty: boolean }).dirty = true; await service.save(); await service.lock();
  const head = await service.storage.readHead(), file = await service.storage.file(head!.current), bytes = new Uint8Array(await file.arrayBuffer()); bytes[bytes.length - 1] ^= 1;
  const damaged = await (await service.storage.directory.getFileHandle(head!.current)).createWritable(); await damaged.write(bytes); await damaged.close();
  assert((await service.unlock(secret)).recovered && (await service.verify()).valid, "Corrupt current generation did not recover the retained previous snapshot");
  (service as unknown as { dirty: boolean }).dirty = true;
  service.storage.publish = async () => { throw new Error("simulated quota failure"); };
  assert(await service.autoLock() === false && (await service.status()).state === "locked", "Failed save prevented secure auto-lock");
  await reset(scope);
  return { autoLock: idle, secondWriterBlocked: blocked, tamperDetected: true, wrongPassphraseRejected: wrong, autoLockAfterSaveFailure: true, firstChangeRollback: copyFailed, previousGenerationRecovery: true };
}
async function firstChange(rows: number) {
  // Measurement only: same production unlock, background warm-up, switch and save paths.
  // Updating an existing synthetic product avoids bypassing the import cap.
  const service = new VaultService(() => undefined); await service.init(labScope);
  try {
    const before = await service.unlock(secret), unlocked = performance.now();
    assert(before.lines === String(rows) && !service.engine!.writable && before.preparing, "First-change benchmark did not start warm-up from an untouched read-only snapshot");
    const readStart = performance.now(); assert((await service.status()).lines === String(rows), "Vault not readable during warm-up");
    const readDuringWarmupMs = Math.round(performance.now() - readStart);
    assert(await service.warmup() === true, "Background warm-up failed");
    const warmupMs = Math.round(performance.now() - unlocked); // unlock returned -> background copy done
    const started = performance.now(); await makeWritable(service.engine!);
    await service.engine!.conn.query("BEGIN; UPDATE products SET description='Synthetic first-change measurement' WHERE product_id='1'");
    await appendAudit(service.engine!, "fixture.first_change", { rows: String(rows) }); await service.engine!.conn.query("COMMIT");
    (service as unknown as { dirty: boolean }).dirty = true; await service.save();
    const totalMs = Math.round(performance.now() - started), after = await service.status();
    assert(after.lines === before.lines && after.products === before.products && after.customers === before.customers, "First change altered row counts");
    assert(BigInt(after.auditEntries) === BigInt(before.auditEntries) + BigInt(1) && (await service.verify()).valid, "First change was not audited");
    await service.lock(); await service.unlock(secret);
    const saved = (await service.engine!.conn.query("SELECT description FROM products WHERE product_id='1'")).toArray()[0];
    assert(saved.description === "Synthetic first-change measurement" && (await service.verify()).valid, "First change did not survive encrypted reopen");
    return { rows: String(rows), warmupMs, readDuringWarmupMs, postWarmupFirstChangeMs: totalMs, underTwoSeconds: totalMs < 2000, overTenSeconds: totalMs > 10000, rowCountsUnchanged: true, auditedAndDurable: true };
  } finally { await service.lock(); }
}
const noop = () => undefined, signal = () => new AbortController().signal;
async function rowsOf(service: VaultService, sql: string) { return (await service.engine!.conn.query(sql)).toArray().map(r => ({ ...r })) as Record<string, unknown>[]; }
async function warmup() {
  const scope = { userId: "test-" + crypto.randomUUID(), tenantId: "test-" + crypto.randomUUID() };
  const service = new VaultService(() => undefined); await service.init(scope); await service.create(secret, "starter");
  await service.studioAdd(fx.monthlyCsvs().slice(0, 2).map(fx.toFile)); await service.studioPlan(signal(), noop); await service.studioCommit(false, noop); await service.lock();
  const status = await service.unlock(secret);
  assert(!service.engine!.writable && status.state === "unlocked", "Unlock should return before the background copy finishes");
  // An import started during warm-up waits for it instead of failing.
  await service.studioAdd([fx.toFile(fx.monthlyCsvs()[2])]); await service.studioPlan(signal(), noop);
  const committed = await service.studioCommit(false, noop);
  assert(committed.status.lines === "30" && committed.status.writable && !committed.status.preparing, "Import during warm-up did not commit after the copy");
  await service.lock();
  // A failed background copy falls back to the synchronous copy on first change.
  const original = duckdb.AsyncDuckDB.prototype.connect; let calls = 0;
  duckdb.AsyncDuckDB.prototype.connect = async function (this: duckdb.AsyncDuckDB) { if (++calls === 2) throw new Error("simulated warm-up connection failure"); return original.call(this); };
  try {
    await service.unlock(secret);
    assert(await service.warmup() === false && !(await service.status()).preparing, "Simulated warm-up failure was not reported as settled");
  } finally { duckdb.AsyncDuckDB.prototype.connect = original; }
  await service.studioAdd([fx.toFile(fx.monthlyCsvs()[3])]); await service.studioPlan(signal(), noop);
  const fallback = await service.studioCommit(false, noop);
  assert(fallback.status.lines === "40" && (await service.verify()).valid, "Synchronous fallback after a failed warm-up did not commit");
  await service.lock(); await reset(scope);
  return { importDuringWarmupWaits: true, warmupFailureFallsBack: true };
}
/** Measurement: 1M-line CSV through the full studio path (convert, stage, validate, commit, encrypted save). */
async function studioBenchmark(rows: number) {
  assert(rows === 1_000_000, "benchmark scope");
  const scope = { userId: "bench-" + crypto.randomUUID(), tenantId: "bench-" + crypto.randomUUID() };
  const service = new VaultService(() => undefined); await service.init(scope); await service.create(secret, "professional");
  const parts = [fx.SALES_HEADER.join(",") + "\n"];
  for (let i = 1; i <= rows; i++) parts.push(`${i},P-${i % 90000},C-${i % 2000},2025-${String(1 + i % 12).padStart(2, "0")}-${String(1 + i % 28).padStart(2, "0")},${1 + i % 5},${100 + i % 997}.50,${i % 21}.00,1.25,0.00,${60 + i % 991}.10\n`);
  const file = new File(parts, "synthetic-1m.csv"); parts.length = 0;
  try {
    const t0 = performance.now(); await service.studioAdd([file]); const addMs = Math.round(performance.now() - t0);
    const t1 = performance.now(); const plan = (await service.studioPlan(signal(), noop)).report!; const planMs = Math.round(performance.now() - t1);
    const t2 = performance.now(); const out = await service.studioCommit(false, noop); const commitMs = Math.round(performance.now() - t2);
    assert(plan.loaded === String(rows) && out.status.lines === String(rows), "1M studio import incomplete");
    return { rows: String(rows), bytes: String(file.size), addMs, convertStageValidateMs: planMs, commitAndEncryptedSaveMs: commitMs, totalMs: addMs + planMs + commitMs, parseAndLoadUnder10s: addMs + planMs < 10000 };
  } finally { await service.lock(); await reset(scope); }
}
async function studio() {
  const scope = { userId: "test-" + crypto.randomUUID(), tenantId: "test-" + crypto.randomUUID() };
  const service = new VaultService(() => undefined); await service.init(scope); await service.create(secret, "professional");
  const result: Record<string, unknown> = {};
  const audited = async (step: string) => assert((await service.verify()).valid, `Audit chain invalid after ${step}`);
  // 1. Twelve monthly CSVs plus one XLSX, combined with source tracking.
  const monthly = fx.monthlyCsvs();
  let state = await service.studioAdd([...monthly.map(fx.toFile), fx.toFile(fx.salesXlsx())]);
  assert(state.files.length === 13 && state.files.every(f => f.role === "sales_history" && f.loadable), "Thirteen sales files were not detected as loadable sales history");
  const xlsx = state.files.find(f => f.kind === "xlsx")!;
  assert(xlsx.headerRowNumber === 3 && xlsx.sheets.join() === "Q1 2026,Notes", "XLSX header row or sheet list not detected");
  state = await service.studioPlan(signal(), noop);
  let report = state.report!;
  assert(report.loaded === "130" && report.rejected === "0" && report.files.length === 13, `Combined batch report wrong: ${report.loaded}/${report.rejected}`);
  assert(report.files.find(f => f.name.endsWith(".xlsx"))!.rowsSkipped === "2", "XLSX total and footer rows were not skipped");
  assert(!report.warnings.some(w => /overlap/.test(w)), "Monthly files should not overlap");
  let out = await service.studioCommit(false, noop);
  assert(out.status.lines === "130" && out.status.products === "7" && out.status.customers === "3", "Combined import counts wrong");
  const bySource = await rowsOf(service, "SELECT s.name, count(*)::VARCHAR AS n, min(l.source_row)::VARCHAR AS first, max(l.source_row)::VARCHAR AS last FROM sales_lines l JOIN source_files s ON s.id=l.source_id GROUP BY s.name ORDER BY s.name");
  assert(bySource.length === 13 && bySource.every(r => r.n === "10"), "Each source should keep exactly its ten rows");
  const x = bySource.find(r => String(r.name).endsWith(".xlsx"))!, c = bySource.find(r => r.name === "sales-2025-01.csv")!;
  assert(x.first === "4" && x.last === "13" && c.first === "2" && c.last === "11", "Source rows do not point at the original sheet/file rows");
  await audited("combined import");
  result.combined = { files: 13, rows: 130, sourceRowsExact: true };
  // 2. Re-importing a file: every row already exists, the file looks identical, and dates overlap.
  state = await service.studioAdd([fx.toFile(monthly[0])]); report = (await service.studioPlan(signal(), noop)).report!;
  assert(report.loaded === "0" && report.rejected === "10" && report.files[0].issues[0].message.startsWith("Already loaded"), "Duplicate file was not rejected row by row");
  assert(report.warnings.some(w => /looks identical/.test(w)) && report.warnings.some(w => /overlaps the dates/.test(w)), "Duplicate-file or overlap warning missing");
  let failed = false; try { await service.studioCommit(true, noop); } catch { failed = true; }
  assert(failed, "A batch with no valid rows must not commit"); await service.studioClear();
  // 3. Row-level validation, in-batch duplicates and the explicit rejection acknowledgement.
  const messy = fx.csv([fx.SALES_HEADER, ["900001", "P-1", "C-1", "2026-01-02", "1", "10.00", "0.00", "0.00", "0.00", "5.00"], ["900001", "P-1", "C-1", "2026-01-02", "1", "10.00", "0.00", "0.00", "0.00", "5.00"],
    ["900002", "P-1", "C-1", "2026-01-02", "1", "10.00", "0.00", "0.00", "0.00", "5.00"], ["900002", "P-2", "C-1", "2026-01-02", "1", "10.00", "0.00", "0.00", "0.00", "5.00"],
    ["900003", "P-1", "C-1", "2026-02-30", "1", "12.345", "0.00", "0.00", "0.00", "5.00"], ["900004", "", "C-1", "2026-01-02", "1", "1,000.00", "0.00", "0.00", "0.00", "5.00"], ["Total", "", "", "", "", "40.00"]]);
  state = await service.studioAdd([new File([messy], "messy-checks.csv")]); report = (await service.studioPlan(signal(), noop)).report!;
  const issues = report.files[0].issues, has = (row: number, column: string, start: string) => issues.some(i => i.row === row && i.column === column && i.message.startsWith(start));
  assert(report.loaded === "2" && report.rejected === "4" && report.files[0].rowsSkipped === "1", `Validation counts wrong: ${report.loaded}/${report.rejected}`);
  assert(has(3, "", "Exact copy") && has(5, "", "Repeats the key") && has(6, "D", "Use a real date in YYYY-MM-DD") && has(7, "B", "product_id is required"), `Issue locations wrong: ${issues.map(i => `${i.row}:${i.column}`).join(" | ")}`);
  failed = false; try { await service.studioCommit(false, noop); } catch (e) { failed = /Confirm that rejected rows/.test((e as Error).message); }
  assert(failed, "Rejected rows must need an explicit acknowledgement");
  out = await service.studioCommit(true, noop);
  assert(out.status.lines === "132", "Acknowledged partial import did not load exactly the valid rows");
  const stored = await rowsOf(service, "SELECT count(*)::VARCHAR AS n FROM import_issues i JOIN source_files s ON s.id=i.source_id WHERE s.name='messy-checks.csv'");
  assert(stored[0].n === "4", "Every rejected row must be stored as an open issue");
  await audited("partial import");
  result.validation = { loaded: 2, rejected: 4, skipped: 1, issuesStored: 4 };
  // 4. Removing a source removes exactly its rows; others are untouched.
  let sources = await service.sources();
  const march = sources.find(s => s.name === "sales-2025-03.csv")!, before = await rowsOf(service, "SELECT source_id, count(*)::VARCHAR AS n FROM sales_lines GROUP BY source_id ORDER BY source_id");
  const removed = await service.sourceRemove(march.id);
  const after = await rowsOf(service, "SELECT source_id, count(*)::VARCHAR AS n FROM sales_lines GROUP BY source_id ORDER BY source_id");
  assert(removed.status.lines === "122" && removed.cleanup, "Remove did not delete exactly ten rows");
  assert(JSON.stringify(after) === JSON.stringify(before.filter(r => r.source_id !== march.id)), "Removing one source changed other sources");
  assert((await rowsOf(service, `SELECT count(*)::VARCHAR AS n FROM source_files WHERE id='${march.id}'`))[0].n === "0", "Removed source record remains");
  await audited("remove");
  // 5. Replace: the April file's rows are swapped for a corrected five-row version in one step.
  const april = sources.find(s => s.name === "sales-2025-04.csv")!;
  state = await service.studioAdd([new File([fx.csv([fx.SALES_HEADER, ...fx.salesRows(4000, 5, "2025-04")])], "sales-2025-04-corrected.csv")], april.id);
  report = (await service.studioPlan(signal(), noop)).report!;
  assert(report.replaces === april.id && report.loaded === "5" && !report.warnings.some(w => /overlaps the dates of sales-2025-04.csv/.test(w)), "Replacement plan wrong (its own old rows must not count as duplicates)");
  out = await service.studioCommit(false, noop);
  sources = await service.sources();
  assert(out.status.lines === "117" && !sources.some(s => s.id === april.id) && sources.some(s => s.name === "sales-2025-04-corrected.csv" && s.rowsLoaded === "5"), "Replace did not swap exactly the old rows");
  await audited("replace");
  result.removeReplace = { removedRows: 10, replacedRows: "10 -> 5" };
  // 6. XLS item master, ODS customers, XLSB vendor costs, JSON prices and XML rebates in one batch.
  state = await service.studioAdd([fx.itemMasterXls(), fx.customersOds(), fx.vendorXlsb(), fx.priceJson(), fx.rebateXml()].map(fx.toFile));
  // The JSON's nested "terms.qty_break" is a partial match for qty_break, so it must be confirmed.
  const priceFile = state.files.find(f => f.kind === "json")!;
  assert(priceFile.needsConfirmation && priceFile.fields.find(m => m.field === "qty_break")!.header === "terms.qty_break", "Partial header match should be suggested and need confirmation");
  state = await service.studioUpdate(priceFile.id, {}, undefined, { confirmed: true });
  const roles = Object.fromEntries(state.files.map(f => [f.kind, f.role]));
  assert(roles.xls === "item_master" && roles.ods === "customer_list" && roles.xlsb === "vendor_cost" && roles.json === "price_list" && roles.xml === "rebate_agreement", `Role detection wrong: ${JSON.stringify(roles)}`);
  report = (await service.studioPlan(signal(), noop)).report!;
  assert(report.loaded === "9" && report.rejected === "2" && report.warnings.some(w => /Confirm the calculation mode/.test(w)), `Mixed batch report wrong: ${report.loaded}/${report.rejected}`);
  out = await service.studioCommit(true, noop);
  assert((await service.rebateState()).programs.length===0&&(await service.fixGroups()).some(g=>g.role==='rebate_agreement'&&g.code==='calculation_mode:invalid'),'Old six-column terms must stay in Fix Later, not activate with guessed treatment');
  const p1 = (await rowsOf(service, "SELECT description, uom, current_cost::VARCHAR AS cost, list_price::VARCHAR AS price, source_id IS NOT NULL AS owned FROM products WHERE product_id='P-1'"))[0];
  assert(p1.description === "Brass gate valve 1in" && p1.cost === "6120" && p1.price === "12550" && p1.owned === true, "Item master did not update the derived product exactly");
  assert(out.status.products === "8" && out.status.customers === "3", "Item master or customer counts wrong");
  const loadedRows = (await rowsOf(service, "SELECT (SELECT count(*) FROM vendor_costs)::VARCHAR AS v, (SELECT count(*) FROM price_matrix)::VARCHAR AS p, (SELECT name FROM customers WHERE customer_id='C-1') AS c1, (SELECT string_agg(price::VARCHAR, ',' ORDER BY price) FROM price_matrix) AS prices"))[0];
  assert(loadedRows.v === "2" && loadedRows.p === "2" && loadedRows.c1 === "Harbor Mechanical" && loadedRows.prices === "11990,12200", "Vendor, price or customer rows wrong");
  // Removing the item master resets P-1 (still sold) and deletes P-99 (never sold).
  const items = (await service.sources()).find(s => s.name === "item-master.xls")!;
  out = { ...out, status: (await service.sourceRemove(items.id)).status };
  const reset1 = (await rowsOf(service, "SELECT description, current_cost IS NULL AS blank, source_id IS NULL AS derived FROM products WHERE product_id='P-1'"))[0];
  assert(reset1.description === "" && reset1.blank === true && reset1.derived === true && out.status.products === "7", "Item master removal did not restore the derived products exactly");
  await audited("mixed formats and item removal");
  result.formats = { xls: true, ods: true, xlsb: true, json: true, xml: "missing mode/treatment in Fix Later" };
  // 7. Windows-1252 and UTF-16 text.
  state = await service.studioAdd([fx.customers1252(), fx.salesUtf16()].map(fx.toFile));
  const enc = Object.fromEntries(state.files.map(f => [f.name, `${f.settings.encoding}/${f.settings.delimiter}/${f.role}`]));
  assert(enc["customers-1252.txt"] === "windows-1252/;/customer_list" && enc["sales-utf16.csv"] === "utf-16le/,/sales_history", `Encoding detection wrong: ${JSON.stringify(enc)}`);
  const encodedPlan = (await service.studioPlan(signal(), noop)).report!; out = await service.studioCommit(false, noop);
  const c3 = (await rowsOf(service, "SELECT name FROM customers WHERE customer_id='C-3'"))[0]?.name;
  assert(c3 === "Café Supply" && out.status.lines === "120", `Encoded files did not load exactly: lines=${out.status.lines} report=${JSON.stringify(encodedPlan.files.map(f => [f.name, f.rowsLoaded, f.rowsRejected]))}`);
  await audited("encoded files");
  // 8. Conversion trio: XLSX, TSV and a BOM/semicolon/comma-decimal file give identical clean CSV.
  const trio = fx.conversionTrio();
  state = await service.studioAdd([trio.semicolon, trio.tsv, trio.xlsx].map(fx.toFile));
  const semi = state.files.find(f => f.name === trio.semicolon.name)!;
  assert(semi.settings.delimiter === ";" && semi.settings.decimal === "comma" && semi.settings.dateFormat === "DD.MM.YYYY", "Semicolon file settings not detected");
  const texts = await Promise.all(state.files.map(async f => (await service.studioDownload(f.id, signal())).blob.text()));
  assert(texts[0] === texts[1] && texts[1] === texts[2] && texts[0].startsWith('"line_id","product_id"') && texts[0].includes('"125.50"') && texts[0].includes('"2026-03-01"'), "Converted CSVs differ");
  const zip = await JSZip.loadAsync(await (await service.studioZip(signal())).blob.arrayBuffer());
  assert(Object.keys(zip.files).sort().join() === "messy (2).csv,messy-semicolon.csv,messy.csv", `ZIP names wrong: ${Object.keys(zip.files).join()}`);
  // 9. Converter recipe: saved once, applied automatically to a file with the same headers.
  await service.recipeSave(semi.id, "Synthetic ERP semicolon export"); await audited("recipe save"); await service.studioClear();
  const tweaked = new File([trio.semicolon.bytes as Uint8Array<ArrayBuffer>], "next-month.csv");
  state = await service.studioAdd([tweaked]);
  assert(state.files[0].appliedRecipe === "Synthetic ERP semicolon export" && state.recipes.length === 1, "Recipe was not applied to a matching file");
  await service.studioClear();
  assert((await service.verify()).valid, "Audit chain invalid after studio operations");
  const audit = await rowsOf(service, "SELECT action, count(*)::VARCHAR AS n FROM audit_log GROUP BY action ORDER BY action");
  result.audit = Object.fromEntries(audit.map(a => [a.action, a.n]));
  await service.lock(); await service.unlock(secret);
  // 13 + messy-checks - March + (April replaced) + 5 mixed (including rejected agreement) - item master + 2 encoded = 19 sources.
  assert((await service.status()).lines === "120" && (await service.sources()).length === 19, "Studio results did not survive encrypted reopen");
  await service.lock(); await reset(scope);
  return result;
}
async function mapper() {
  const scope = { userId: "test-" + crypto.randomUUID(), tenantId: "test-" + crypto.randomUUID() };
  const service = new VaultService(() => undefined); await service.init(scope); await service.create(secret, "professional");
  const q = (sql: string) => rowsOf(service, sql), result: Record<string, unknown> = {};
  let state = await service.studioAdd([fx.toFile(fx.retailLike())]);
  let file = state.files[0];
  assert(file.role === "sales_history" && file.erp === "generic" && file.settings.dateFormat === "MM/DD/YYYY", `Retail-like export detected wrongly: ${file.role}/${file.erp}/${file.settings.dateFormat}`);
  assert(file.needsConfirmation && !file.confirmed && !file.loadable, "An inferred mapping must be confirmed before import");
  let blocked = false; try { await service.studioPlan(signal(), noop); } catch (e) { blocked = /confirm it/.test((e as Error).message); }
  assert(blocked, "Planning must refuse an unconfirmed mapping");
  state = await service.studioUpdate(file.id, {}, undefined, { confirmed: true }); file = state.files[0];
  assert(file.loadable, "Confirmed mapping should be loadable");
  const report = (await service.studioPlan(signal(), noop)).report!, rep = report.files[0];
  // 20 good + 2 blank customers + 1 cancellation + 2 duplicates = 25 rows.
  assert(rep.rowsRead === "25" && report.loaded === "20" && report.rejected === "5", `Retail-like counts wrong: ${rep.rowsRead}/${report.loaded}/${report.rejected}`);
  const notes = rep.cleaned.map(c => `${c.field}:${plainText(c.note)}`); // notes are message references (7U)
  assert(notes.includes("sale_date:dropped the time of day") && notes.includes("sale_date:expanded two-digit years") && notes.some(n => n.startsWith("list_amount:removed currency")), `Cleanup notes missing: ${notes.join(" | ")}`);
  await service.studioCommit(true, noop);
  const line = (await q("SELECT invoice_id, product_id, sale_date::VARCHAR AS d, quantity::VARCHAR AS qty, list_cents::VARCHAR AS list, discount_cents::VARCHAR AS disc, cost_cents IS NULL AS no_cost FROM sales_lines WHERE source_row=2"))[0];
  assert(line.invoice_id === "536365" && line.d === "2010-12-01" && line.qty === "1.0000" && line.list === "255" && line.disc === "0" && line.no_cost === true, `First line loaded wrongly: ${JSON.stringify(line)}`);
  const big = (await q("SELECT list_cents::VARCHAR AS list FROM sales_lines WHERE source_row=4"))[0];
  assert(big.list === "382500", "$1,275.00 x 3 should be exactly 3,825.00");
  const tiny = (await q("SELECT list_cents::VARCHAR AS list FROM sales_lines WHERE source_row=5"))[0];
  assert(tiny.list === "170", "0.425 x 4 should round to 1.70");
  // Fix Later: three groups; bulk-fix blank customers, re-check only that group.
  let groups = await service.fixGroups();
  const byCode = Object.fromEntries(groups.map(g => [g.code, g]));
  assert(byCode["customer_id:required"]?.count === "2" && byCode["quantity:negative"]?.count === "1" && byCode["duplicate_row"]?.count === "2", `Fix Later groups wrong: ${groups.map(g => g.code + "=" + g.count).join()}`);
  const rows = await service.fixRows(byCode["customer_id:required"].sourceId, "customer_id:required");
  assert(rows.length === 2 && rows[0].values.find(v => v.field === "customer_id")!.value === "", "Rejected rows should keep their cleaned values");
  await service.fixSet(byCode["customer_id:required"].sourceId, "customer_id:required", "customer_id", "CASH-SALE");
  const re = await service.fixRecheck(byCode["customer_id:required"].sourceId, "customer_id:required");
  assert(re.loaded === "2" && re.status.lines === "22" && re.groups.some(g => g.code === "duplicate_row" && g.count === "2"), "Re-check must load only the fixed group and leave duplicates alone");
  assert((await q("SELECT count(*)::VARCHAR AS n FROM sales_lines WHERE customer_id='CASH-SALE'"))[0].n === "2", "Fixed rows not loaded under CASH-SALE");
  assert((await q("SELECT count(*)::VARCHAR AS n FROM import_issues WHERE status='open'"))[0].n === "3", "Issues of loaded rows should be gone");
  const dismissed = await service.fixDismiss(byCode["quantity:negative"].sourceId, "quantity:negative");
  assert(!dismissed.groups.some(g => g.code === "quantity:negative") && dismissed.status.lines === "22", "Dismiss should remove the group without loading it");
  groups = await service.fixGroups();
  const health = await service.health();
  assert(health.components.find(c => c.key === "cost")!.score === 0 && health.components.find(c => c.key === "complete")!.score === 92 && health.score !== null, `Health wrong: ${JSON.stringify(health.components.map(c => [c.key, c.score]))}`);
  result.health = { score: health.score, components: health.components.map(c => `${c.key}=${c.score}`) };
  // Recipe keeps the confirmed mapping and applies it, confirmed, to the next export.
  state = await service.studioAdd([new File([fx.retailLike("", 8).bytes as Uint8Array<ArrayBuffer>], "next-month.csv")]);
  state = await service.studioUpdate(state.files[0].id, {}, undefined, { confirmed: true });
  await service.recipeSave(state.files[0].id, "UK web shop export"); await service.studioClear();
  state = await service.studioAdd([new File([fx.retailLike("", 8).bytes as Uint8Array<ArrayBuffer>], "month-3.csv")]);
  assert(state.files[0].appliedRecipe === "UK web shop export" && state.files[0].confirmed && state.files[0].loadable, "Recipe mapping should apply as confirmed");
  await service.studioClear();
  // Removing the source clears its Fix Later rows too.
  const src = (await service.sources())[0];
  await service.sourceRemove(src.id);
  assert((await q("SELECT count(*)::VARCHAR AS n FROM rejected_rows"))[0].n === "0" && (await service.status()).lines === "0", "Removing a source must remove its Fix Later rows");
  assert((await service.verify()).valid, "Audit chain invalid after mapper/Fix Later operations");
  await service.lock(); await reset(scope);
  return result;
}
async function playground() {
  const scope = { userId: "test-" + crypto.randomUUID(), tenantId: "test-" + crypto.randomUUID() };
  const service = new VaultService(() => undefined); await service.init(scope); await service.create(secret, "starter");
  const t0 = performance.now(), out = await service.playgroundLoad(noop), loadMs = Math.round(performance.now() - t0);
  assert(out.status.lines === "120000" && out.status.products === "5000" && out.status.customers === "400", `Playground counts wrong: ${out.status.lines}/${out.status.products}/${out.status.customers}`);
  assert(out.manifest.leaks.length === 5 && (await service.sources()).length === 5, "Playground manifest or sources wrong");
  const sums = (await rowsOf(service, "SELECT (SELECT count(*) FROM vendor_costs)::VARCHAR AS v, (SELECT count(*) FROM price_matrix)::VARCHAR AS p, (SELECT count(*) FROM rejected_rows)::VARCHAR AS r, (SELECT count(DISTINCT tier) FROM customers)::VARCHAR AS tiers"))[0];
  assert(sums.v === "5020" && sums.p === "200" && sums.r === "0" && sums.tiers === "50", `Playground tables wrong: ${JSON.stringify(sums)}`);
  // Planted leak L3 is recomputed from the vault: flat $15.00 freight on lines under $100 list.
  const l3 = (await rowsOf(service, "SELECT count(*)::VARCHAR AS n, sum(freight_cents)::VARCHAR AS c FROM sales_lines WHERE list_cents < 10000"))[0];
  const m3 = out.manifest.leaks.find(l => l.type === "unrecovered_freight")!;
  assert(l3.n === String(m3.lines) && l3.c === m3.cents, `L3 does not reconcile with the manifest: ${l3.n}/${l3.c} vs ${m3.lines}/${m3.cents}`);
  const health = await service.health();
  assert(health.components.find(c => c.key === "cost")!.score === 100 && health.components.find(c => c.key === "customers")!.score === 100, "Playground should be fully costed and tiered");
  let refused = false; try { await service.playgroundLoad(noop); } catch { refused = true; }
  assert(refused, "Loading the Playground twice must be refused");
  const removed = await service.playgroundRemove();
  assert(removed.removed === "5" && removed.status.lines === "0" && removed.status.products === "0" && removed.status.customers === "0", "Playground removal incomplete");
  await service.studioAdd([fx.toFile(fx.monthlyCsvs()[0])]); await service.studioPlan(signal(), noop); await service.studioCommit(false, noop);
  refused = false; try { await service.playgroundLoad(noop); } catch (e) { refused = /without your own files/.test((e as Error).message); }
  assert(refused, "The Playground must never mix with real files");
  assert((await service.verify()).valid, "Audit chain invalid after Playground");
  await service.lock(); await reset(scope);
  return { loadMs, under10s: loadMs < 10000, leaks: out.manifest.leaks.map(l => `${l.id}:${l.lines}:${l.dollars}`), health: health.score };
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)] * 10) / 10; };
async function timed<T>(n: number, work: () => Promise<T>) { const ms: number[] = []; let last: T | undefined; for (let i = 0; i < n; i++) { const t = performance.now(); last = await work(); ms.push(performance.now() - t); } return { medianMs: median(ms), maxMs: Math.round(Math.max(...ms) * 10) / 10, last: last! }; }
/** Chunk 4D: margin engine v2 in real DuckDB-Wasm, reconciliation, the Playground leak manifest, credits, whale gating and the PDF. */
async function margin() {
  const Z = BigInt(0), n = (v: unknown) => BigInt(String(v ?? "0"));
  const scope = { userId: "test-" + crypto.randomUUID(), tenantId: "test-" + crypto.randomUUID() };
  const service = new VaultService(() => undefined); await service.init(scope); await service.create(secret, "professional");
  const result: Record<string, unknown> = {};
  const out = await service.playgroundLoad(noop), manifest = out.manifest;
  assert((await service.status()).schemaVersion === "17", "New vaults must be schema v17");
  // 1. The waterfall equals the imported lines recomputed one by one with the JS engine.
  const raw = await rowsOf(service, "SELECT invoice_id, customer_id, strftime(sale_date, '%Y-%m') AS m, list_cents::VARCHAR AS l, discount_cents::VARCHAR AS d, rebate_cents::VARCHAR AS r, freight_cents::VARCHAR AS f, cost_cents::VARCHAR AS c, line_kind AS k FROM sales_lines");
  let list = Z, discount = Z, rebate = Z, freight = Z, pocket = Z, costedPocket = Z, cost = Z, marginJs = Z;
  const byInvoice = new Map<string, bigint>(), byCm = new Map<string, bigint>();
  for (const x of raw) {
    const w = lineFromCents({ list: n(x.l), discount: n(x.d), rebate: n(x.r), freight: n(x.f), cost: x.c === null ? null : n(x.c) });
    list += n(x.l); discount += n(x.d); rebate += n(x.r); freight += n(x.f); pocket += w.pocket;
    if (w.margin !== null) { costedPocket += w.pocket; cost += n(x.c); marginJs += w.margin; }
    byInvoice.set(String(x.invoice_id), (byInvoice.get(String(x.invoice_id)) ?? Z) + w.pocket);
    byCm.set(`${x.customer_id}|${x.m}`, (byCm.get(`${x.customer_id}|${x.m}`) ?? Z) + w.pocket);
  }
  const w = await service.marginWaterfall();
  assert(w.sales.list === String(list) && w.sales.discount === String(discount) && w.sales.rebate === String(rebate) && w.sales.freight === String(freight), "Waterfall components differ from the imported lines");
  assert(w.netPocket === String(pocket) && w.costedPocket === String(costedPocket) && w.cost === String(cost) && w.margin === String(marginJs) && w.uncostedLines === "0" && w.credits.lines === "0", "Waterfall pocket/margin differ from the JS engine");
  // Per invoice and per customer x month: SQL sums from the pre-aggregate / lines equal the JS engine to the cent.
  const sqlInvoice = await rowsOf(service, `SELECT invoice_id, sum(list_cents - discount_cents - rebate_cents - freight_cents)::VARCHAR AS p FROM sales_lines GROUP BY invoice_id`);
  assert(sqlInvoice.length === byInvoice.size && sqlInvoice.every(r => byInvoice.get(String(r.invoice_id)) === n(r.p)), "Per-invoice pocket differs between SQL and JS");
  const aggCm = await rowsOf(service, `SELECT customer_id || '|' || strftime(month, '%Y-%m') AS k, (sum(list_cents) - sum(discount_cents) - sum(rebate_cents) - sum(freight_cents))::VARCHAR AS p FROM agg_cpm GROUP BY 1`);
  assert(aggCm.length === byCm.size && aggCm.every(r => byCm.get(String(r.k)) === n(r.p)), "Pre-aggregate customer x month pocket differs from the JS engine");
  const recon = await service.reconcile();
  assert(recon.reconciled && recon.open.length === 0 && recon.invoices === String(byInvoice.size), `Playground should reconcile: ${JSON.stringify(recon.open.slice(0, 3))}`);
  result.reconciled = { invoices: recon.invoices, customerMonths: recon.customerMonths, lines: recon.lines };
  // 2. Drill-downs and show-me-the-math.
  const branch = await service.marginDrill("branch");
  assert(branch.rows.length === 3 && branch.rows.reduce((s, r) => s + n(r.pocket), Z) === pocket && branch.rows.reduce((s, r) => s + n(r.margin), Z) === marginJs, "Branch drill does not add up to the waterfall");
  const products = await service.marginDrill("product", undefined, "margin");
  assert(products.total === "5000" && products.rows.length === 100, "Product drill size wrong");
  const worst = products.rows[0], one = await service.marginWaterfall({ by: [{ dim: "product", value: worst.key }] });
  assert(one.margin === worst.margin && one.netPocket === worst.pocket, "Drilled product row differs from its own waterfall");
  const cat = await service.marginDrill("category", { by: [{ dim: "branch", value: "North" }] });
  const north = await service.marginWaterfall({ by: [{ dim: "branch", value: "North" }] });
  assert(cat.rows.reduce((s, r) => s + n(r.pocket), Z) === n(north.netPocket), "Category drill within a branch does not add up");
  const metrics = ["list", "discount", "rebate", "freight", "salesPocket", "credits", "netPocket", "uncostedPocket", "costedPocket", "cost", "margin", "rate", "lines"] as const;
  for (const m of metrics) {
    const p = await service.marginMath(m, { by: [{ dim: "branch", value: "North" }, { dim: "category", value: "Valves" }] });
    assert(p.check.agrees && p.rowsAgree, `Show-the-math for ${m} does not reconcile: ${p.value} vs engine ${p.check.engine} vs rows ${p.rowsSum}`);
    assert(p.rows.every(r => r.sourceFile.startsWith("Playground - ") && Number(r.sourceRow) >= 2), `Math rows for ${m} lack source file/row`);
  }
  result.math = metrics.length;
  // 3. Leak finder reproduces every planted leak exactly, by type, scope, lines and cents.
  const t0 = performance.now(), view = await service.leaks(), leakMs = Math.round(performance.now() - t0);
  const found = view.result.findings, reproduced: string[] = [];
  for (const leak of manifest.leaks) {
    const match = found.filter(f => f.type === leak.type && f.lines === String(leak.lines) && f.cents === leak.cents);
    assert(match.length === 1, `Planted leak ${leak.id} (${leak.type}, ${leak.lines} lines, ${leak.cents} cents) not found exactly. Findings: ${found.map(f => `${f.id}:${f.lines}:${f.cents}`).join("; ")}`);
    const f = match[0], scopeOk = leak.type === "below_floor" ? f.scope.customer === "C-0007" && f.scope.category === "Valves" : leak.type === "discount_outlier" ? f.scope.customer === "C-0042"
      : leak.type === "below_lower_tier" ? f.scope.customer === "C-0123" && f.scope.billedAs === "T05" && f.scope.tier === "T40" : leak.type === "negative_margin" ? f.id === "negative_margin|cost_rise" : f.id === "unrecovered_freight|small_lines";
    assert(scopeOk, `Planted leak ${leak.id} matched the wrong scope: ${f.id}`);
    // Every evidence row recomputed by the JS engine.
    const hits = await hitRows(service.engine!, f.id); let sum = Z;
    for (const h of hits) {
      const lw = lineFromCents({ list: n(h.list), discount: n(h.discount), rebate: n(h.rebate), freight: n(h.freight), cost: h.cost === null ? null : n(h.cost) });
      const js = h.type === "unrecovered_freight" ? n(h.freight) : h.type === "negative_margin" ? -(lw.margin ?? Z) : n(h.discount) - rha(n(h.list) * n(h.basis), BigInt(10000));
      assert(String(js) === String(h.leak), `JS engine disagrees on ${f.id} line ${h.line_id}`); sum += js;
    }
    assert(String(sum) === leak.cents && hits.length === leak.lines, `${leak.id} evidence does not sum to the manifest`);
    const ev = await service.leakRows(f.id);
    assert(ev.engineAgrees && ev.count === String(leak.lines) && ev.rows.every(r => r.sourceFile.startsWith("Playground - ")), `${leak.id} evidence rows incomplete`);
    reproduced.push(`${leak.id}:${f.id}:${f.lines}:${f.cents}`);
  }
  assert(!found.some(f => (f.type as string) === "" || n(f.cents) <= Z), "Every finding needs a positive dollar amount");
  result.leaks = { reproduced, findings: found.map(f => `${f.id}:${f.lines}:${f.cents}`), totalCents: view.result.totalCents, dedupedCents: view.result.dedupedCents, overlapLines: view.result.overlapLines, leakMs };
  // 4. ROI v1: Playground findings are recorded as sample and never count toward the real total.
  assert(view.sample && view.roi.identifiedCents === "0" && view.roi.sampleCents === view.result.totalCents && view.recorded === found.length, `ROI ledger wrong: ${JSON.stringify(view.roi)}`);
  assert((await service.leaks()).recorded === 0, "A repeated leak run must not add ledger rows");
  // 5. Leak Report PDF, built in the worker.
  const t1 = performance.now(), rep = await service.leakReport(), pdfMs = Math.round(performance.now() - t1), text = await rep.blob.text();
  assert(text.startsWith("%PDF-1.4") && text.trimEnd().endsWith("%%EOF") && text.includes("Margin Leak Report") && text.includes("SAMPLE DATA"), "Leak Report PDF malformed");
  for (const leak of manifest.leaks) assert(text.includes("$" + moneyText(leak.cents)), `Leak Report lacks ${leak.id} dollars`);
  result.pdf = { bytes: rep.bytes, ms: pdfMs, name: rep.name };
  // 6. Whale curve on Professional.
  const whaleView = await service.marginWhale();
  const buyers = (await rowsOf(service, "SELECT count(DISTINCT customer_id)::VARCHAR AS n FROM sales_lines"))[0].n;
  assert(whaleView.available && whaleView.customers === buyers && n(whaleView.totalMargin) === marginJs && whaleView.points[whaleView.points.length - 1].x === 100, `Whale curve wrong: ${whaleView.customers} vs ${buyers} customers, ${whaleView.totalMargin} vs ${marginJs}`);
  result.whale = { customers: whaleView.customers, losers: whaleView.losers, peakPct: whaleView.peakPct };
  // 7. Reconciliation differences become issues; nothing is adjusted silently.
  const e = service.engine!, before = (await rowsOf(service, "SELECT sum(list_cents)::VARCHAR AS l FROM sales_lines"))[0].l;
  await e.conn.query("UPDATE agg_cpm SET list_cents = list_cents + 1 WHERE customer_id = 'C-0007' AND month = (SELECT min(month) FROM agg_cpm WHERE customer_id = 'C-0007') AND product_id = (SELECT min(product_id) FROM agg_cpm WHERE customer_id = 'C-0007' AND month = (SELECT min(month) FROM agg_cpm WHERE customer_id = 'C-0007'))");
  const stale = await service.reconcile();
  assert(!stale.reconciled && stale.open.some(i => i.level === "customer_month" && i.component === "list" && i.scopeKey.startsWith("C-0007|")) && stale.open.some(i => i.level === "total" && i.component === "list"), "Stale pre-aggregate not reported");
  assert((await rowsOf(service, "SELECT sum(list_cents)::VARCHAR AS l FROM sales_lines"))[0].l === before, "Imported lines must never be adjusted");
  const rebuilt = await service.reconRebuild();
  assert(rebuilt.recon.reconciled, "Rebuild should reconcile again");
  const inv = (await rowsOf(service, "SELECT invoice_id, min(line_id)::VARCHAR AS line, any_value(source_id) AS sid FROM sales_lines GROUP BY invoice_id HAVING count(*) > 1 AND min(customer_id) <> 'C-0001' ORDER BY invoice_id LIMIT 1"))[0];
  const original = (await rowsOf(service, `SELECT customer_id FROM sales_lines WHERE source_id = '${inv.sid}' AND line_id = ${inv.line}`))[0].customer_id;
  await e.conn.query(`UPDATE sales_lines SET customer_id = 'C-0001' WHERE source_id = '${inv.sid}' AND line_id = ${inv.line}`);
  const split = await service.reconRebuild(), issue = split.recon.open.find(i => i.level === "invoice" && i.scopeKey === inv.invoice_id);
  assert(issue && issue.component === "customer" && /2 customers/.test(issue.message) && issue.sourceId === inv.sid, "Invoice split across customers not reported");
  const accepted = await service.reconAccept(issue!.id);
  assert(accepted.recon.reconciled && accepted.recon.accepted === "1" && (await service.reconcile()).open.length === 0, "Accepted issue should stay accepted");
  await e.conn.query(`UPDATE sales_lines SET customer_id = '${original}' WHERE source_id = '${inv.sid}' AND line_id = ${inv.line}`);
  assert((await service.reconRebuild()).recon.reconciled, "Restored invoice should reconcile");
  result.reconciliation = { staleAggregateFlagged: true, invoiceSplitFlagged: true, linesUnchanged: true };
  // 8. Timings on the 120k-line Playground (local measurement).
  result.timings = { waterfall: (await timed(7, () => service.marginWaterfall())).medianMs, drillProduct: (await timed(7, () => service.marginDrill("product"))).medianMs,
    drillCustomer: (await timed(7, () => service.marginDrill("customer"))).medianMs, drillBranch: (await timed(7, () => service.marginDrill("branch"))).medianMs };
  // 9. Removing the Playground removes its sample ledger rows and every aggregate.
  await service.playgroundRemove();
  const left = (await rowsOf(service, "SELECT (SELECT count(*) FROM agg_cpm)::VARCHAR AS a, (SELECT count(*) FROM roi_ledger)::VARCHAR AS r"))[0];
  assert(left.a === "0" && left.r === "0", "Playground removal left aggregates or sample ROI rows");
  assert((await service.verify()).valid, "Audit chain invalid after margin operations");
  await service.lock(); await reset(scope);
  result.credits = await credits();
  return result;
}
/** Returns and credits load from Fix Later as signed credit lines; unknown cost stays unknown. Starter tier: no whale curve. */
async function credits() {
  const scope = { userId: "test-" + crypto.randomUUID(), tenantId: "test-" + crypto.randomUUID() };
  const service = new VaultService(() => undefined); await service.init(scope); await service.create(secret, "starter");
  const csv = "line_id,invoice_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount\n"
    + "1,INV-1,P-1,C-1,2025-01-05,10,100.00,10.00,2.00,0.00,60.00\n2,INV-1,P-2,C-1,2025-01-05,5,50.00,0.00,1.00,0.00,\n3,INV-2,P-1,C-2,2025-02-03,2,20.00,2.00,0.50,0.00,12.00\n"
    + "4,CR-1,P-1,C-1,2025-01-20,-3,-30.00,-3.00,0.00,0.00,-18.00\n5,CR-2,P-2,C-2,2025-02-10,-1,-10.00,1.00,0.00,0.00,\n";
  await service.studioAdd([new File([csv], "synthetic-credits.csv")]); await service.studioPlan(signal(), noop);
  const committed = await service.studioCommit(true, noop);
  assert(committed.status.lines === "3", "Sales lines should load; returns wait in Fix Later");
  const group = (await service.fixGroups()).find(g => g.code === "quantity:negative");
  assert(group && group.count === "2" && group.credits, "Negative quantities should wait as a credit-loadable group");
  const loaded = await service.creditsLoad(group!.sourceId);
  assert(loaded.loaded === "1" && loaded.stillRejected === "1" && loaded.status.lines === "4" && loaded.groups.some(g => g.code === "credit:sign" && g.count === "1"), `Credit load wrong: ${JSON.stringify({ ...loaded, status: undefined })}`);
  const row = (await rowsOf(service, "SELECT quantity::VARCHAR AS q, list_cents::VARCHAR AS l, discount_cents::VARCHAR AS d, cost_cents::VARCHAR AS c, line_kind AS k, source_row::VARCHAR AS r FROM sales_lines WHERE line_kind = 'credit'"))[0];
  assert(row.q === "-3.0000" && row.l === "-3000" && row.d === "-300" && row.c === "-1800" && row.r === "5", `Credit line stored wrong: ${JSON.stringify(row)}`);
  const w = await service.marginWaterfall();
  const expect = { list: "17000", discount: "1200", freight: "350", salesPocket: "15450", creditPocket: "-2700", net: "12750", costed: "7850", cost: "5400", margin: "2450", uncostedLines: "1", uncostedPocket: "4900" };
  assert(w.sales.list === expect.list && w.sales.discount === expect.discount && w.sales.freight === expect.freight && w.sales.pocket === expect.salesPocket && w.credits.pocket === expect.creditPocket
    && w.netPocket === expect.net && w.costedPocket === expect.costed && w.cost === expect.cost && w.margin === expect.margin && w.uncostedLines === expect.uncostedLines && w.uncostedPocket === expect.uncostedPocket, `Credit waterfall wrong: ${JSON.stringify(w.steps)}`);
  const m = await service.marginMath("credits");
  assert(m.rows.length === 1 && m.rows[0].kind === "credit" && m.rows[0].sourceRow === "5" && m.check.agrees && m.rowsAgree, "Credits math wrong");
  const leaks = await service.leaks();
  assert(!(await hitKinds(service.engine!)).some(r => r.line_kind === "credit"), "Credits must never be leaks");
  assert(leaks.result.checked.creditLines === "1" && leaks.result.checked.uncostedLines === "1", "Leak finder should count credit and unknown-cost lines it skipped");
  assert((await service.reconcile()).reconciled, "Credits vault should reconcile");
  assert(!(await service.marginWhale()).available, "Whale curve must be gated on Starter");
  await service.sourceRemove(group!.sourceId);
  assert((await rowsOf(service, "SELECT count(*)::VARCHAR AS n FROM agg_cpm"))[0].n === "0" && (await service.status()).lines === "0", "Removing the file must remove its credits and aggregates");
  assert((await service.verify()).valid, "Audit chain invalid after credits");
  await service.lock(); await reset(scope);
  return { waterfall: expect, signErrorKept: true };
}
/** 2M-line timing for the waterfall, drill-downs, whale curve, leak finder and reconciliation (blueprint section 5 target: under 300 ms). */
async function marginBenchmark(rows: number) {
  assert(rows === 2_000_000 || rows === 200_000, "benchmark scope");
  const stages: Record<string, number> = {}; let stage = "seed"; const mark = (k: string, t: number) => { stages[k] = Math.round(performance.now() - t); stage = "after " + k; };
  const scope = { userId: "bench-" + crypto.randomUUID(), tenantId: "bench-" + crypto.randomUUID() };
  const service = new VaultService(() => undefined); await service.init(scope); await service.create(secret, "scale");
  const engine = service.engine!, source = crypto.randomUUID(), tS = performance.now();
  try {
    await engine.conn.query(`BEGIN;
INSERT INTO products(product_id, category) SELECT 'P' || (i+1), 'Cat ' || (i % 40) FROM range(100000)t(i);
INSERT INTO customers(customer_id, tier, branch) SELECT 'C' || (i+1), 'T' || lpad(((i % 50) + 1)::VARCHAR, 2, '0'), CASE i % 3 WHEN 0 THEN 'North' WHEN 1 THEN 'South' ELSE 'West' END FROM range(2000)t(i);
INSERT INTO source_files VALUES('${source}','synthetic-benchmark.csv','sales_history',0,'2026-11-04');
INSERT INTO import_batches(id,source_id,rows_loaded,rows_rejected,imported_at) VALUES('${crypto.randomUUID()}','${source}',${rows},0,'2026-11-04')`);
    for (let at = 0; at < rows; at += 100_000) await engine.conn.query(`INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id,line_kind)
SELECT '${source}', i+1, 'P' || ((i % 100000)+1), 'C' || ((i*13 % 2000)+1), (DATE '2024-01-01' + INTERVAL (least(23,(i*24)//${rows})) MONTH)::DATE, (i%5)+1, 10000+(i%997)*29, ((10000+(i%997)*29) * (3000 - ((i*13 % 2000) % 50) * 50)) // 10000, 100+i%599, CASE WHEN i%7=0 THEN 200 ELSE 0 END, 6000+(i%991)*23, i+2, 'INV-' || (i+1), 'sale'
FROM range(${at},${Math.min(rows, at + 100_000)})t(i) ORDER BY 4,5,2`);
    await engine.conn.query("COMMIT"); mark("seed", tS);
    stage = "rebuild"; const t0 = performance.now(); await (service as unknown as { derived(e: typeof engine): Promise<void> }).derived(engine); const rebuildAndReconcileMs = Math.round(performance.now() - t0); stage = "save";
    let tx = performance.now(); await service.save(); mark("save", tx); tx = performance.now(); await service.lock(); await service.unlock(secret); mark("unlock", tx);
    const cold = await timed(1, () => service.marginWaterfall()); tx = performance.now(); await service.warmup(); mark("warmupAfterUnlock", tx);
    const aggRows = String((await service.engine!.conn.query("SELECT count(*)::VARCHAR AS n FROM agg_cpm")).toArray()[0].n);
    const probe = async (label: string, sql: string) => { stages[label] = (await timed(3, () => service.engine!.conn.query(sql))).medianMs; };
    await probe("select1", "SELECT 1"); await probe("countAgg", "SELECT count(*) FROM agg_cpm"); await probe("sumAggList", "SELECT sum(list_cents)::VARCHAR FROM agg_cpm");
    await probe("sumLinesList", "SELECT sum(list_cents)::VARCHAR FROM sales_lines"); await probe("sumAgg8", `SELECT line_kind, ${["lines", "list_cents", "discount_cents", "rebate_cents", "freight_cents", "costed_lines", "costed_pocket_cents", "cost_cents"].map(c => `sum(${c})::VARCHAR`).join(",")} FROM agg_cpm GROUP BY line_kind`);
    await probe("sumLines8", `SELECT line_kind, count(*), ${["list_cents", "discount_cents", "rebate_cents", "freight_cents", "cost_cents"].map(c => `sum(${c})::VARCHAR`).join(",")} FROM sales_lines GROUP BY line_kind`);
    await probe("settings", "SELECT current_setting('threads') AS t, current_setting('memory_limit') AS m");
    const mem = async () => Object.fromEntries((await service.engine!.conn.query("SELECT tag, (memory_usage_bytes // 1048576)::VARCHAR AS mb FROM duckdb_memory() WHERE memory_usage_bytes > 1048576")).toArray().map(r => [String(r.tag), Number(r.mb)]));
    (stages as Record<string, unknown>).memoryBeforeLeaks = await mem();
    await service.engine!.conn.query("CHECKPOINT").catch(() => undefined);
    (stages as Record<string, unknown>).memoryAfterCheckpoint = await mem();
    stage = "views"; const wf = await timed(7, () => service.marginWaterfall()), wfBranch = await timed(7, () => service.marginWaterfall({ by: [{ dim: "branch", value: "North" }] }));
    const product = await timed(7, () => service.marginDrill("product")), customer = await timed(7, () => service.marginDrill("customer")), branch = await timed(7, () => service.marginDrill("branch"));
    const category = await timed(7, () => service.marginDrill("category", { by: [{ dim: "branch", value: "South" }] })), whaleT = await timed(3, () => service.marginWhale());
    const mathT = await timed(3, () => service.marginMath("margin", { by: [{ dim: "branch", value: "West" }] }));
    stage = "leak finder"; const real = service.engine!, trace: string[] = [];
    const traced = { ...real, conn: { query: async (sql: string) => { const t = performance.now(); try { return await real.conn.query(sql); } finally { const m = (await real.conn.query("SELECT tag, (memory_usage_bytes // 1048576)::VARCHAR AS mb FROM duckdb_memory() WHERE memory_usage_bytes > 8388608")).toArray().map(r => `${r.tag}=${r.mb}`).join(","); trace.push(`${Math.round(performance.now() - t)}ms ${sql.replace(/\s+/g, " ").slice(0, 60)} [${m}]`); } } } } as unknown as typeof real;
    const t1 = performance.now(); const leaks = await findLeaks(traced).catch(e => { throw new Error(`${(e as Error).message.split("\n")[0]} TRACE ${trace.slice(-6).join(" | ")}`); });
    (stages as Record<string, unknown>).leakTrace = trace.filter(t => !t.startsWith("0ms") && !t.startsWith("1ms")); const leakMs = Math.round(performance.now() - t1);
    stage = "reconcile"; const t2 = performance.now(); const diff = await findDifferences(service.engine!); const reconcileMs = Math.round(performance.now() - t2);
    assert(wf.last.lines === String(rows) && diff.found.length === 0, `Benchmark waterfall/reconciliation wrong: ${wf.last.lines} lines, ${diff.found.length} differences ${JSON.stringify(diff.found.slice(0, 2))}`);
    const under = (x: { medianMs: number }) => x.medianMs < 300;
    return { rows: String(rows), aggRows, rebuildAndReconcileMs, waterfallMs: wf.medianMs, waterfallMaxMs: wf.maxMs, waterfallBranchMs: wfBranch.medianMs, drillProductMs: product.medianMs, drillCustomerMs: customer.medianMs, drillBranchMs: branch.medianMs,
      drillCategoryInBranchMs: category.medianMs, whaleMs: whaleT.medianMs, mathMs: mathT.medianMs, leakFinderMs: leakMs, findings: String(leaks.findings.length), reconcileMs,
      waterfallAndDrillUnder300ms: [wf, wfBranch, product, customer, branch, category].every(under), waterfallDuringWarmupMs: cold.medianMs, stages };
  } catch (error) { throw new Error(`${stage}: ${(error as Error).message.split("\n")[0]} ${JSON.stringify(stages)}`); }
  finally { await service.lock().catch(() => undefined); await reset(scope); }
}
async function cipherOnly() {
  let files = 0;
  async function walk(dir: FileSystemDirectoryHandle) {
    for await (const [name, entry] of dir.entries()) {
      if (entry.kind === "directory") { await walk(entry as FileSystemDirectoryHandle); continue; }
      const file = await (entry as FileSystemFileHandle).getFile(); files++;
      if (name.endsWith(".enc")) assert(new TextDecoder().decode(await file.slice(0, 8).arrayBuffer()) === "MDVAULT1", "Plaintext or invalid snapshot in OPFS");
      else {
        assert(["head.json", "head.previous.json"].includes(name), "Unexpected plaintext OPFS file");
        const head = JSON.parse(await file.text()); assert(Object.keys(head).sort().join(",") === "current,format,previous,savedAt,sequence", "Business fields in pointer");
      }
    }
  }
  await walk(await navigator.storage.getDirectory()); return { cipherOnly: true, files };
}


async function pricingToolsFlow(){
 const scope={userId:'tools-'+crypto.randomUUID(),tenantId:'tools-'+crypto.randomUUID()},service=new VaultService(()=>undefined);
 const hooks={signal:()=>new AbortController().signal,progress:()=>undefined};
 const call=(action:string,data:unknown={})=>dispatch(service,{id:'tools',action,data} as never,hooks) as Promise<any>;
 await service.init(scope);await service.create(secret,'professional','Synthetic Owner');
 try{
  const e=service.engine!;await e.conn.query(`INSERT INTO products(product_id,category,current_cost,list_price) VALUES('TOOL-P','Synthetic',800,1000);INSERT INTO customers(customer_id,tier) VALUES('TOOL-C','T');INSERT INTO source_files VALUES('TOOL-S','synthetic.csv','sales_history',0,'2026-11-07');INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id) VALUES('TOOL-S',1,'TOOL-P','TOOL-C','2026-01-01',1,1000,0,300,0,800,2,'TOOL-I');`);
  await(service as unknown as {derived(value:typeof e):Promise<void>}).derived(e);await service.save();
  const comp=await call('competitorAdd',{input:{product:'TOOL-P',competitor:'Synthetic competitor',price:'11.01',date:'2026-11-07',source:'Synthetic note'}});assert(comp.rows[0].price==='1101','Competitor cents differ');
  const state=await call('priceGrid'),edits=await call('priceGridPaste',{text:'12.01',keys:state.rows.map((r:any)=>r.key),start:0});
  const draft=await call('priceGridDraft',{edits,revision:state.revision});assert(draft.rows[0].after==='1201','Grid cents differ');await call('ruleApprove',{id:draft.id});
  const exported=await call('priceExport',{id:draft.id,profile:'generic',format:'xlsx'}),receipts=await call('priceLandedState');
  const checked=await call('priceLandedCheck',{receipt:receipts.receipts[0].id,file:new File([exported.blob],'synthetic-erp.xlsx')});assert(checked.applied==='1','Landed round trip differs');
  const orders=(await call('serviceOrders')).rows;assert(orders.length===1,'Service invoice missing');await call('serviceFlag',{key:orders[0].invoice_key,free:true});const leaks=await call('leaks');assert(leaks.result.findings.some((f:any)=>f.type==='free_delivery_loss'&&f.cents==='100'),'Free delivery loss missing');
  await call('rolePreview',{role:'sales_rep'});for(const action of ['homeMonitor','competitorList','priceGrid','ruleWhatIf','priceLandedState','serviceOrders']){let denied=false;try{await call(action);}catch(e){denied=(e as {code:string}).code==='FORBIDDEN';}assert(denied,'Rep received pricing tools');}await call('rolePreview',{role:null});
  assert((await service.verify()).valid,'Tools audit invalid');await service.lock();await service.unlock(secret);
  assert((await call('competitorList',{product:'TOOL-P'})).rows.length===1,'Competitor lost on reload');assert((await call('priceLandedState',{id:checked.checks[0].id})).applied==='1','Landed receipt lost');assert((await call('serviceOrders')).rows[0].free_delivery,'Confirmation lost');assert((await service.verify()).valid,'Reloaded tools audit invalid');
  return {competitor:true,paste:true,draft:true,approval:true,scopedXlsx:true,landed:true,serviceLoss:true,repDenied:true,audit:true,encryptedReload:true};
 }finally{await service.lock();await reset(scope);}
}

async function pricingOpsFlow(){
 const scope={userId:'ops-'+crypto.randomUUID(),tenantId:'ops-'+crypto.randomUUID()},service=new VaultService(()=>undefined);await service.init(scope);await service.create(secret,'professional','Synthetic Owner');
 try{
  const e=service.engine!;
  await e.conn.query(`INSERT INTO products(product_id,category,current_cost,list_price) VALUES('OPS-P','Synthetic category',6000,10000);
   INSERT INTO customers(customer_id,tier,branch) VALUES('OPS-C','OPS-T','Synthetic branch');
   INSERT INTO source_files VALUES('OPS-S','synthetic-ops.csv','sales_history',0,'2026-11-07');
   INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row) VALUES('OPS-S',1,'OPS-P','OPS-C','2026-01-01',2,20000,0,0,0,12000,2);`);
  await (service as unknown as {derived(value:typeof e):Promise<void>}).derived(e);await service.save();
  const plan=await service.pricePlan({segment:'category',value:'Synthetic category',increase:'5'});
  assert(plan.count==='1'&&plan.impact==='1000','Ops preview impact differs');
  await service.ruleApprove(plan.id);const version=(await service.priceOpsState()).versions[0];
  const reversed=await service.priceRollback(version.id);await service.ruleApprove(reversed.id);
  assert((await service.priceExport(reversed.id,'generic','csv')).blob.size>0,'Ops reversal export missing');
  const customerPlan=await service.pricePlan({segment:'customer',value:'OPS-C',increase:'5'});await service.ruleApprove(customerPlan.id);const customerFile=await service.priceExport(customerPlan.id,'generic','csv');const csv=await customerFile.blob.text();assert(csv.includes('\"OPS-P\",\"\",\"105.00\"')&&csv.includes('\"customer_id\",\"valid_to\"'),'Customer export changed matrix scope');
  assert((await service.verify()).valid,'Ops audit chain invalid');await service.lock();await service.unlock(secret);
  assert((await service.priceOpsState()).versions.length===3,'Ops versions lost on encrypted reload');
  assert((await service.verify()).valid,'Ops chain changed after encrypted reload');
  return {draft:true,impact:true,ownerApproval:true,reversal:true,export:true,customerExportScope:true,audit:true,encryptedReload:true};
 }finally{await service.lock();await reset(scope);}
}

async function pricingFlow() {
 const scope={userId:'price-'+crypto.randomUUID(),tenantId:'price-'+crypto.randomUUID()};
 let service=new VaultService(()=>undefined);await service.init(scope);await service.create(secret,'professional');
 try {
  const playground=await service.playgroundLoad(()=>undefined),found=await service.leaks();
  for(const leak of playground.manifest.leaks)assert(found.result.findings.filter(f=>f.type===leak.type&&f.lines===String(leak.lines)&&f.cents===leak.cents).length===1,'Playground leak changed before guardrails');
  await service.pricingOwner('Synthetic Pricing Owner',scope.userId,7);
  const rule={name:'Valves cost pass-through',category:'Valves',vendor:'Valves Mills',threshold:'5',increase:'4.5'};
  const saved=await service.ruleSave(rule),beforePrices=String((await service.engine!.conn.query('SELECT sum(price)::VARCHAR AS n FROM price_matrix')).toArray()[0].n);
  let sim=await service.ruleSimulate(saved.id);assert(BigInt(sim.count)>BigInt(0),'No affected SKU/tier pairs');
  assert(String((await service.engine!.conn.query('SELECT sum(price)::VARCHAR AS n FROM price_matrix')).toArray()[0].n)===beforePrices,'Simulation changed live prices');
  await service.guardSet({tier:'T01',category:'Valves',start:'3',target:'2',floor:'1'});
  let conflict=false;try{await service.ruleApprove(sim.id);}catch(e){conflict=(e as Error).message.includes('Conflict');}assert(conflict,'Stale preview was approved');
  // An explicit floor must override the peer-rate fallback even for one line.
  await service.guardSet({tier:'T08',category:'Valves',start:'99999999',target:'99999999',floor:'99999999'});
  const guarded=await service.leaks(),specific=guarded.result.findings.find(f=>f.type==='below_floor'&&f.scope.category==='Valves');assert(specific,'Configured guardrail made no below-floor finding');
  const evidence=await service.leakRows(specific!.id);assert(evidence.engineAgrees,'Configured floor evidence does not agree with decimal engine');
  await service.guardSet({tier:'T08',category:'Valves',start:'3',target:'2',floor:'1'});
  sim=await service.ruleSimulate(saved.id);
  const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('test-price-backup-'+crypto.randomUUID(),{create:true});
  await service.backupConfigure(dir,1);await service.ruleApprove(sim.id);
  assert((await service.backupStatus()).last!==null,'Approval did not write auto-backup');
  // 7V-3b: a row note stays out of ERP exports and survives the encrypted backup and restore.
  const noteProduct=String((await service.engine!.conn.query('SELECT product_id FROM products ORDER BY product_id LIMIT 1')).toArray()[0].product_id),noteText='Backup round-trip note '+crypto.randomUUID();
  await service.noteSet('product',noteProduct,noteText);
  for(const format of ['csv','xlsx'] as const){const file=await service.priceExport(sim.id,'netsuite',format);assert(file.blob.size>100&&(await file.log.text()).includes('Before'),'Export missing price rows or change log');if(format==='csv')assert(!(await file.blob.text()).includes(noteText)&&!(await file.log.text()).includes(noteText),'ERP export or change log contains a row note');}
  // Save the audit of exports in the final backup too.
  const cfg=await backupConfig(service.storage.scope);await storeBackupConfig(service.storage.scope,{...cfg,last:'2020-01-01T00:00:00Z'});await service.backupDue();assert((await service.backupStatus()).last!=='2020-01-01T00:00:00Z','Due scheduled backup did not run');
  await service.backupNow();const backup=await (await dir.getFileHandle('rebatehq-backup.enc')).getFile();
  const wf=await service.marginWaterfall(),leaks=await service.leaks();await service.backupNow();const finalBackup=new Blob([await (await (await dir.getFileHandle('rebatehq-backup.enc')).getFile()).arrayBuffer()]);
  const prices=await service.engine!.conn.query('SELECT product_id,tier,price::VARCHAR AS price FROM price_matrix ORDER BY product_id,tier,id');
  const expected=JSON.stringify(prices.toArray().map(r=>({...r}))),tip=(await service.engine!.conn.query('SELECT audit_tip,audit_count::VARCHAR AS n FROM vault_meta')).toArray()[0];
  await service.lock();
  // Keep the external-backup seam's File snapshot, then wipe ALL origin OPFS and backup-handle metadata.
  for await(const [name] of root.entries())await root.removeEntry(name,{recursive:true});
  await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase('rebatehq-backup-handles');request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);});
  service=new VaultService(()=>undefined);await service.init(scope);
  let wrong=false;try{await service.backupRestore(finalBackup,'deliberately-wrong-passphrase');}catch{wrong=true;}assert(wrong&&!(await service.status()).exists,'Wrong restore passphrase wrote a vault');
  const tampered=new Uint8Array(await finalBackup.arrayBuffer());tampered[tampered.length-1]^=1;let damaged=false;try{await service.backupRestore(new Blob([tampered]),secret);}catch{damaged=true;}assert(damaged&&!(await service.status()).exists,'Damaged backup was accepted');
  const otherScope={userId:'other-'+crypto.randomUUID(),tenantId:scope.tenantId},other=new VaultService(()=>undefined);await other.init(otherScope);let wrongScope=false;try{await other.backupRestore(finalBackup,secret);}catch{wrongScope=true;}assert(wrongScope,'Cross-workspace backup was accepted');await other.lock();await reset(otherScope);
  await service.backupRestore(finalBackup,secret);
  const restored=await service.marginWaterfall(),restoredLeaks=await service.leaks();
  assert(restored.netPocket===wf.netPocket&&restored.margin===wf.margin&&restored.cost===wf.cost,'Restored waterfall differs');
  assert(restoredLeaks.result.totalCents===leaks.result.totalCents&&restoredLeaks.result.dedupedCents===leaks.result.dedupedCents,'Restored leak totals differ');
  assert(JSON.stringify((await service.engine!.conn.query('SELECT product_id,tier,price::VARCHAR AS price FROM price_matrix ORDER BY product_id,tier,id')).toArray().map(r=>({...r})))===expected,'Restored prices differ to the cent');
  assert((await service.verify()).valid,'Restored audit chain invalid');
  assert((await service.productList(0,{filters:[{col:'product_id',values:[noteProduct]}]})).rows[0]?.notes===noteText,'Restored vault lost a row note');
  const audit=(await service.engine!.conn.query(`SELECT hash FROM audit_log WHERE sequence=${tip.n}`)).toArray()[0];assert(audit.hash===tip.audit_tip,'Backup audit prefix changed');
  let refused=false;try{await service.backupRestore(backup,secret);}catch{refused=true;}assert(refused,'Restore overwrote an existing vault');
  return {rowNoteRestoredNotExported:true,manifestLeaks:5,simulationNoWrites:true,staleConflict:true,configuredFloor:true,automaticBackup:true,csvAndXlsx:true,originOpfsAndHandleStorageWiped:true,exactRestore:true,wrongPassphrase:true,auditPrefixIntact:true};
 }finally{await service.lock();await reset(scope);}
}
async function legacyStorage() {
 const scope={userId:'legacy-'+crypto.randomUUID(),tenantId:'legacy-'+crypto.randomUUID()},root=await navigator.storage.getDirectory();
 const idb=(name:string,work:(db:IDBDatabase)=>Promise<void>)=>new Promise<void>((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('handles');r.onerror=()=>reject(r.error);r.onsuccess=()=>{work(r.result).then(()=>{r.result.close();resolve();},e=>{r.result.close();reject(e);});};});
 const drop=(name:string)=>new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});
 let service=new VaultService(()=>undefined);await service.init(scope);await service.create(secret,'professional');await service.lock();
 // Simulate a vault saved by a pre-rename build: copy its files into the legacy folder and remove the new copy (Chromium cannot rename OPFS directories).
 const scopeName=service.storage.scope,parent=await root.getDirectoryHandle('rebatehq-vaults'),vaultDir=await parent.getDirectoryHandle(scopeName);
 const legacyDir=await (await root.getDirectoryHandle('margindesk-vaults',{create:true})).getDirectoryHandle(scopeName,{create:true});
 for await(const [name,entry] of vaultDir.entries())if(entry.kind==='file'){const out=await (await legacyDir.getFileHandle(name,{create:true})).createWritable();await (await (entry as FileSystemFileHandle).getFile()).stream().pipeTo(out);}
 await parent.removeEntry(scopeName,{recursive:true});
 service=new VaultService(()=>undefined);await service.init(scope);
 assert((await service.status()).exists,'Vault in the legacy folder was not found');
 await service.unlock(secret);await service.lock();
 let duplicated=true;try{await parent.getDirectoryHandle(scopeName);}catch{duplicated=false;}
 assert(!duplicated,'Opening a legacy vault created a second copy under rebatehq-vaults');
 // Backup-folder settings saved by a pre-rename build are carried forward once.
 await drop('rebatehq-backup-handles');await drop('margindesk-backup-handles');
 await idb('margindesk-backup-handles',db=>new Promise<void>((resolve,reject)=>{const tx=db.transaction('handles','readwrite');tx.objectStore('handles').put({directory:null,hours:12,last:'2026-01-01T00:00:00.000Z',error:false},scope.userId);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);}));
 const carried=await backupConfig(scope.userId);assert(carried.hours===12&&carried.last==='2026-01-01T00:00:00.000Z','Legacy backup settings were not carried forward');
 await drop('margindesk-backup-handles');
 const kept=await backupConfig(scope.userId);assert(kept.hours===12,'Carried-forward backup settings were not stored in the new database');
 await drop('rebatehq-backup-handles');
 const none=await backupConfig('never-configured-'+crypto.randomUUID());assert(none.directory===null&&none.hours===24,'Missing settings did not fall back to defaults');
 let legacyCreated=false;await new Promise<void>(resolve=>{const r=indexedDB.databases?indexedDB.databases():Promise.resolve([]);r.then(list=>{legacyCreated=list.some(d=>d.name==='margindesk-backup-handles');resolve();});});
 assert(!legacyCreated,'Probing for legacy settings created an empty legacy database');
 await (await root.getDirectoryHandle('margindesk-vaults')).removeEntry(scopeName,{recursive:true});
 return {legacyVaultOpenedInPlaceAndUnlocked:true,legacyBackupSettingsCarriedForward:true,missingLegacyDatabaseNotCreated:true};
}
async function pricingBenchmark(){
 const scope={userId:'bench-'+crypto.randomUUID(),tenantId:'bench-'+crypto.randomUUID()},service=new VaultService(()=>undefined);await service.init(scope);await service.create(secret,'scale');
 try{const e=service.engine!,src=crypto.randomUUID();await e.conn.query(`BEGIN;INSERT INTO products(product_id,category,current_cost,list_price) SELECT 'P'||i,'Benchmark',6000,10000 FROM range(100000)t(i);INSERT INTO customers(customer_id,tier) SELECT 'C'||i,'T'||(i%50) FROM range(2000)t(i);INSERT INTO source_files VALUES('${src}','synthetic benchmark.csv','sales_history',0,'2026-11-04');INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file) SELECT 'old'||i,'Benchmark Mills','P'||i,6000,'2024-01-01','synthetic' FROM range(100000)t(i);INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file) SELECT 'new'||i,'Benchmark Mills','P'||i,6600,'2025-01-01','synthetic' FROM range(100000)t(i)`);
 for(let at=0;at<1000000;at+=50000)await e.conn.query(`INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row) SELECT '${src}',i+1,'P'||(i%100000),'C'||(i%2000),DATE '2025-01-01'+INTERVAL (i%12) MONTH,1,10000,100,50,0,6000,i+2 FROM range(${at},${at+50000})t(i)`);
 await e.conn.query('COMMIT');await(service as unknown as {derived(value:typeof e):Promise<void>}).derived(e);await service.save();await service.lock();await service.unlock(secret);await service.warmup();
 const r=await service.ruleSave({name:'Benchmark',category:'Benchmark',vendor:'Benchmark Mills',threshold:'5',increase:'4.5'});let start=performance.now();const p=await service.ruleSimulate(r.id);const simulationAndEncryptedSaveMs=Math.round(performance.now()-start);start=performance.now();const preview=await service.rulePreview(p.id);const previewPageMs=Math.round(performance.now()-start);
 assert(p.count==='100000'&&p.rows[0].after==='10450'&&preview.rows.length===50,'Benchmark price copy invalid');assert(String((await service.engine!.conn.query('SELECT count(*) AS n FROM price_matrix')).toArray()[0].n)==='0','Benchmark modified live prices');return{lines:'1000000',skus:'100000',pairs:p.count,sqlSimulationMs:p.ms,simulationAndEncryptedSaveMs,previewPageMs,memoryLimit:'512MB',temporaryInvoiceCopies:false};
 }finally{await service.lock();await reset(scope);}
}

// 5A: roles, item cleanup with undo, cost basis, checklist and ROI, driven through the same command door the UI uses.
async function phase5a() {
 const scope={userId:'p5a-'+crypto.randomUUID(),tenantId:'p5a-'+crypto.randomUUID()};
 const hooks={signal:()=>new AbortController().signal,progress:()=>undefined};
 const call=(s:VaultService,action:string,data:unknown={})=>dispatch(s,{id:'1',action,data} as never,hooks) as Promise<any>;
 const refuses=async(s:VaultService,action:string,data:unknown={})=>{try{await call(s,action,data);return false;}catch(e){return (e as Error).message.includes('cannot do this');}};
 let service=new VaultService(()=>undefined);await service.init(scope);
 try {
  let refusedNoOwner=false;try{await call(service,'create',{passphrase:secret,tier:'professional',ownerName:'  '});}catch(e){refusedNoOwner=(e as Error).message.includes('Pricing Owner');}
  assert(refusedNoOwner&&!(await service.status()).exists,'A vault was created without a named Pricing Owner');
  const created=await call(service,'create',{passphrase:secret,tier:'professional',ownerName:'Synthetic Pricing Owner'});
  assert(created.schemaVersion==='17'&&created.access.role==='owner'&&created.access.ownerNamed&&created.access.caps.includes('approve'),'The creator is not the Owner and named Pricing Owner');
  assert((await call(service,'pricingState')).owner.name==='Synthetic Pricing Owner','Pricing Owner was not stored at setup');
  // Sample data never completes setup steps; it still feeds every view.
  await service.playgroundLoad(()=>undefined);
  let list=await call(service,'checklist');assert(list.total===7&&list.steps.every((s:{step:string;done:boolean})=>!s.done||s.step==='fix'),'Playground data completed a setup step');
  const e=service.engine!,src=String((await e.conn.query("SELECT id FROM source_files WHERE role='sales_history' LIMIT 1")).toArray()[0].id),customer=String((await e.conn.query('SELECT customer_id FROM customers LIMIT 1')).toArray()[0].customer_id);
  await e.conn.query(`BEGIN;INSERT INTO products(product_id,category,uom,current_cost) VALUES('ZED-1','Zeds','Each',8123457),('zed-1','','EA',NULL);
INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row) VALUES('${src}',9000001,'ZED-1','${customer}',DATE '2025-02-01',1,9000000,0,0,0,8123457,99999),('${src}',9000002,'zed-1','${customer}',DATE '2025-02-02',1,5000,0,0,0,3000,99998);COMMIT`);
  await(service as unknown as {derived(value:typeof e):Promise<void>}).derived(e);await service.save();
  // Item master cleanup: merge, unit spelling and category; each changes the vault and each undo restores it exactly.
  const before=await call(service,'marginWaterfall'),scan=await call(service,'cleanupScan');
  const group=scan.duplicates.find((g:{key:string})=>g.key==='ZED1');assert(group&&group.members.length===2&&group.canonical==='ZED-1'&&group.confidence==='certain','Duplicate SKUs were not found');
  const merged=await call(service,'cleanupApply',{kind:'merge_duplicates',key:'ZED1'});assert(merged.finished,'Duplicate rows were not removed');
  assert((await e.conn.query("SELECT count(*)::VARCHAR AS n FROM products WHERE upper(product_id)='ZED-1'")).toArray()[0].n==='1','Merge left a look-alike product');
  const after=await call(service,'marginWaterfall');assert(after.netPocket===before.netPocket&&after.cost===before.cost&&after.margin===before.margin&&after.lines===before.lines,'Merging changed invoice totals');
  assert((await e.conn.query("SELECT count(*)::VARCHAR AS n FROM sales_lines WHERE line_id IN (9000001,9000002) AND product_id='ZED-1'")).toArray()[0].n==='2'&&(await call(service,'marginMath',{metric:'cost',filters:{by:[{dim:'product',value:'ZED-1'}]}})).rowCount==='2','Merged lines do not point at the kept product');
  const mergeFix=merged.history[0];await call(service,'cleanupUndo',{id:mergeFix.id});
  assert((await e.conn.query("SELECT count(*)::VARCHAR AS n FROM products WHERE upper(product_id)='ZED-1'")).toArray()[0].n==='2','Undo did not restore the duplicate product');
  assert((await call(service,'marginWaterfall')).margin===before.margin,'Undo changed the waterfall');
  // Batch: two certain groups and one punctuation-only group; one rebuild, totals unchanged, one undo for the batch.
  await e.conn.query(`BEGIN;INSERT INTO products(product_id,category) VALUES('YAK-1','Yaks'),('yak-1','Yaks'),('YAK2','Yaks'),('YAK-2','Yaks');INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row) VALUES('${src}',9000003,'yak-1','${customer}',DATE '2025-02-03',1,100,0,0,0,50,99997),('${src}',9000004,'YAK-2','${customer}',DATE '2025-02-04',1,100,0,0,0,50,99996);COMMIT`);
  await(service as unknown as {derived(value:typeof e):Promise<void>}).derived(e);await service.save();
  const wfBatch=await call(service,'marginWaterfall'),mergedAll=await call(service,'cleanupMergeAll');
  assert(mergedAll.merged==='2'&&mergedAll.ids.length===2&&mergedAll.skipped==='0'&&mergedAll.unfinished==='0','Batch merge did not merge exactly the two certain groups (ZED1 and YAK1)');
  assert(mergedAll.scan.duplicates.some((g:{key:string;confidence:string})=>g.key==='YAK2'&&g.confidence==='possible')&&!mergedAll.scan.duplicates.some((g:{key:string})=>g.key==='YAK1'),'A punctuation-only group must stay for manual review');
  const afterBatch=await call(service,'marginWaterfall');assert(afterBatch.netPocket===wfBatch.netPocket&&afterBatch.lines===wfBatch.lines&&afterBatch.margin===wfBatch.margin,'Batch merge changed invoice totals');
  const undoneBatch=await call(service,'cleanupUndoMany',{ids:mergedAll.ids});
  assert(undoneBatch.skipped==='0'&&(await e.conn.query("SELECT count(*)::VARCHAR AS n FROM products WHERE upper(product_id)='YAK-1'")).toArray()[0].n==='2'&&(await call(service,'marginWaterfall')).netPocket===wfBatch.netPocket,'Batch undo did not restore the duplicates');
  assert((await call(service,'cleanupScan')).duplicates.some((g:{key:string})=>g.key==='YAK1'),'Duplicates did not return after the batch undo');
  const unit=await call(service,'cleanupApply',{kind:'normalize_uom',key:'Each'});assert((await e.conn.query("SELECT uom FROM products WHERE product_id='ZED-1'")).toArray()[0].uom==='EA','Unit was not respelled');
  await call(service,'cleanupUndo',{id:unit.history[0].id});assert((await e.conn.query("SELECT uom FROM products WHERE product_id='ZED-1'")).toArray()[0].uom==='Each','Unit undo failed');
  let twice=false;try{await call(service,'cleanupUndo',{id:unit.history[0].id});}catch(err){twice=(err as Error).message.includes('already undone');}assert(twice,'A fix was undone twice');
  assert((await service.verify()).valid,'Audit chain broke after cleanup');
  const actions=(await e.conn.query("SELECT action FROM audit_log WHERE action LIKE 'cleanup.%'")).toArray().map(r=>String(r.action));assert(actions.filter(a=>a==='cleanup.applied').length===4&&actions.filter(a=>a==='cleanup.undone').length===4,'Cleanup fixes were not audited');
  // Cost basis: the invoice column reconciles to the waterfall; a choice is stored and survives a lock.
  const basis=await call(service,'costBasis'),wf=await call(service,'marginWaterfall');
  assert(basis.groups.length>0&&BigInt(basis.total.invoice.margin)===BigInt(wf.margin),'Invoice-cost margin by group does not add up to the waterfall');
  const zeds=basis.groups.find((g:{group:string})=>g.group==='Zeds');assert(zeds&&BigInt(zeds.replacement.cost)===BigInt(8123457),'Replacement cost for the Zeds group is wrong');
  await call(service,'costBasisSet',{group:'Zeds',basis:'replacement'});
  // Rules, checklist progress and ROI.
  const roiAtStart=await call(service,'home');assert(roiAtStart.roi&&roiAtStart.roi.findings==='0','Sample findings were counted in the ROI total');
  await call(service,'leaks');const home=await call(service,'home');assert(home.roi.sampleFindings!=='0'&&home.roi.findings==='0'&&home.margin,'Home lacks the ROI tracker or counts sample findings');
  await call(service,'ruleSave',{input:{name:'Valves cost pass-through',category:'Valves',vendor:'Valves Mills',threshold:'5',increase:'4.5'}});
  list=await call(service,'checklist');assert(list.steps.find((s:{step:string})=>s.step==='rule').done&&!list.steps.find((s:{step:string})=>s.step==='import').done,'Checklist did not follow the vault');
  // People: a second person gets a role; self-edits are refused; Owner stays.
  await call(service,'roleSet',{userId:'colleague-1',name:'Sam Sales',role:'sales_rep'});
  let selfEdit=false;try{await call(service,'roleSet',{userId:scope.userId,name:'Me',role:'sales_rep'});}catch(err){selfEdit=(err as Error).message.includes('own role');}assert(selfEdit,'A role was self-assigned');
  assert((await call(service,'roleList')).people.length===2,'Role assignment was not stored');
  list=await call(service,'checklist');assert(list.steps.find((s:{step:string})=>s.step==='team').done,'Adding a person did not complete the team step');
  // Rep view (a preview of the same vault): no cost reaches the caller, enforced by the worker.
  const ownerStatus=await call(service,'status'),ownerMath=JSON.stringify(await call(service,'marginMath',{metric:'cost',filters:{by:[{dim:'product',value:'ZED-1'}]}}));
  assert(ownerStatus.totals.cost!==null&&ownerMath.includes('8123457'),'The Owner cannot see cost');
  await call(service,'rolePreview',{role:'sales_rep'});
  for(const [action,data] of [['marginWaterfall',{}],['marginDrill',{dim:'product'}],['marginWhale',{}],['marginMath',{metric:'cost'}],['leaks',{}],['leakReport',{}],['roi',{}],['costBasis',{}],['ruleSimulate',{id:'x'}],['rulePreview',{id:'x'}],['priceExport',{id:'x',profile:'generic',format:'csv'}],['ruleApprove',{id:'x'}],['cleanupApply',{kind:'merge_duplicates',key:'ZED1'}],['studioAdd',{files:[]}],['health',{}],['roleSet',{userId:'u',name:'n',role:'owner'}],['backupNow',{}]] as Array<[string,unknown]>)assert(await refuses(service,action,data),`The Sales Rep view was allowed to run ${action}`);
  const repStatus=await call(service,'status'),repHome=await call(service,'home'),repPricing=await call(service,'pricingState');
  assert(repStatus.access.role==='sales_rep'&&repStatus.totals.cost===null&&repStatus.totals.margin===null&&repStatus.totals.list!=='0','The Sales Rep status carries cost');
  assert(!('margin' in repHome)&&!('roi' in repHome)&&repPricing.rules.length===0&&repPricing.runs.length===0,'The Sales Rep home or pricing view carries cost-derived data');
  const seen=JSON.stringify([repStatus,repHome,repPricing,await call(service,'checklist'),await call(service,'roleList')]);
  assert(!seen.includes('8123457')&&!seen.includes('"cost":"'),'A cost value reached the Sales Rep view');
  assert(repStatus.access.sections.join()==='Home,Pricing,Quotes,Rebates & Contracts,Reports','The Sales Rep section allowlist differs (progress-only Rebates & Contracts is allowed)');
  await call(service,'rolePreview',{role:null});assert((await call(service,'status')).access.role==='owner','Leaving the preview did not restore the Owner view');
  // 7B: the 5A "reps may see cost" switch is gone. A vault that still stores it "on" gives a rep nothing (decision 16).
  await rowsOf(service,"DELETE FROM access_settings; INSERT INTO access_settings VALUES(1,true)");await call(service,'rolePreview',{role:'sales_rep'});
  assert(await refuses(service,'marginWaterfall')&&await refuses(service,'costBasis')&&await refuses(service,'ruleSimulate',{id:'x'}),'A stored rep-cost switch still gave a Sales Rep cost');
  let gone=false;try{await call(service,'accessSet',{repSeesCost:true});}catch{gone=true;}assert(gone,'The removed accessSet command still runs');
  await call(service,'rolePreview',{role:null});
  // 7B Quote Desk in the real worker. As a Sales Rep (preview): price zones and an exception request, never cost.
  const zed=(await rowsOf(service,"SELECT category FROM products WHERE product_id='ZED-1'"))[0],cust=(await rowsOf(service,"SELECT customer_id,tier FROM customers WHERE tier<>'' ORDER BY customer_id LIMIT 1"))[0];
  assert(zed&&cust,'The 5A fixture has no ZED-1 product or tiered customer');
  await call(service,'guardSet',{input:{tier:String(cust.tier),category:String(zed.category),start:'30000',target:'20000',floor:'10000'}});
  await call(service,'rolePreview',{role:'sales_rep'});
  const check=await call(service,'priceCheck',{productId:'ZED-1',customerId:String(cust.customer_id),quantity:'2'});
  assert(check.floorCents==='10000'&&check.credit.level==='unknown','Price Check lacks the guardrail or invents a credit signal');
  let quote=await call(service,'quoteCreate',{customerId:String(cust.customer_id)});
  quote=await call(service,'quoteLines',{id:quote.id,lines:[{productId:'ZED-1',quantity:'2',unitCents:'5000'}]});
  assert(quote.needsApproval&&quote.worst==='red'&&quote.totalCents==='10000','A below-floor line was not flagged');
  let noReason=false;try{await call(service,'quoteSubmit',{id:quote.id,reason:null});}catch(e){noReason=(e as Error).message.includes('reason');}assert(noReason,'A below-floor quote was submitted without a reason');
  quote=await call(service,'quoteSubmit',{id:quote.id,reason:'Competitor match'});assert(quote.status==='pending','The exception request is not pending');
  assert(await refuses(service,'quoteDecide',{id:quote.id,decision:'approve',note:null}),'A Sales Rep approved an exception');
  const repQuotes=JSON.stringify([check,quote,await call(service,'quoteGet',{id:quote.id}),await call(service,'quoteList',{})]);
  assert(!repQuotes.includes('8123457')&&!repQuotes.includes('16246914')&&!/"\w*(cost|margin)\w*":/i.test(repQuotes),'Quote Desk sent cost or margin to a Sales Rep');
  await call(service,'rolePreview',{role:null});
  const ownerQuote=await call(service,'quoteGet',{id:quote.id});assert(ownerQuote.costCents==='16246914'&&ownerQuote.marginCents!==undefined,'The Owner does not see the quote margin');
  let selfApproved=true;try{await call(service,'quoteDecide',{id:quote.id,decision:'approve',note:null});}catch(e){selfApproved=!(e as Error).message.includes('own quote');}assert(!selfApproved,'The quote author approved their own exception');
  // Everything above is stored in the encrypted vault: lock, unlock and check.
  await call(service,'lock');service=new VaultService(()=>undefined);await service.init(scope);await call(service,'unlock',{passphrase:secret});
  assert((await call(service,'status')).access.viewAs===null,'A role preview survived a lock');
  assert((await call(service,'quoteList',{pendingOnly:true})).length===1,'The pending quote was not stored in the encrypted vault');
  list=await call(service,'checklist');assert(list.steps.find((s:{step:string})=>s.step==='rule').done&&list.steps.find((s:{step:string})=>s.step==='team').done,'Checklist progress was not stored in the vault');
  assert((await call(service,'costBasis')).groups.find((g:{group:string})=>g.group==='Zeds').selected==='replacement','The cost basis choice was not stored');
  assert((await call(service,'roleList')).people.some((p:{userId:string})=>p.userId==='colleague-1'),'Roles were not stored');
  assert((await call(service,'cleanupHistory')).length===4&&(await service.verify()).valid,'Cleanup history or audit chain lost');
  return {ownerRequiredAtSetup:true,schemaCurrent:true,sampleDataNeverCompletesSteps:true,mergeAndUndo:true,unitFixAndUndo:true,invoiceTotalsUnchangedByCleanup:true,costBasisReconcilesToWaterfall:true,roiAndHomeSampleSeparated:true,checklistStored:true,repCostNeverCrossesWorker:true,ownerSwitchGivesRepsCostOnly:true};
 }finally{await service.lock().catch(()=>undefined);await reset(scope);}
}
// 5A timings on a synthetic 1M-line vault (100,000 products, 1,000 look-alike duplicates, 500 odd unit spellings, 2,000 uncategorised).
async function phase5aBenchmark(){
 const scope={userId:'p5b-'+crypto.randomUUID(),tenantId:'p5b-'+crypto.randomUUID()},call=(s:VaultService,action:string,data:unknown={})=>dispatch(s,{id:'1',action,data} as never,{signal:()=>new AbortController().signal,progress:()=>undefined}) as Promise<any>;
 const service=new VaultService(()=>undefined);await service.init(scope);await call(service,'create',{passphrase:secret,tier:'scale',ownerName:'Benchmark Owner'});
 try{const e=service.engine!,src=crypto.randomUUID();
  await e.conn.query(`BEGIN;INSERT INTO products(product_id,category,uom,current_cost,list_price) SELECT 'P'||i,CASE WHEN i%50=0 THEN '' ELSE 'Cat'||(i%40) END,CASE WHEN i%200=0 THEN 'Each' ELSE 'EA' END,6000,10000 FROM range(100000)t(i);
INSERT INTO products(product_id,category,uom,current_cost,list_price) SELECT 'p'||i,'Cat'||(i%40),'EA',6000,10000 FROM range(1000)t(i) WHERE i%1<>2;
INSERT INTO customers(customer_id,tier) SELECT 'C'||i,'T'||(i%50) FROM range(2000)t(i);INSERT INTO source_files VALUES('${src}','synthetic benchmark.csv','sales_history',0,'2026-11-04');
INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file) SELECT 'old'||i,'Mills','P'||i,6000,'2024-01-01','synthetic' FROM range(100000)t(i);INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file) SELECT 'new'||i,'Mills','P'||i,6600,'2025-01-01','synthetic' FROM range(100000)t(i)`);
  for(let at=0;at<1000000;at+=50000)await e.conn.query(`INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row) SELECT '${src}',i+1,CASE WHEN i%1000=7 THEN 'p'||(i%1000) ELSE 'P'||(i%100000) END,'C'||(i%2000),DATE '2025-01-01'+INTERVAL (i%12) MONTH,1,10000,100,50,0,6000,i+2 FROM range(${at},${at+50000})t(i)`);
  await e.conn.query('COMMIT');await(service as unknown as {derived(value:typeof e):Promise<void>}).derived(e);await service.save();await service.lock();await call(service,'unlock',{passphrase:secret});await service.warmup();
  const time=async(f:()=>Promise<any>)=>{const t=performance.now(),r=await f();return [Math.round(performance.now()-t),r] as const;};
  const [scanMs,scan]=await time(()=>call(service,'cleanupScan')),[basisMs,basis]=await time(()=>call(service,'costBasis')),[homeMs]=await time(()=>call(service,'home')),[statusMs]=await time(()=>call(service,'status'));
  const group=scan.duplicates.find((g:{key:string})=>g.key==='P7');assert(group&&group.confidence==='certain','Benchmark duplicates not found');
  const [mergeMs,merged]=await time(()=>call(service,'cleanupApply',{kind:'merge_duplicates',key:'P7'})),[undoMs]=await time(()=>call(service,'cleanupUndo',{id:merged.history[0].id}));
  const [unitMs]=await time(()=>call(service,'cleanupApply',{kind:'normalize_uom',key:'Each'}));
  assert(scan.duplicates.length>=100&&basis.groups.length>=40,'Benchmark data not what was expected');
  return {lines:'1000000',products:'101000',duplicateGroups:scan.totals.duplicateProducts,cleanupScanMs:scanMs,costBasisMs:basisMs,homeMs,statusMs,mergeOneGroupInclRebuildAndSaveMs:mergeMs,undoMergeInclRebuildAndSaveMs:undoMs,unitFixAllSpellingsInclSaveMs:unitMs,memoryLimit:'512MB'};
 }finally{await service.lock().catch(()=>undefined);await reset(scope);}
}
async function monitorFlow(){
 const scope={userId:'monitor-'+crypto.randomUUID(),tenantId:'monitor-'+crypto.randomUUID()},service=new VaultService(()=>undefined);
 await service.init(scope);await service.create(secret,'professional','Synthetic Owner');
 const call=async(action:string,data:Record<string,unknown>={})=>dispatch(service,{id:'monitor',action,data} as any,{signal:()=>new AbortController().signal,progress:()=>undefined}) as Promise<any>;
 try{
  await call('currencySet',{currency:'CAD'});const e=service.engine!,today=new Date().toISOString().slice(0,10);
  await e.conn.query(`INSERT INTO products(product_id,category,list_price) VALUES('MON-P','Synthetic',10000),('MON-A','Synthetic',12000),('MON-B','Synthetic',11000),('MON-C','Synthetic',11000);
  INSERT INTO customers(customer_id,name,tier) VALUES('MON-U','Synthetic customer','MON-T');INSERT INTO source_files VALUES('MON-S','synthetic-monitor.csv','sales_history',0,'${today}');
  INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id)
  SELECT 'MON-S',n,'MON-P','MON-U',DATE '${today}'-INTERVAL '100 days',1,10000,0,0,0,5000,n+1,'BEFORE-'||n::VARCHAR FROM range(1,4)t(n);
  INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id)
  VALUES('MON-S',4,'MON-P','MON-U',DATE '${today}',1,10000,1000,2000,0,9000,5,'AFTER'),('MON-S',5,'MON-A','MON-U',DATE '${today}',1,12000,0,0,0,6000,6,'AFTER'),('MON-S',6,'MON-B','MON-U',DATE '${today}',1,11000,0,0,0,6000,7,'AFTER'),('MON-S',7,'MON-C','MON-U',DATE '${today}',1,11000,0,0,0,6000,8,'AFTER');`);
  await(service as unknown as {derived(value:typeof e):Promise<void>}).derived(e);await service.save();const audit=(await service.status()).auditEntries;
  const v=await call('homeMonitor');assert(v.currency==='CAD'&&v.leaks.dedupedCents==='2000','CAD hero differs from the scoped finder');
  assert(v.health.alerts.length===1&&v.health.alerts[0].frequencyDrop,'Frequency alert missing');
  const a=await call('competitorList',{product:'MON-P',customer:'MON-U'});assert(a.alternatives.map((r:any)=>r.product).join(',')==='MON-A,MON-B,MON-C','Alternative ranking differs');
  assert((await service.status()).auditEntries===audit,'Monitoring wrote business/audit data');
  await call('rolePreview',{role:'sales_rep'});for(const action of ['homeMonitor','competitorList']){let blocked=false;try{await call(action,{product:'MON-P',customer:'MON-U'});}catch(e){blocked=(e as {code:string}).code==='FORBIDDEN';}assert(blocked,'Rep received monitoring costs');}await call('rolePreview',{role:null});
  await service.lock();await call('unlock',{passphrase:secret});assert((await call('homeMonitor')).currency==='CAD','Monitoring currency lost after encrypted reload');
  return {cadHero:true,health:true,ranking:true,readOnly:true,repDenied:true,encryptedReload:true};
 }finally{await service.lock();await reset(scope);}
}
async function currencyFlow() {
 const scope={userId:'fx-'+crypto.randomUUID(),tenantId:'fx-'+crypto.randomUUID()},service=new VaultService(()=>undefined);
 await service.init(scope);await service.create(secret,'professional','FX Owner');
 try {
  assert((await service.status()).currency==='USD','Old/default currency must be USD');
  await dispatch(service,{id:'fx',action:'currencySet',data:{currency:'EUR'}},{signal:()=>new AbortController().signal,progress:()=>undefined});
  await service.studioAdd([
   new File(['product_id,current_cost,list_price\nP,6.00,10.00\n'],'items.csv'),
   new File(['line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount\n1,P,C,2026-01-01,1,20.00,2.00,1.00,0.50,8.00\n'],'sales.csv')
  ]);
  for(const file of (await service.studioState()).files)await service.studioUpdate(file.id,{sourceCurrency:file.role==='item_master'?'USD':'CAD',fxRate:file.role==='item_master'?'0.8':'0.5'},undefined,{confirmed:true});
  await service.studioPlan(new AbortController().signal,()=>undefined);await service.studioCommit(true,()=>undefined);
  const w=await service.marginWaterfall();assert(w.sales.list==='1000'&&w.cost==='400','FX import was not reconciled');
  const source=await service.sources();assert(source.some(s=>s.sourceCurrency==='CAD'&&s.fxRate==='0.5'&&s.workspaceCurrency==='EUR'),'Source FX provenance missing');
  const math=await service.marginMath('list');assert(math.rows[0].sourceCurrency==='CAD'&&math.rows[0].fxRate==='0.5','Show math lost FX');
  let blocked=false;try{await service.currencySet('GBP');}catch{blocked=true;}assert(blocked&&(await service.status()).currency==='EUR','Currency was silently relabelled');
  await service.lock();await service.unlock(secret);assert((await service.status()).currency==='EUR','Currency not in encrypted snapshot');
  assert((await service.sources()).some(s=>s.sourceCurrency==='CAD'&&s.fxRate==='0.5'),'Reload lost rate');
  const pdf=await(await service.leakReport('en')).blob.text();assert(pdf.includes('EUR')&&pdf.includes('\\20010.00')&&!pdf.includes(String.fromCharCode(36)),'Report PDF lost workspace denomination');
  const point=await service.priceCheck('P','C','1');assert(point.bookCents==='800','Quote price did not use converted item amount');
  return {sourceFx:true,showMath:true,encryptedReload:true,changeBlocked:true,quotePrice:true,pdf:true};
 }finally{await service.lock().catch(()=>undefined);await reset(scope);}
}

async function rebatesFlow(){
 const scope={userId:'rebates-'+crypto.randomUUID(),tenantId:'rebates-'+crypto.randomUUID()},service=new VaultService(()=>undefined);
 await service.init(scope);await service.create(secret,'professional','Synthetic rebate owner');
 const call=async(action:string,data:Record<string,unknown>={})=>dispatch(service,{id:'rebates',action,data} as any,{signal:()=>new AbortController().signal,progress:()=>undefined}) as Promise<any>;
 try{
  await call('currencySet',{currency:'CAD'});
  const terms=(rate='2')=>'program_id,party,rate_percent,threshold_amount,period_start,period_end,calculation_mode,to_amount,eligible_skus,excluded_skus,party_type,rebate_treatment\nNORTH,C,'+rate+',0,2026-01-01,2026-03-31,retroactive,,,,customer,replace\n';
  const sales='line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount,invoice_id\n1,P,C,2026-03-31,1,29500.00,0,0,350.00,10000.00,I\n';
  await call('studioAdd',{files:[new File([terms()],'customer-rebate-agreement.csv'),new File([sales],'rebate-sales.csv')]});
  let st=await call('studioState');assert(st.files.some((f:any)=>f.role==='rebate_agreement'&&f.loadable),'Agreement is not recognized/loadable');
  st=await call('studioPlan');assert(st.report.rejected==='0'&&st.report.rebateTerms,'Complete customer terms rejected or confirmation missing');let unconfirmed=false;try{await call('studioCommit',{acknowledge:false});}catch{unconfirmed=true;}assert(unconfirmed,'Program activates without explicit term acknowledgement');await call('studioCommit',{acknowledge:true});
  let value=await call('rebateState'),p=value.programs[0];assert(value.progress.currency==='CAD'&&value.progress.rows[0].earned==='59000','CAD NorthStar accrual differs');assert(value.reconciliation.booked==='35000'&&value.reconciliation.adjustment==='24000'&&value.reconciliation.recognized==='59000'&&value.reconciliation.valid,'Waterfall rebate does not reconcile');
  assert((await call('marginWaterfall')).sales.rebate==='59000','Waterfall bypassed the shared accruals');const math=await call('marginMath',{metric:'rebate'});assert(math.rows[0].recordedRebate==='35000'&&math.rows[0].rebate==='59000'&&math.rowsAgree&&math.check.agrees,'Show the math lost imported/recognized amounts');
  const proof=await call('rebateRows',{id:p.id});assert(proof.rows[0].row==='2'&&proof.rows[0].booked==='35000'&&proof.rows[0].accrued==='59000','Source-linked rebate evidence differs');
  let blocked=false;try{await call('rebateDelete',{id:p.id});}catch(e){blocked=(e as {code:string}).code==='REBATE';}assert(blocked,'File terms can be deleted outside source tracking');
  await call('rolePreview',{role:'sales_rep'});const rep=await call('rebateProgress');assert(rep.rows[0].earned==='59000'&&!/cost|margin/i.test(JSON.stringify(rep)),'Rep progress leaks costs');for(const action of ['rebateState','rebateRows','rebateSave','rebateDelete','rebateRecalculate']){blocked=false;try{await call(action,{id:p.id});}catch(e){blocked=(e as {code:string}).code==='FORBIDDEN';}assert(blocked,'Rep reached privileged rebate command');}await call('rolePreview',{role:null});
  await service.lock();await call('unlock',{passphrase:secret});assert((await call('rebateState')).reconciliation.recognized==='59000','Encrypted reload lost accrued rebate view');
  const manual={reference:'MANUAL',customer:'OTHER',from:'2026-01-01',to:'2026-12-31',mode:'incremental',treatment:'additional',eligible:'P',excluded:'',enabled:true,tiers:[{from:'1000',to:'2000',rate:'2'},{from:'2000',to:'',rate:'3'}]};
  const saved=await call('rebateSave',{input:manual}),m=saved.programs.find((r:any)=>r.reference==='MANUAL');await call('rebateSave',{input:{...manual,id:m.id,enabled:false}});await call('rebateDelete',{id:m.id});assert((await call('verify')).valid,'Manual changes damaged audit chain');
  await call('studioClear');await call('studioAdd',{files:[new File([terms('3')],'customer-rebate-agreement.csv')],replaces:p.source});await call('studioPlan');await call('studioCommit',{acknowledge:true});value=await call('rebateState');assert(value.programs.length===1&&value.progress.rows[0].earned==='88500','Agreement replace did not recalculate');
  await call('sourceRemove',{id:value.programs[0].source});assert((await call('marginWaterfall')).sales.rebate==='35000'&&(await call('rebateState')).programs.length===0,'Source removal did not restore original invoice rebates');assert((await call('verify')).valid,'Source tracking damaged audit chain');
  return {currency:'CAD',northStar590:true,adjustment240:true,sourceEvidence:true,importReplaceRemove:true,repSafe:true,encryptedReload:true,manualCrud:true,audit:true};
 }finally{await service.lock();await reset(scope);}
}


async function suppliersFlow(){
 const scope={userId:'suppliers-'+crypto.randomUUID(),tenantId:'suppliers-'+crypto.randomUUID()},service=new VaultService(()=>undefined);
 await service.init(scope);await service.create(secret,'professional','Synthetic supplier owner');
 const call=async(action:string,data:Record<string,unknown>={})=>dispatch(service,{id:'suppliers',action,data} as any,{signal:()=>new AbortController().signal,progress:()=>undefined}) as Promise<any>;
 try{
 await call('currencySet',{currency:'CAD'});
 const csv='line_id,receipt_ref,supplier,product_id,receipt_date,quantity,purchase_amount,entry_kind,uom\n1,PO1,N,P,2026-03-31,1,30000.00,receipt,EA\n2,PO2,N,P,2026-03-31,1,400.00,return,EA\n3,PO3,N,P,2026-03-31,0,100.00,credit_memo,EA\n';
 await call('studioAdd',{files:[new File([csv],'po-receipts.csv')]});let st=await call('studioState');assert(st.files[0].role==='purchases'&&st.files[0].loadable,'PO receipts not recognized');st=await call('studioPlan');assert(st.report.rejected==='0','Valid receipts rejected');await call('studioCommit',{acknowledge:true});
 const input={reference:'SUPPLIER-NORTH',supplier:'N',program:'Quarterly',type:'rebate',from:'2026-01-01',to:'2026-03-31',due:'2026-04-30',mode:'retroactive',eligible:'',excluded:'',requested:'',authorization:'',tiers:[{from:'0',to:'',rate:'2'}],confirmed:true};
 let p=await call('supplierClaimSave',{input});const id=p.claim.id;assert(p.currency==='CAD'&&p.live.spend==='2950000'&&p.live.earned==='59000','Supplier CAD net spend/earned differ');
 const g=await call('supplierPurchases',{grid:{totals:['amount_cents'],filters:[{col:'entry_kind',values:['receipt']}]}});assert(g.grid.matched==='1'&&g.grid.totals.amount_cents.sum==='3000000','Supplier worker grid does not filter/total');
 await call('noteSet',{kind:'product',id:'P',text:'PRIVATE-SUPPLIER-NOTE'});
 const csvFile=await call('supplierClaimExport',{id,format:'csv',fingerprint:p.fingerprint});const text=await csvFile.blob.text();assert(text.includes('CAD')&&text.includes('590.00')&&text.includes('29500.00')&&!text.includes('PRIVATE-SUPPLIER-NOTE'),'Supplier CSV lost currency/exact amount or exposed notes');
 p=await call('supplierClaimPreview',{id});assert(p.claim.status==='prepared'&&p.claim.claimed==='59000','Export did not freeze amount');const xlsx=await call('supplierClaimExport',{id,format:'xlsx',fingerprint:p.fingerprint});assert(xlsx.blob.size>1000,'XLSX export is empty');
 for(const status of ['submitted','approved','paid'])p=await call('supplierClaimStatus',{id,status});assert(p.claim.status==='paid','Claim status flow failed');
 await call('rolePreview',{role:'sales_rep'});for(const action of ['supplierClaims','supplierPurchases','supplierProgress','supplierClaimPreview','supplierClaimSave','supplierClaimStatus','supplierClaimExport']){let blocked=false;try{await call(action,{id});}catch(e){blocked=(e as {code:string}).code==='FORBIDDEN';}assert(blocked,'Rep reached a supplier command');}await call('rolePreview',{role:null});
 await service.lock();await call('unlock',{passphrase:secret});p=await call('supplierClaimPreview',{id});assert(p.claim.status==='paid'&&p.claim.claimed==='59000'&&(await call('status')).schemaVersion==='17','Encrypted v16 snapshot lost claim');
 const source=(await call('sources')).find((s:any)=>s.role==='purchases');assert(source,'Purchase source kind missing');await call('studioClear');await call('studioAdd',{files:[new File([csv.replace('30000.00','31000.00')],'po-receipts.csv')],replaces:source.id});await call('studioPlan');await call('studioCommit',{acknowledge:true});p=await call('supplierClaimPreview',{id});assert(p.claim.claimed==='59000'&&p.live.earned==='61000','Replacement rewrote frozen claim or failed to update live attainment');let blocked=false;try{await call('supplierClaimExport',{id,format:'csv',fingerprint:p.fingerprint});}catch{blocked=true;}assert(blocked,'Changed evidence silently re-exported');
 await call('sourceRemove',{id:(await call('sources')).find((s:any)=>s.role==='purchases').id});assert((await call('supplierPurchases')).grid.total==='0','Purchase removal left rows');assert((await call('verify')).valid,'Supplier changes damaged audit');
 const audit=JSON.stringify((await service.engine!.conn.query('SELECT details FROM audit_log')).toArray());assert(!audit.includes('SUPPLIER-NORTH')&&!audit.includes('PRIVATE-SUPPLIER-NOTE'),'Supplier audit carries business terms');
 return {currency:'CAD',spend29500:true,earned590:true,returnsCredits:true,workerGrid:true,exactExports:true,noNotes:true,statusFlow:true,repDenied:true,encryptedV16:true,replacementFrozen:true,sourceRemoval:true,audit:true};
 }finally{await service.lock();await reset(scope);}
}


async function reportsFlow(){
 const scope={userId:'reports-'+crypto.randomUUID(),tenantId:'reports-'+crypto.randomUUID()},service=new VaultService(()=>undefined);await service.init(scope);await service.create(secret,'professional','Synthetic reporting owner');
 const call=async(action:string,data:Record<string,unknown>={})=>dispatch(service,{id:'reports',action,data} as any,{signal:()=>new AbortController().signal,progress:()=>undefined}) as Promise<any>;
 try{await call('currencySet',{currency:'CAD'});const csv='line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount,invoice_id\n1,P,C,2026-11-01,1,100.00,10.00,20.00,0,80.00,NOV\n2,P,C,2026-10-01,1,100.00,0,0,0,70.00,OCT\n3,P,C,2026-07-01,1,100.00,0,0,0,10.00,JUL\n';const items='product_id,description,category,uom,current_cost,list_price\nP,Valve,Valves,EA,80.00,120.00\n',customers='customer_id,name,tier\nC,Synthetic,T\n';
 await call('studioAdd',{files:[new File([csv],'reports-sales.csv'),new File([items],'reports-items.csv'),new File([customers],'reports-customers.csv')]});await call('studioPlan');await call('studioCommit',{acknowledge:true});await call('guardSet',{input:{tier:'T',category:'Valves',start:'12000',target:'10000',floor:'8000'}});await call('noteSet',{kind:'product',id:'P',text:'NEVER-EXPORT-REPORT-NOTE'});
 const run=await call('pricePlan',{input:{segment:'category',value:'Valves',increase:'10'}});await call('ruleApprove',{id:run.id});await call('priceExport',{id:run.id,profile:'generic',format:'csv'});await call('leaks');const finding=(await call('roiRows',{kind:'findings'})).rows[0];assert(finding,'Real ROI findings absent');assert((await call('roiV2')).recoveredCents==='0','An export became recovery');
 await call('roiRecord',{input:{ledger:finding.id,run:run.id,amount:'1.25',reference:'PRIVATE-RECOVERY-REF',from:'2026-11-01',to:'2026-11-09',confirmed:true}});assert((await call('roiV2')).recoveredCents==='125','Recovery is not exact cents');
 let p=await call('reportCheck',{kind:'monthly',month:'2026-11'});assert(p.currency==='CAD'&&p.bridge.delta==='-4000'&&p.roi.recoveredCents==='125','Monthly pack lost currency or shared-engine numbers');
 for(const locale of ['en','es','fr']){const file=await call('reportExport',{id:p.id,locale}),text=await file.blob.text();assert(text.startsWith('%PDF-1.4')&&text.includes('CAD')&&!text.includes('NEVER-EXPORT-REPORT-NOTE'),'Localized PDF invalid or contains notes');}
 p=await call('reportCheck',{kind:'weekly'});assert(p.health&&p.health.thresholdBp==='500','Weekly digest omitted existing health checks');await call('reportExport',{id:p.id,locale:'fr'});
 let quote=await call('quoteCreate',{customerId:'C'});quote=await call('quoteLines',{id:quote.id,lines:[{productId:'P',quantity:'1',unitCents:'11000'}]});await call('quoteSubmit',{id:quote.id,reason:null});
 await call('rolePreview',{role:'sales_rep'});let sc=await call('scorecard',{from:'2026-11-01',to:'2026-12-31'});assert(sc.view==='team'&&sc.total.protectedPoints==='2'&&!/cost|margin|8000/.test(JSON.stringify(sc)),'Scorecard leaks or points differ');await call('scorecardOptIn',{optIn:true});sc=await call('scorecard',{view:'mine',from:'2026-11-01',to:'2026-12-31'});assert(sc.optIn&&sc.total.protectedPoints==='2','Self opt-in failed');for(const action of ['reportState','reportCheck','reportExport','roiV2','roiRows','roiRecord','roiVoid']){let denied=false;try{await call(action,{});}catch(e){denied=(e as any).code==='FORBIDDEN';}assert(denied,'Rep received reporting money');}await call('rolePreview',{role:null});
 const r=(await call('roiRows',{kind:'recoveries'})).rows[0];await call('roiVoid',{id:r.id});assert((await call('roiV2')).recoveredCents==='0','Void lost exact reconciliation');await service.lock();await call('unlock',{passphrase:secret});const state=await call('reportState');assert(state.checks.length===2&&state.ready===null,'Last-check persistence or cache clearing failed');assert((await call('scorecard')).optIn,'Consent did not survive encrypted reload');assert((await call('verify')).valid,'Report/recovery/consent writes damaged audit');const audit=JSON.stringify((await service.engine!.conn.query('SELECT details FROM audit_log')).toArray());assert(!audit.includes('PRIVATE-RECOVERY-REF')&&!audit.includes('NEVER-EXPORT-REPORT-NOTE'),'Reporting audit contains private text');
 return {schema:'17',currency:'CAD',monthlySharedMath:true,weeklyHealth:true,localizedPdfs:true,noNotes:true,exactRecoveryVoid:true,noExportAsRecovery:true,teamDefault:true,selfOptIn:true,repSafe:true,encryptedReload:true,audit:true};
 }finally{await service.lock();await reset(scope);}
}

self.onmessage = async event => {
  try {
    const { action } = event.data;
    if (action === "assetRejection") {
      let opened = false;
      try { const engine = await openMemory(); opened = true; await closeMemory(engine); }
      catch { /* Both native Fetch SRI and our byte check must fail closed. */ }
      assert(!opened, "Tampered engine asset was executed");
      self.postMessage({ result: { tamperedAssetRejected: true } }); return;
    }
    const result = action === "reports" ? await reportsFlow() : action === "suppliers" ? await suppliersFlow() : action === "rebates" ? await rebatesFlow() : action === "monitor" ? await monitorFlow() : action === "currency" ? await currencyFlow() : action === "pricingTools" ? await pricingToolsFlow() : action === "pricingOps" ? await pricingOpsFlow() : action === "phase5aBenchmark" ? await phase5aBenchmark() : action === "phase5a" ? await phase5a() : action === "pricing" ? await pricingFlow() : action === "legacyStorage" ? await legacyStorage() : action === "pricingBenchmark" ? await pricingBenchmark() : action === "fixture" ? await fixture() : action === "v1" ? await testFixture(event.data.bytes) : action === "seed" ? await seed(event.data.rows) : action === "firstChange" ? await firstChange(event.data.rows) : action === "integrity" ? await integrity() : action === "studio" ? await studio() : action === "mapper" ? await mapper() : action === "playground" ? await playground() : action === "margin" ? await margin() : action === "marginBenchmark" ? await marginBenchmark(event.data.rows) : action === "studioBenchmark" ? await studioBenchmark(event.data.rows) : action === "warmup" ? await warmup() : action === "cipherOnly" ? await cipherOnly() : await storageStatus();
    self.postMessage({ result });
  } catch (e) { self.postMessage({ error: e instanceof Error ? e.message : "test worker failed" }); }
};
