import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { deriveKey, encrypt, decrypt } from "../lib/vault/crypto";
import { VaultStorage } from "../lib/vault/storage";
import { verifyEntries, auditPayload, GENESIS, type AuditEntry } from "../lib/vault/audit";
import { digest } from "../lib/vault/crypto";
import { CAPS } from "../lib/vault/protocol";
import { estimateImport } from "../lib/vault/ingest";
import { upgradeSql, schemaSql, tablesFor, TABLES, V1_SQL, SALES_LINES_V5, SALES_LINES_V8 } from "../lib/vault/schema";
import { closeMemory } from "../lib/vault/engine";
class FakeDirectory {
  files = new Map<string, Uint8Array>(); failName = "";
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) { if (!options?.create) throw new DOMException("missing", "NotFoundError"); this.files.set(name, new Uint8Array()); }
    return {
      getFile: async () => new File([new Uint8Array(this.files.get(name)!)], name),
      createWritable: async () => {
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        return {
          write: async (value: string | Uint8Array) => { if (name === this.failName) throw new Error("simulated interrupted write"); chunks.push(typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value)); },
          close: async () => { this.files.set(name, new Uint8Array(await new Blob(chunks).arrayBuffer())); },
          abort: async () => undefined,
        };
      },
    };
  }
  async *entries() { for (const name of this.files.keys()) yield [name, { kind: "file" }] as const; }
  async removeEntry(name: string) { this.files.delete(name); }
}
test("vault lock terminates its engine worker even when connection close fails", async () => {
  const calls: string[] = [];
  const engine = { conn: { async close() { calls.push("close"); throw new Error("simulated damaged connection"); } }, db: { async terminate() { calls.push("database terminated"); } }, worker: { terminate() { calls.push("worker terminated"); } } };
  await assert.rejects(closeMemory(engine as unknown as Parameters<typeof closeMemory>[0]), /damaged connection/);
  assert.deepEqual(calls, ["close", "database terminated", "worker terminated"]);
});
test("vault snapshots authenticate scope, sequence, all chunks and key settings", async () => {
  const directory = new FakeDirectory(), storage = new VaultStorage(directory as unknown as FileSystemDirectoryHandle, "unit-scope");
  const key = await deriveKey("unit-vault-passphrase"), plain = new Uint8Array(1024 * 1024 + 7).fill(42);
  const head = await storage.publish(plain, key, "1"), file = await storage.file(head.current);
  assert.deepEqual((await decrypt(file, "unit-vault-passphrase", "unit-scope")).bytes, plain);
  await assert.rejects(decrypt(file, "wrong-test-passphrase", "unit-scope"), /Wrong passphrase/);
  await assert.rejects(decrypt(file, "unit-vault-passphrase", "other-scope"));
  const bytes = new Uint8Array(await file.arrayBuffer()); bytes[bytes.length - 1] ^= 1;
  await assert.rejects(decrypt(new Blob([bytes]), "unit-vault-passphrase", "unit-scope"));
  await assert.rejects(decrypt(file.slice(0, -1), "unit-vault-passphrase", "unit-scope"));
  const replaced = new Uint8Array(await file.arrayBuffer());
  const length = new DataView(replaced.buffer).getUint32(8);
  const header = new TextDecoder().decode(replaced.subarray(12, 12 + length));
  replaced.set(new TextEncoder().encode(header.replace('"sequence":"1"', '"sequence":"2"')), 12);
  await assert.rejects(decrypt(new Blob([replaced]), "unit-vault-passphrase", "unit-scope"));
});
test("snapshot publication preserves committed generations at every failed pointer/write step", async () => {
  const directory = new FakeDirectory(), key = await deriveKey("unit-vault-passphrase");
  const storage = new VaultStorage(directory as unknown as FileSystemDirectoryHandle, "unit-scope");
  directory.failName = "head.json";
  await assert.rejects(storage.publish(new Uint8Array([0]), key, "1"));
  assert.equal(await storage.exists(), false, "Failed initial publication must permit a safe creation retry");
  directory.failName = "";
  const first = await storage.publish(new Uint8Array([1, 2, 3]), key, "1");
  for (const name of ["head.previous.json", "head.json"]) {
    directory.failName = name;
    await assert.rejects(storage.publish(new Uint8Array([4, 5, 6]), key, "2"));
    assert.equal((await storage.readHead())!.current, first.current);
    assert.deepEqual((await decrypt(await storage.file(first.current), "unit-vault-passphrase", "unit-scope")).bytes, new Uint8Array([1, 2, 3]));
    directory.failName = "";
  }
  const second = await storage.publish(new Uint8Array([7, 8, 9]), key, "2");
  assert.equal(second.previous, first.current);
  const current = directory.files.get(second.current)!; current[current.length - 1] ^= 1;
  const candidates = await storage.candidates();
  await assert.rejects(decrypt(await storage.file(candidates[0].name), "unit-vault-passphrase", "unit-scope"));
  assert.deepEqual((await decrypt(await storage.file(candidates[1].name), "unit-vault-passphrase", "unit-scope")).bytes, new Uint8Array([1, 2, 3]));
  directory.files.set("head.json", new TextEncoder().encode("interrupted pointer"));
  assert.ok((await storage.candidates()).some(c => c.name === first.current && c.recovered));
});
test("audit chain rejects tampering, truncation and reordered entries", async () => {
  const rows: AuditEntry[] = []; let previous = GENESIS;
  for (let n = 1; n <= 3; n++) { const row = { sequence: String(n), id: `id-${n}`, occurred_at: "2026-11-03", action: "test", details: "{}", previous_hash: previous, hash: "" }; row.hash = await digest(auditPayload(row)); previous = row.hash; rows.push(row); }
  async function* stream(values: AuditEntry[]) { yield* values; }
  assert.ok((await verifyEntries(stream(rows), "3", previous)).valid);
  assert.equal((await verifyEntries(stream(rows.slice(0, 2)), "3", previous)).valid, false);
  assert.equal((await verifyEntries(stream([rows[1], rows[0], rows[2]]), "3", previous)).valid, false);
  assert.equal((await verifyEntries(stream([{ ...rows[0], details: "changed" }, ...rows.slice(1)]), "3", previous)).valid, false);
});
test("RAM filesystem never delegates to OPFS and preserves exact random-access bytes", async () => {
  const listeners: Array<(event: any) => void> = [], messages: any[] = [];
  const context = vm.createContext({ navigator: { storage: { getDirectory: () => { throw new Error("real OPFS must never be called"); } } }, DOMException, Map, Uint8Array, Math, Number, Error, self: { addEventListener(_name: string, listener: (e: any) => void) { listeners.push(listener); }, postMessage(value: unknown) { messages.push(value); } } });
  vm.runInContext(readFileSync("lib/vault/ram-filesystem.js", "utf8"), context);
  const dir = await context.navigator.storage.getDirectory();
  const file = await dir.getFileHandle("vault-ram.duckdb", { create: true }), handle = await file.createSyncAccessHandle();
  handle.write(new Uint8Array([1, 2, 3]), { at: 1024 * 1024 - 1 });
  const output = new Uint8Array(5); assert.equal(handle.read(output, { at: 1024 * 1024 - 2 }), 4); assert.deepEqual(output, new Uint8Array([0, 1, 2, 3, 0]));
  listeners[0]({ data: { type: "vault-ram-export" }, stopImmediatePropagation() {} }); assert.equal(messages[0].bytes.length, 1024 * 1024 + 2);
  handle.truncate(1); handle.truncate(5); const cleared = new Uint8Array(5); handle.read(cleared); assert.deepEqual(cleared, new Uint8Array(5));
  handle.truncate(3 * 1024 * 1024);
  listeners[0]({ data: { type: "vault-ram-export" }, stopImmediatePropagation() {} });
  assert.equal(messages[1].bytes.length, 3 * 1024 * 1024); assert.ok(messages[1].bytes.every((byte: number) => byte === 0), "Unwritten sparse blocks must export as zeros");
});
test("committed encrypted v1 fixture stays frozen", () => {
  assert.equal(createHash("sha256").update(readFileSync("tests/fixtures/vault/v1.enc")).digest("hex"), "4ef3fd0ae32310ec712f0763671c52d01f6e0ed47ad8442e2f04c24e4068b492");
});
test("schema inventory, forward-only migration, capacity and memory warning are explicit", () => {
  assert.equal(TABLES.length,61); for (const table of tablesFor(1)) assert.ok(V1_SQL.includes(`CREATE TABLE ${table}(`));
  assert.deepEqual([...tablesFor(4)].filter(t => !tablesFor(3).includes(t)), ["rejected_rows"]);
  assert.ok(upgradeSql(1).includes("ALTER TABLE import_batches") && upgradeSql(1).includes("ADD COLUMN source_id") && upgradeSql(1).includes("CREATE TABLE rejected_rows"));
  assert.ok(upgradeSql(2).startsWith("ALTER TABLE products ADD COLUMN source_id"));
  assert.ok(upgradeSql(3).includes("ALTER COLUMN cost_cents DROP NOT NULL") && upgradeSql(3).startsWith("DROP INDEX")); assert.ok(upgradeSql(4).startsWith("CREATE TEMP TABLE md_v4_sales") && upgradeSql(4).includes("line_kind")); assert.ok(upgradeSql(5).includes("CREATE TABLE rule_changes")); assert.ok(upgradeSql(6).startsWith("CREATE TABLE role_assignments") && upgradeSql(6).includes("CREATE TABLE cleanup_changes") && upgradeSql(6).includes("CREATE TABLE setup_progress")); assert.ok(upgradeSql(7).startsWith("CREATE TEMP TABLE md_v7_sales") && upgradeSql(7).includes("CHECK(source_row>=1)")); assert.ok(upgradeSql(8).includes("CREATE TABLE relay_state")); assert.ok(upgradeSql(9).startsWith("CREATE TABLE source_kinds") && upgradeSql(9).includes("CREATE TABLE quote_lines") && upgradeSql(9).includes("CREATE TABLE credit_profiles")); assert.deepEqual([...tablesFor(10)].filter(t => !tablesFor(9).includes(t)), ["source_kinds", "credit_profiles", "quotes", "quote_lines"]); assert.ok(upgradeSql(10).includes("CREATE TABLE price_changesets")); assert.ok(upgradeSql(11).includes("CREATE TABLE competitor_prices")); assert.ok(upgradeSql(12).includes("source_currency")); assert.ok(upgradeSql(13).includes("CREATE TABLE rebate_programs")); assert.ok(upgradeSql(14).includes("ALTER TABLE products ADD COLUMN notes")); assert.ok(upgradeSql(15).includes("CREATE TABLE purchases")); assert.ok(upgradeSql(16).includes("CREATE TABLE roi_recoveries")); assert.ok(upgradeSql(17).startsWith("CREATE TEMP TABLE md_v17_kinds") && upgradeSql(17).includes("CREATE TABLE agent_inbox") && upgradeSql(17).includes("'cost_index'")); assert.ok(upgradeSql(18).startsWith("CREATE TEMP TABLE md_v18_kinds") && upgradeSql(18).includes("CREATE TABLE inventory_levels") && upgradeSql(18).includes("'clearance'")); assert.ok(upgradeSql(19).startsWith("CREATE TABLE quote_outcomes")); assert.ok(upgradeSql(20).startsWith("CREATE TABLE bench_family_map")); assert.equal(upgradeSql(21), ""); assert.throws(() => upgradeSql(22));
  assert.ok(SALES_LINES_V8.includes("CHECK(source_row>=1)") && !SALES_LINES_V8.includes("source_row>=2") && SALES_LINES_V8.replace("source_row>=1", "source_row>=2") === SALES_LINES_V5, "v8 only relaxes the source-row check");
  assert.deepEqual([...tablesFor(8)], [...tablesFor(7)], "v8 adds no table");
  assert.deepEqual(tablesFor(9).filter(t=>!tablesFor(8).includes(t)),["relay_state"]);
  assert.deepEqual([...tablesFor(7)].filter(t => !tablesFor(6).includes(t)), ["role_assignments", "access_settings", "cleanup_fixes", "cleanup_changes", "setup_progress"]);
  assert.deepEqual([...tablesFor(5)].filter(t => !tablesFor(4).includes(t)), ["agg_cpm", "agg_cm", "agg_p", "recon_issues"]);
  assert.equal(schemaSql(21), [V1_SQL, upgradeSql(1)].join("\n"));
  assert.equal(CAPS.scale.lines, 2000000); assert.equal(CAPS.starter.products, 20000);
  assert.equal(estimateImport({ name: "sales.csv", size: 1000 }, "professional").estimatedMemoryBytes, "6000");
  assert.throws(() => estimateImport({ name: "sales.xlsx", size: 1000 }, "starter"));
  assert.throws(() => estimateImport({ name: "sales.csv", size: 257 * 1024 * 1024 }, "starter"));
});
test("local data paths contain no business API, raw SQL protocol, or real OPFS worker handle", () => {
  const ui = readFileSync("components/local/PricingView.tsx", "utf8") + readFileSync("components/local/BackupView.tsx", "utf8") + readFileSync("components/local/VaultApp.tsx", "utf8") + readFileSync("components/local/ImportStudio.tsx", "utf8") + readFileSync("components/local/MarginView.tsx", "utf8"), engine = readFileSync("lib/vault/engine.ts", "utf8"), protocol = readFileSync("lib/vault/protocol.ts", "utf8");
  assert.ok(!/\.query\(|fetch\(|JSON\.stringify|console\./.test(ui));
  const studio = ["formats", "text", "sheets", "rows", "load", "studio", "mapper", "clean", "fixlater", "health", "playground"].map(f => readFileSync(`lib/studio/${f}.ts`, "utf8")).join("\n");
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|console\.|importScripts/.test(studio), "Import Studio must not make network calls or log");
  const margin = ["decimal", "engine", "sql", "aggregate", "views", "leaks", "roi", "pdf", "report", "credits"].map(f => readFileSync(`lib/margin/${f}.ts`, "utf8")).join("\n");
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|console\.|importScripts|navigator\.|Math\.random|parseFloat/.test(margin), "The margin engine must not make network calls, log, or use floats for parsing");
  assert.ok(!/sql:|query:/.test(protocol)); assert.ok(engine.includes('verifiedAssetUrl("vault-ram-worker.js")'));
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8"); assert.ok(workflow.includes("pnpm test:vault:privacy")); assert.ok(!workflow.includes("continue-on-error"));
  // CI #87 hung for 6 hours in apt inside `playwright install --with-deps`: every job and the network-bound steps have limits.
  assert.match(workflow, /verify:\n\s+runs-on: [^\n]+\n(\s+#[^\n]*\n)*\s+timeout-minutes: \d+/); assert.match(readFileSync(".github/workflows/restore-drill.yml", "utf8"), /restore-drill:\n\s+runs-on: [^\n]+\n(\s+#[^\n]*\n)*\s+timeout-minutes: \d+/);
  // CI #145: a stalled mirror can still hang --with-deps, so both installs use one script with a browser-only fallback.
  const install = readFileSync("scripts/ci-install-browser.sh", "utf8");
  assert.ok(workflow.includes("run: bash scripts/ci-install-browser.sh chromium") && workflow.includes("run: bash scripts/ci-install-browser.sh firefox") && !/^\s+pnpm exec playwright install/m.test(workflow), "both browser installs go through the bounded script");
  assert.ok(/timeout (-k \d+ )?\d+ pnpm exec playwright install --with-deps "\$browser"/.test(install) && /timeout (-k \d+ )?\d+ pnpm exec playwright install "\$browser"/.test(install) && install.includes('Acquire::http::Timeout') && install.includes('DPkg::Lock::Timeout') && install.includes("pgrep -x dpkg") && install.includes(".launch()"), "the browser install is bounded, retried, falls back without apt and proves a launch");
  assert.match(workflow, /Required Firefox local-vault lab gate\n\s+timeout-minutes: \d+/);
  assert.ok(workflow.includes('pnpm test:vault --browser=firefox'));
  assert.match(workflow,/verify:\n\s+runs-on: [^\n]+\n(\s+#[^\n]*\n)*\s+timeout-minutes: 60/);
  assert.ok(!readFileSync("scripts/vault-test-auth.mjs", "utf8").includes("setSession("));
  assert.ok(readFileSync("app/lab/vault/page.tsx", "utf8").includes('process.env.VAULT_LAB_ENABLED !== "true"'));
});
