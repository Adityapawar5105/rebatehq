// Test-only worker, bundled under test-results and intercepted by Playwright.
// It is never included by the production asset build or exposed by app routes.
import { VaultService } from "../../lib/vault/service";
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
const labScope = { userId: "synthetic-lab-user", tenantId: "synthetic-lab-workspace" };
const fixtureScope = { userId: "synthetic-v1-fixture-user", tenantId: "synthetic-v1-fixture-workspace" };
const secret = "synthetic-local-vault-passphrase";
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
async function reset(scope: typeof labScope) {
  const storage = await VaultStorage.open(scope);
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("margindesk-vaults");
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
  assert(result.schemaVersion === "3" && result.lines === "1", "V1 snapshot did not upgrade with its row intact");
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
  for (let at = 0; at < rows; at += 50_000) await engine.conn.query(`INSERT INTO sales_lines SELECT '${source}',i+1,((i%100000)+1)::VARCHAR,((i*13%2000)+1)::VARCHAR,(DATE '2024-01-01'+INTERVAL (least(23,(i*24)//${rows})) MONTH)::DATE,(i%5)+1,10000+(i%997)*29,(i%21)*50,100+i%599,CASE WHEN i%7=0 THEN 200 ELSE 0 END,6000+(i%991)*23,i+2 FROM range(${at},${Math.min(rows, at + 50_000)})t(i) ORDER BY 4,5,2`);
  await appendAudit(engine, "fixture.synthetic_benchmark", { rows: String(rows) }); await engine.conn.query("COMMIT");
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
  const roles = Object.fromEntries(state.files.map(f => [f.kind, f.role]));
  assert(roles.xls === "item_master" && roles.ods === "customer_list" && roles.xlsb === "vendor_cost" && roles.json === "price_list" && roles.xml === "rebate_agreement", `Role detection wrong: ${JSON.stringify(roles)}`);
  report = (await service.studioPlan(signal(), noop)).report!;
  assert(report.loaded === "9" && report.rejected === "0" && report.warnings.some(w => /rebates.xml: Rebate agreement files are converted only/.test(w)), `Mixed batch report wrong: ${report.loaded}/${report.rejected}`);
  out = await service.studioCommit(false, noop);
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
  result.formats = { xls: true, ods: true, xlsb: true, json: true, xml: "converted only" };
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
  // 13 + messy-checks - March + (April replaced) + 4 mixed - item master + 2 encoded = 18 sources.
  assert((await service.status()).lines === "120" && (await service.sources()).length === 18, "Studio results did not survive encrypted reopen");
  await service.lock(); await reset(scope);
  return result;
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
self.onmessage = async event => {
  try {
    const { action } = event.data;
    const result = action === "fixture" ? await fixture() : action === "v1" ? await testFixture(event.data.bytes) : action === "seed" ? await seed(event.data.rows) : action === "firstChange" ? await firstChange(event.data.rows) : action === "integrity" ? await integrity() : action === "studio" ? await studio() : action === "studioBenchmark" ? await studioBenchmark(event.data.rows) : action === "warmup" ? await warmup() : action === "cipherOnly" ? await cipherOnly() : await storageStatus();
    self.postMessage({ result });
  } catch (e) { self.postMessage({ error: e instanceof Error ? e.message : "test worker failed" }); }
};
