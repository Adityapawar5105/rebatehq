// State machine clean-up (roadmap Phase 9, 20 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("B-12: the Cancel button follows the progress kind, never the English text of the step", () => {
  const app = readFileSync("components/local/VaultApp.tsx", "utf8");
  assert.ok(!/stage\.startsWith\(/.test(app), "the page must not read the step's words to decide anything");
  assert.match(app, /progress\.kind !== "save" && <Button/);
  assert.match(readFileSync("lib/vault/worker.ts", "utf8"), /post\(\{ event: "progress", stage, done, total, \.\.\.\(kind \? \{ kind \} : \{\}\) \}\)/);
  const service = readFileSync("lib/vault/service.ts", "utf8");
  // Every progress step that announces the snapshot save is marked as a save.
  const saves = [...service.matchAll(/progress\(msg\((["'])vault\.(savingEncryptedSnapshot|saved)\1\)[^)]*\)/g)].map(m => m[0]);
  assert.ok(saves.length >= 3, "the save steps were found");
  for (const call of saves) assert.match(call, /["']save["']\)$/, call);
});

test("audit 1.3: an import plan reviewed before another change to the vault is refused", () => {
  const src = readFileSync("lib/vault/service.ts", "utf8");
  assert.match(src, /await this\.studio\.plan\(this\.requireEngine\(\), this\.tier, signal, progress\); this\.planVersion = this\.dataVersion;/);
  const commit = src.slice(src.indexOf("async studioCommit("), src.indexOf("async studioCommit(") + 400);
  assert.match(commit, /if \(this\.planVersion !== this\.dataVersion\) throw new VaultError\("STUDIO", msg\("studio\.planStale"\)\);/);
  assert.ok(commit.indexOf("planStale") < commit.indexOf("await this.writable("), "checked before anything is written");
});

test("roadmap 9.2: the vault status carries one phase, decided in the worker, beside the old flags", async () => {
  const { vaultPhase } = await import("../lib/vault/protocol");
  const base = { state: "unlocked" as const, exists: true, dirty: false, preparing: false, licence: { writable: true } };
  assert.equal(vaultPhase({ ...base, state: "locked", exists: false }), "none");
  assert.equal(vaultPhase({ ...base, state: "locked" }), "locked");
  assert.equal(vaultPhase({ ...base, licence: { writable: false }, dirty: true }), "readOnly", "a read-only licence outranks unsaved changes");
  assert.equal(vaultPhase({ ...base, dirty: true, preparing: true }), "unsaved");
  assert.equal(vaultPhase({ ...base, preparing: true }), "preparing");
  assert.equal(vaultPhase(base), "ready");
  assert.equal(vaultPhase({ ...base, licence: undefined }), "ready", "no licence yet (lab) is not read-only");
  const service = readFileSync("lib/vault/service.ts", "utf8"), app = readFileSync("components/local/VaultApp.tsx", "utf8");
  assert.match(service, /base\.phase = vaultPhase\(base\);/, "status() sets the phase from its own facts");
  assert.match(app, /status\.phase !== "none" && status\.phase !== "locked"/); assert.match(app, /status\?\.phase === "preparing"/);
});

test("roadmap 9.4: the engine warm-up is one value that moves snapshot, copying, copied or failed, then writable", async () => {
  const { startWarmup, makeWritable, readyToWrite } = await import("../lib/vault/engine");
  type E = Parameters<typeof startWarmup>[0];
  const conn = (fail: boolean) => ({ query: async (sql: string) => { if (fail && !/ROLLBACK/.test(sql)) throw new Error("copy failed"); return { toArray: () => [{ schema_version: 21 }] }; }, close: async () => undefined });
  const engine = (fail: boolean) => ({ warm: "snapshot", warming: null, conn: conn(false), db: { connect: async () => conn(fail), dropFile: async () => undefined } }) as unknown as E;
  const ok = engine(false);
  assert.equal(readyToWrite(ok), false);
  const job = startWarmup(ok); assert.equal(ok.warm, "copying", "the copy is marked running at once");
  assert.equal(await job, true); assert.equal(ok.warm, "copied"); assert.equal(readyToWrite(ok), true);
  await makeWritable(ok); assert.equal(ok.warm, "writable"); assert.equal(ok.warming, null);
  assert.equal(startWarmup(ok), null, "a writable engine starts no copy");
  const bad = engine(true);
  assert.equal(await startWarmup(bad), false); assert.equal(bad.warm, "failed"); assert.equal(readyToWrite(bad), false);
  await makeWritable(bad); assert.equal(bad.warm, "writable", "after a failed background copy the first change copies on the main connection");
  const src = readFileSync("lib/vault/engine.ts", "utf8");
  assert.doesNotMatch(src, /warmDone|warmReady|writable: boolean/, "the four warm-up flags are gone");
});
