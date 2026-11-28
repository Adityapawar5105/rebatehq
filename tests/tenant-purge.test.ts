// Review R3: the 30-day purge deletes a workspace's encrypted chunks through the Storage API, only under its own prefix.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BATCH, BUCKET, batches, deleteRequest, storageHeaders } from "../scripts/purge-deleted-tenants";

const T = "11111111-2222-3333-4444-555555555555";

test("R3 purge: Storage deletes go to the relay-packs bucket in batches of at most 1,000 names", () => {
  assert.equal(BUCKET, "relay-packs");
  const names = Array.from({ length: 2345 }, (_, i) => `${T}/p/${i}`);
  const parts = batches(names);
  assert.deepEqual(parts.map(p => p.length), [1000, 1000, 345]);
  assert.deepEqual(parts.flat(), names);
  assert.deepEqual(batches([]), []);
  const { url, init } = deleteRequest("https://abc.supabase.co", "sb_secret_x", T, parts[2]);
  assert.equal(url, "https://abc.supabase.co/storage/v1/object/relay-packs");
  assert.equal(init.method, "DELETE");
  assert.deepEqual(JSON.parse(String(init.body)), { prefixes: parts[2] });
});

test("R3 purge: a delete never reaches outside the workspace prefix", () => {
  const ok = [`${T}/a`];
  for (const bad of [[`${T}x/a`], ["22222222-2222-3333-4444-555555555555/a"], [`${T}/../other/a`], [`${T}/a`, "a"]])
    assert.throws(() => deleteRequest("https://abc.supabase.co", "sb_secret_x", T, bad), /outside the workspace prefix/, String(bad));
  assert.throws(() => deleteRequest("https://abc.supabase.co", "sb_secret_x", "not-a-uuid", ok), /Invalid workspace id/);
  assert.throws(() => deleteRequest("https://abc.supabase.co", "sb_secret_x", T, []), /1 to 1000/);
  assert.throws(() => deleteRequest("https://abc.supabase.co", "sb_secret_x", T, Array(BATCH + 1).fill(`${T}/a`)), /1 to 1000/);
});

test("R3 purge: the Storage key is required, never a publishable key, and sent as supabase-js sends it", () => {
  assert.throws(() => storageHeaders(""), /SUPABASE_SECRET_KEY/);
  assert.throws(() => storageHeaders("sb_publishable_x"), /publishable/);
  assert.deepEqual(storageHeaders("sb_secret_x"), { apikey: "sb_secret_x", authorization: "Bearer sb_secret_x", "content-type": "application/json" });
});

test("R3 purge: the script is no longer suspended, dry-runs by default and removes rows only after Storage is empty", () => {
  const src = readFileSync(new URL("../scripts/purge-deleted-tenants.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /suspended/i);
  assert.match(src, /CONFIRM_TENANT_PURGE !== "YES"/);
  assert.match(src, /argv\.includes\("--apply"\)/);
  assert.match(src, /interval '30 days'/);
  const storage = src.indexOf("deleteRequest(base"), check = src.indexOf("are still there"), rows = src.indexOf("rebatehq_private.purge_deleted_tenant(");
  assert.ok(storage > 0 && storage < check && check < rows, "Storage objects are deleted and re-counted before the rows are purged");
  assert.doesNotMatch(src, /DELETE FROM storage\.objects/i);
});
