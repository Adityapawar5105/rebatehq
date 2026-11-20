// First-run activation (20 Nov 2026): the vault status says whether only the Playground's sample files are loaded,
// so Home can offer a start card and every screen can show the sample-data banner.
import test from "node:test";
import assert from "node:assert/strict";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { schemaSql, tablesFor, SCHEMA_VERSION } from "../lib/vault/schema";
import { PLAYGROUND_PREFIX, SAMPLE_COUNTS_SQL, sampleState } from "../lib/studio/playground";

test("sample state from the counts of sample and real files", () => {
  assert.equal(sampleState(0, 0), "empty");
  assert.equal(sampleState(5, 0), "only");
  assert.equal(sampleState(5, 1), "mixed");
  assert.equal(sampleState(0, 2), "none");
});

test("the sample counts query tells Playground files from real ones by their name prefix", async () => {
  const c = await duckdbConnection();
  try {
    for (const table of [...tablesFor(SCHEMA_VERSION)].reverse()) c.query(`DROP TABLE IF EXISTS ${table}`);
    c.query(schemaSql(SCHEMA_VERSION));
    const state = () => { const r = q(c, SAMPLE_COUNTS_SQL)[0]; return sampleState(Number(r.sample), Number(r.real)); };
    assert.equal(state(), "empty");
    c.query(`INSERT INTO source_files(id,name,role,bytes,imported_at) VALUES('p1','${PLAYGROUND_PREFIX}sales.csv','sales_history',1,'2026-11-20'),('p2','${PLAYGROUND_PREFIX}items.csv','item_master',1,'2026-11-20')`);
    assert.equal(state(), "only");
    c.query(`INSERT INTO source_files(id,name,role,bytes,imported_at) VALUES('r1','Playground notes.csv','customer_list',1,'2026-11-20')`); // no " - ": a real file
    assert.equal(state(), "mixed");
    c.query(`DELETE FROM source_files WHERE id IN ('p1','p2')`);
    assert.equal(state(), "none");
  } finally { c.close(); }
});
