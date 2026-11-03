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
  assert(result.schemaVersion === "2" && result.lines === "1", "V1 snapshot did not upgrade with its row intact");
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
  const service = new VaultService(() => { void service.lock().then(() => { idle = true; }); }, 150);
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
  const extra = new VaultService(() => undefined); await extra.init(scope);
  let blocked = false; try { await extra.unlock(secret); } catch (e) { blocked = (e as { code: string }).code === "OTHER_TAB"; }
  assert(blocked, "Second writer was not blocked");
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
  // Measurement only: same production unlock, makeWritable and save paths.
  // Updating an existing synthetic product avoids bypassing the import cap.
  const service = new VaultService(() => undefined); await service.init(labScope);
  try {
    const before = await service.unlock(secret);
    assert(before.lines === String(rows) && !service.engine!.writable, "First-change benchmark did not start from an untouched read-only snapshot");
    const started = performance.now(); await makeWritable(service.engine!);
    const rebuildMs = Math.round(performance.now() - started);
    await service.engine!.conn.query("BEGIN; UPDATE products SET description='Synthetic first-change measurement' WHERE product_id='1'");
    await appendAudit(service.engine!, "fixture.first_change", { rows: String(rows) }); await service.engine!.conn.query("COMMIT");
    (service as unknown as { dirty: boolean }).dirty = true; await service.save();
    const totalMs = Math.round(performance.now() - started), after = await service.status();
    assert(after.lines === before.lines && after.products === before.products && after.customers === before.customers, "First change altered row counts");
    assert(BigInt(after.auditEntries) === BigInt(before.auditEntries) + BigInt(1) && (await service.verify()).valid, "First change was not audited");
    await service.lock(); await service.unlock(secret);
    const saved = (await service.engine!.conn.query("SELECT description FROM products WHERE product_id='1'")).toArray()[0];
    assert(saved.description === "Synthetic first-change measurement" && (await service.verify()).valid, "First change did not survive encrypted reopen");
    return { rows: String(rows), rebuildMs, totalMs, overTenSeconds: totalMs > 10000, rowCountsUnchanged: true, auditedAndDurable: true };
  } finally { await service.lock(); }
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
    const result = action === "fixture" ? await fixture() : action === "v1" ? await testFixture(event.data.bytes) : action === "seed" ? await seed(event.data.rows) : action === "firstChange" ? await firstChange(event.data.rows) : action === "integrity" ? await integrity() : action === "cipherOnly" ? await cipherOnly() : await storageStatus();
    self.postMessage({ result });
  } catch (e) { self.postMessage({ error: e instanceof Error ? e.message : "test worker failed" }); }
};
