// Recovery and device onboarding (20 Nov 2026; audit B-3, B-5).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VaultStorage, type Head } from "../lib/vault/storage";
import { ACTION_CAP } from "../lib/roles/access";
import { READ_ONLY_ACTIONS } from "../lib/vault/licence";

/** A minimal in-memory stand-in for an OPFS directory: just what VaultStorage uses. */
function folder(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const handle = {
    async *entries() { for (const name of [...store.keys()]) yield [name, { kind: "file" }] as [string, { kind: string }]; },
    async removeEntry(name: string) { if (!store.delete(name)) throw new DOMException("missing", "NotFoundError"); },
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!store.has(name) && !opts?.create) throw new DOMException("missing", "NotFoundError");
      let text = "";
      return { async createWritable() { return { async write(v: string) { text += v; }, async close() { store.set(name, text); }, async abort() {} }; }, async getFile() { return new Blob([store.get(name) ?? ""]); } };
    },
  };
  return { store, handle: handle as unknown as FileSystemDirectoryHandle };
}
const snap = (n: number) => `snapshot-${String(n).repeat(8)}-0000-4000-8000-000000000000.enc`;

test("B-3: start again removes every file of this vault folder", async () => {
  const { store, handle } = folder({ "head.json": "{}", "head.previous.json": "{}", [snap(1)]: "a", [snap(2)]: "b" });
  const s = new VaultStorage(handle, "scope"); s.activeHead = { format: 1, current: snap(2), previous: snap(1), sequence: "2", savedAt: "x" };
  await s.clear();
  assert.equal(store.size, 0); assert.equal(s.activeHead, null);
});

test("B-3: after a passphrase change only the snapshot under the new key is kept", async () => {
  const { store, handle } = folder({ "head.json": "{}", "head.previous.json": "{}", [snap(1)]: "old", [snap(2)]: "older", [snap(3)]: "new" });
  const s = new VaultStorage(handle, "scope"); s.activeHead = { format: 1, current: snap(3), previous: snap(1), sequence: "3", savedAt: "x" };
  await s.dropOlder();
  assert.deepEqual([...store.keys()].sort(), ["head.json", snap(3)].sort());
  const head = JSON.parse(store.get("head.json")!) as Head;
  assert.deepEqual([head.current, head.previous, head.sequence], [snap(3), null, "3"], "the pointer no longer names an older snapshot");
  // A missing head.previous.json is fine (a vault saved once).
  const again = folder({ "head.json": "{}", [snap(4)]: "only" }); const t = new VaultStorage(again.handle, "scope");
  t.activeHead = { format: 1, current: snap(4), previous: null, sequence: "1", savedAt: "x" }; await t.dropOlder();
  assert.deepEqual([...again.store.keys()].sort(), ["head.json", snap(4)].sort());
});

test("B-3: the recovery commands are wired, guarded and need no extra capability", () => {
  assert.equal(ACTION_CAP.vaultReset, null); assert.equal(ACTION_CAP.passphraseChange, null);
  assert.ok(!READ_ONLY_ACTIONS.has("vaultReset") && !READ_ONLY_ACTIONS.has("passphraseChange"));
  const src = readFileSync("lib/vault/service.ts", "utf8");
  assert.match(src, /licenceGuard\(action:Action\) \{ if \(action === "vaultReset"\) return; this\.licence\.guard\(action\); \}/);
  const reset = src.slice(src.indexOf("async vaultReset()"), src.indexOf("async passphraseChange("));
  assert.match(reset, /if \(this\.engine\) throw new VaultError\("STATE"/, "start again only while locked");
  assert.match(reset, /await this\.lease\(\);[^]*await this\.storage\.clear\(\)/, "and only while no other tab holds the vault");
  const change = src.slice(src.indexOf("async passphraseChange("), src.indexOf("private requireEngine()"));
  const order = ["await decrypt(", "deriveKey(next)", "this.key = key", "await this.write(\"vault.passphrase_changed\"", "await this.storage.dropOlder()"].map(x => change.indexOf(x));
  assert.ok(order.every(i => i > 0) && order.every((v, i) => !i || v > order[i - 1]), "check the current passphrase, re-key, save, then drop older copies");
  assert.match(change, /catch \(error\) \{ this\.key = old; throw error; \}/, "a failed save keeps the old key");
});

test("B-5: device emails go to the workspace Owner only", () => {
  const src = readFileSync("lib/licence-admin-api.ts", "utf8");
  assert.match(src, /ctx\.role==='owner'\?'SELECT d\.id,d\.user_id,d\.status,d\.created_at,m\.email FROM licence_device d LEFT JOIN membership m/);
  assert.match(src, /NULL::text AS email FROM licence_device/);
  assert.match(src, /canApprove:ctx\.role==='owner'/);
});
