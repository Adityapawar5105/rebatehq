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
