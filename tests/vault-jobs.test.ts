// Review flaw 10: Cancel stops the page job, never a background job that happens to be running.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CANCELLABLE, Jobs } from "../lib/vault/jobs";

const gate = () => { let open!: () => void; const p = new Promise<void>(r => { open = r; }); return { p, open }; };

test("flaw 10: Cancel during a background sync leaves the sync alone and stops the queued import", async () => {
  const jobs = new Jobs(), sync = gate();
  let syncFinished = false, importRan = false;
  const bg = jobs.background(async () => { await sync.p; syncFinished = true; });
  const imp = jobs.enqueue("r1", "studioCommit"), status = jobs.enqueue("r2", "status");
  assert.equal(jobs.cancel(), false, "no page job is running, so no database query is interrupted");
  sync.open(); await bg;
  assert.ok(syncFinished, "the background sync ran to the end");
  await assert.rejects(jobs.page("r1", imp, async () => { importRan = true; }), (e: Error) => e.name === "AbortError");
  assert.ok(!importRan && imp.signal.aborted, "the queued import never started");
  assert.equal(await jobs.page("r2", status, async () => "ok"), "ok", "a quick read is not cancelled");
});

test("flaw 10: Cancel during a page job aborts that job only, and a later job starts clean", async () => {
  const jobs = new Jobs(), hold = gate();
  const a = jobs.enqueue("a", "simRun"), b = jobs.enqueue("b", "studioPlan");
  const run = jobs.page("a", a, async () => { await hold.p; return a.signal.aborted; });
  assert.equal(jobs.cancel(), true, "the running page job's query should be interrupted");
  hold.open();
  assert.equal(await run, true);
  assert.equal(b.signal.aborted, false, "the next job keeps its own cancellation scope");
  assert.equal(await jobs.page("b", b, async () => "planned"), "planned");
});

test("flaw 10: locking stops background work too, and the cancellable list covers the jobs that show Cancel", async () => {
  const jobs = new Jobs(), hold = gate();
  const bg = jobs.background(async () => { await hold.p; });
  jobs.lock(); hold.open(); await bg;
  const bg2 = jobs.background(async () => undefined); await bg2;
  for (const a of ["studioCommit", "studioPlan", "simRun", "reportCheck", "agentRun", "relaySync", "relayView", "sharePublish", "playgroundLoad"]) assert.ok(CANCELLABLE(a), a);
  for (const a of ["status", "touch", "lock", "save", "relay", "studioState", "quoteSave"]) assert.ok(!CANCELLABLE(a), a);
  const src = readFileSync(new URL("../lib/vault/worker.ts", import.meta.url), "utf8");
  for (const fn of ["agentsDue", "folderPickupDue", "relayBackground", "backupDue", "autoLock"]) assert.match(src, new RegExp(`jobs\\.background\\([^\\n]*service\\.${fn}\\(`), fn + " runs as background work");
  assert.doesNotMatch(src, /\babort\.abort\(\)/, "no global abort controller is left");
});
