// Review flaws 11, 12, 13, 15 and 16 (26 Nov 2026 full project review, fixed 28 Nov 2026). Flaw 10 is in
// vault-jobs.test.ts, flaw 14 in roles.test.ts; flaw 15 is also driven through dispatch in the browser gate (phase5a).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_VAULT_BYTES, NEAR_VAULT_BYTES } from "../lib/vault/crypto";
import { mib, snapshotTimeout, vaultSize } from "../lib/vault/service";
import { ACTIONS, LOCKED_ACTIONS } from "../lib/roles/access";
import { en } from "../lib/i18n/locales/en";

const service = readFileSync(new URL("../lib/vault/service.ts", import.meta.url), "utf8");
const body = (name: string) => { const at = service.indexOf(name); assert.ok(at > 0, name); return service.slice(at, service.indexOf("\n  async ", at + name.length)); };

test("flaw 11: the vault warns from 85% of its 512 MiB limit, refuses a bigger save with its own message, and gives large snapshots more time", () => {
  assert.equal(MAX_VAULT_BYTES, 512 * 1024 * 1024);
  assert.equal(vaultSize(0), undefined);
  assert.deepEqual(vaultSize(100 * 1024 * 1024), { bytes: String(100 * 1024 * 1024), limit: String(MAX_VAULT_BYTES), near: false });
  assert.equal(vaultSize(NEAR_VAULT_BYTES - 1)!.near, false);
  assert.equal(vaultSize(NEAR_VAULT_BYTES)!.near, true);
  assert.equal(mib(MAX_VAULT_BYTES), "512"); assert.equal(mib(1), "1");
  assert.equal(snapshotTimeout(0), 10_000);
  assert.equal(snapshotTimeout(400 * 1024 * 1024), 110_000);
  assert.equal(snapshotTimeout(10 * MAX_VAULT_BYTES), 180_000);
  const save = body("async save()");
  assert.ok(save.indexOf("bytes.byteLength > MAX_VAULT_BYTES") < save.indexOf("this.storage.publish"), "an oversized snapshot is refused before anything is written");
  assert.match(save, /vault\.size\.tooLarge/);
  assert.match(en["shell.sizeNear"], /\{used\}.*\{limit\}/);
});

test("flaw 12: a failed schema upgrade rolls back and says so, instead of leaving an open transaction and 'wrong passphrase'", () => {
  const migrate = service.slice(service.indexOf("private async migrate()"), service.indexOf("async unlock("));
  const begin = migrate.indexOf('query("BEGIN")'), tryAt = migrate.indexOf("try {"), upgrade = migrate.indexOf("UPDATE vault_meta SET schema_version");
  assert.ok(begin > 0 && begin < tryAt && tryAt < upgrade, "the upgrade statements run inside the try that rolls back");
  assert.match(migrate, /ROLLBACK/); assert.match(migrate, /new VaultError\("UPGRADE"/);
  assert.match(en["vault.upgradeFailed"], /Nothing was changed/);
});

test("flaw 13: the audit pack and glossary state what an unkeyed hash chain cannot prove", () => {
  assert.match(en["auditpack.limits"], /no secret key/);
  assert.match(en["glossary.auditChain.def"], /no secret key/);
  assert.doesNotMatch(en["shell.desc.reports"], /tamper/);
  assert.match(readFileSync(new URL("../lib/reports/auditpack.ts", import.meta.url), "utf8"), /auditpack\.limits/);
});

test("flaw 15: while locked only backupStatus may pass a capability check, and it reads local settings only", () => {
  assert.deepEqual([...LOCKED_ACTIONS], ["backupStatus"]);
  for (const a of LOCKED_ACTIONS) assert.equal(ACTIONS[a].mode, "read");
  const guard = service.slice(service.indexOf("async guard(cap"), service.indexOf("private async seedRoles"));
  assert.match(guard, /if \(!this\.engine\) \{ if \(action && LOCKED_ACTIONS\.has\(action\)\) return; throw new VaultError\("LOCKED"/);
  assert.match(readFileSync(new URL("../lib/vault/dispatch.ts", import.meta.url), "utf8"), /service\.guard\(ACTION_CAP\[request\.action\], request\.action\)/);
});

test("flaw 16: rule approval rebuilds totals in its own transaction; a failed rebuild after import is retried and then redone in the next change; reconciliation is audited", () => {
  const approve = body("async ruleApprove(");
  assert.match(approve, /await this\.financialBody\(e\);\}\);/, "the rebuild runs inside the approval's write");
  assert.doesNotMatch(approve, /this\.derived\(/);
  const commit = body("async studioCommit(");
  assert.match(commit, /this\.derivedStale = !rebuilt/); assert.match(commit, /totalsStale: true/);
  const write = service.slice(service.indexOf("private async write(action"), service.indexOf("// ---- 5A"));
  assert.ok(write.indexOf("if(this.derivedStale)await this.financialBody(e)") < write.indexOf("COMMIT"), "stale totals are rebuilt before the next change commits");
  assert.match(body("async reconcile()"), /appendAudit\(w, "reconcile\.recorded"/);
  assert.match(en["studio.totalsStale"], /next change/);
});
