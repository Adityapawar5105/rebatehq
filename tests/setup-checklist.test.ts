// 5A guided 7-day setup checklist: steps are detected from the vault, never from sample data, and stay done.
import test from "node:test";
import assert from "node:assert/strict";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { schemaSql, tablesFor, SETUP_STEPS } from "../lib/vault/schema";
import { read, saveSql, detect, STEP_INFO } from "../lib/setup/checklist";
import { PLAYGROUND_PREFIX } from "../lib/studio/playground";
import type { Engine } from "../lib/vault/engine";
async function fresh() {
  const c = await duckdbConnection();
  for (const table of [...tablesFor(10)].reverse()) c.query(`DROP TABLE IF EXISTS ${table}`);
  c.query(schemaSql(10));
  c.query("INSERT INTO vault_meta VALUES(1,10,'starter','unit','tip',0,0); INSERT INTO audit_log VALUES(1,'a','2025-01-01T09:00:00.000Z','vault.created','{}','0','h')");
  return { c, e: { conn: c } as unknown as Engine };
}
const audit = (c: Awaited<ReturnType<typeof duckdbConnection>>, n: number, action: string, details = "{}") => c.query(`INSERT INTO audit_log VALUES(${n},'id${n}','2025-01-02T09:00:00.000Z','${action}','${details}','p','h${n}')`);
test("a new vault has seven steps, none done, and the schedule runs over seven days", async () => {
  const { c, e } = await fresh();
  try {
    const { view, newly } = await read(e, new Date("2025-01-01T12:00:00.000Z"));
    assert.deepEqual(view.steps.map(s => s.step), [...SETUP_STEPS]); assert.equal(view.total, 7); assert.equal(view.done, 0); assert.equal(newly.length, 0);
    assert.equal(view.day, 1); assert.equal(view.complete, false); assert.equal(view.hasOwner, false);
    assert.deepEqual(view.steps.map(s => s.day), [1, 1, 2, 3, 4, 5, 7]); assert.deepEqual(view.steps.filter(s => s.manual).map(s => s.step), ["team"]);
    assert.equal((await read(e, new Date("2025-01-04T12:00:00.000Z"))).view.day, 4);
    for (const s of SETUP_STEPS) assert.ok(STEP_INFO[s].hint.length > 10 && STEP_INFO[s].where.startsWith("#"));
  } finally { c.close(); }
});
test("each step is detected from real data and Playground sample data never counts", async () => {
  const { c, e } = await fresh();
  try {
    c.query(`INSERT INTO source_files VALUES('p1','${PLAYGROUND_PREFIX}sales.csv','sales_history',1,'x'),('p2','${PLAYGROUND_PREFIX}items.csv','item_master',1,'x')`);
    assert.deepEqual(Object.values(await detect(e)).filter(Boolean), []); // sample files prove nothing
    c.query("INSERT INTO source_files VALUES('s1','real-sales.csv','sales_history',1,'x')");
    let d = await detect(e); assert.equal(d.import, true); assert.equal(d.map, false); assert.equal(d.fix, true); // no rejected rows left = nothing to fix
    c.query("INSERT INTO rejected_rows(source_id,source_row,role,code,status) VALUES('s1',5,'sales_history','date','open')");
    d = await detect(e); assert.equal(d.fix, false); // an open rejected row is still waiting
    audit(c, 2, "cleanup.applied"); d = await detect(e); assert.equal(d.fix, true); // or the cleanup was used
    c.query("INSERT INTO source_files VALUES('i1','real-items.csv','item_master',1,'x')"); assert.equal((await detect(e)).map, true);
    assert.equal((await detect(e)).report, false);
    audit(c, 3, "report.leak_pdf", '{"sample":"true"}'); assert.equal((await detect(e)).report, false); // a sample PDF is not a first report
    audit(c, 4, "report.leak_pdf", '{"findings":"3","sample":"false"}'); assert.equal((await detect(e)).report, true);
    c.query("INSERT INTO rules VALUES('r','Rule','{}','Valves','2025-01-01')"); assert.equal((await detect(e)).rule, true);
    assert.equal((await detect(e)).export, false); audit(c, 5, "pricing.exported"); assert.equal((await detect(e)).export, true);
    assert.equal((await detect(e)).team, false);
    c.query("INSERT INTO role_assignments VALUES('u1','A','owner','u1','t'),('u2','B','sales_rep','u1','t')"); assert.equal((await detect(e)).team, true);
  } finally { c.close(); }
});
test("progress is stored: reached steps stay done after the data goes, and the team step can be marked by hand", async () => {
  const { c, e } = await fresh();
  try {
    c.query("INSERT INTO source_files VALUES('s1','real-sales.csv','sales_history',1,'x')");
    const first = await read(e, new Date("2025-01-02T10:00:00.000Z")); assert.deepEqual(first.newly, ["import", "fix"]);
    c.query(saveSql(first.newly, "auto", "2025-01-02T10:00:00.000Z"));
    c.query("DELETE FROM source_files"); // the file is removed later
    const later = await read(e, new Date("2025-01-09T10:00:00.000Z"));
    assert.equal(later.newly.length, 0); assert.deepEqual(later.view.steps.filter(s => s.done).map(s => s.step), ["import", "fix"]);
    assert.equal(later.view.steps[0].doneAt, "2025-01-02T10:00:00.000Z"); assert.equal(later.view.steps[0].how, "auto"); assert.equal(later.view.day, 9);
    c.query(saveSql(["team"], "manual", "2025-01-10T00:00:00.000Z")); c.query(saveSql(["team"], "manual", "2025-01-11T00:00:00.000Z")); // a second save changes nothing
    const marked = (await read(e)).view.steps.find(s => s.step === "team")!;
    assert.equal(marked.done, true); assert.equal(marked.how, "manual"); assert.equal(marked.doneAt, "2025-01-10T00:00:00.000Z");
    assert.equal(q(c, "SELECT count(*) AS n FROM setup_progress")[0].n, "3");
    assert.equal(saveSql([], "auto", "t"), "");
    for (const s of SETUP_STEPS.filter(x => !["import", "fix", "team"].includes(x))) c.query(saveSql([s], "auto", "2025-01-12T00:00:00.000Z"));
    assert.equal((await read(e)).view.complete, true);
    c.query("INSERT INTO pricing_settings VALUES(1,'u','Pat',7)"); assert.equal((await read(e)).view.hasOwner, true);
    assert.throws(() => c.query("INSERT INTO setup_progress VALUES('bogus','t','auto')"), /CHECK|constraint/i); // only the seven steps exist
  } finally { c.close(); }
});
