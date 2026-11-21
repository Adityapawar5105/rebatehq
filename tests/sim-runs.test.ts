// Roadmap 15.7: saved simulator runs. Totals only, a stamp of the replayed data, at most 50, deleted by id.
import test from "node:test";
import assert from "node:assert/strict";
import { duckdbConnection } from "./helpers/duckdb-node";
import { schemaSql, TABLES, SCHEMA_VERSION } from "../lib/vault/schema";
import type { Engine } from "../lib/vault/engine";
import * as simRuns from "../lib/vendor/sim-runs";

const side = { list: "1000", discount: "0", rebate: "0", freight: "0", pocket: "1000", cost: "600", costedPocket: "1000", margin: "400", rate: "0.4" };
const result = { from: "2026-01", to: "2026-03", months: "3", changes: [{ kind: "price" as const, scope: "all" as const, value: "", bp: "200" }], lines: "10", changedLines: "10", uncostedLines: "0", actual: side, scenario: { ...side, margin: "420" }, delta: { list: "20", pocket: "20", cost: "0", margin: "20" }, ms: "12" };

test("15.7 a saved run keeps totals without timing, is marked once the replayed data changes, and is capped at 50", async () => {
  const c = await duckdbConnection(); c.query("DROP VIEW IF EXISTS rebate_sales"); for (const t of [...TABLES].reverse()) c.query("DROP TABLE IF EXISTS " + t);
  c.query(schemaSql(SCHEMA_VERSION)); c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,currency) VALUES(1,${SCHEMA_VERSION},'scale','test','tip','CAD')`);
  const e = { conn: { query: async (s: string) => c.query(s) } } as unknown as Engine;
  try {
    await assert.rejects(simRuns.saveSql(e, " ", result, "a", "t"), /name of up to 80/);
    await assert.rejects(simRuns.saveSql(e, "x".repeat(81), result, "a", "t"), /name of up to 80/);
    const p = await simRuns.saveSql(e, "Plus 2% on everything", result, "analyst", "2026-11-22T09:00:00Z"); c.query(p.sql);
    let list = await simRuns.saved(e);
    assert.deepEqual(list.map(r => [r.name, r.result.scenario.margin, r.stale, "ms" in r.result]), [["Plus 2% on everything", "420", false, false]]);
    c.query("UPDATE vault_meta SET pricing_revision=pricing_revision+1 WHERE id=1");
    list = await simRuns.saved(e); assert.equal(list[0].stale, true, "a price approval since the run marks it");
    for (let i = 1; i < simRuns.MAX_SAVED_RUNS; i++) c.query((await simRuns.saveSql(e, "Run " + i, result, "analyst", "2026-11-22T10:00:00Z")).sql);
    await assert.rejects(simRuns.saveSql(e, "One more", result, "analyst", "t"), /50 runs are saved already/);
    c.query(await simRuns.deleteSql(e, p.id)); assert.equal((await simRuns.saved(e)).length, simRuns.MAX_SAVED_RUNS - 1);
    await assert.rejects(simRuns.deleteSql(e, p.id), /name of up to 80|Give the run/);
  } finally { c.close(); }
});
