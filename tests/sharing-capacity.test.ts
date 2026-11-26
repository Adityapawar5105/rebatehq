// Review R2 (flaw 3.9): shared items count against the receiving vault's capacity, like imported items do.
import test from "node:test";
import assert from "node:assert/strict";
import { duckdbConnection, rows } from "./helpers/duckdb-node";
import { schemaSql, SCHEMA_VERSION, TABLES } from "../lib/vault/schema";
import { VaultService } from "../lib/vault/service";
import { PACKS, type PackData } from "../lib/sharing/packs";
import { LICENCE_LIMITS } from "../lib/licence-policy";

type Apply = (action: string, details: Record<string, string>, entries: unknown[], via: "file" | "relay", role: string | null) => Promise<number>;
async function vault(tier: "starter" | "professional") {
  const c = await duckdbConnection();
  c.query("DROP VIEW IF EXISTS rebate_sales"); for (const t of [...TABLES].reverse()) c.query(`DROP TABLE IF EXISTS ${t}`);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count,pricing_revision) VALUES(1,${SCHEMA_VERSION},'${tier}','unit','tip',0,0)`);
  const e = { conn: { query: async (sql: string) => c.query(sql) } };
  const s = new VaultService(() => undefined) as unknown as Record<string, unknown>;
  s.engine = e; s.identity = { userId: "u1", tenantId: "t" }; s.tier = tier;
  s.writable = async () => e; s.save = async () => undefined; s.touch = () => undefined;
  return { c, apply: (s.applyShared as Apply).bind(s) };
}
const items = (n: number, prefix: string): PackData => [{ part: 0, columns: PACKS.items.parts[0].columns.map(k => k.name), rows: Array.from({ length: n }, (_, i) => [`${prefix}${i}`, "Item", "Cat", "EA", "100", null]) }];
const entry = (data: PackData) => ({ pack: "items", data, version: "1", publisherId: "p", publisherName: "Pat", publishedAt: "2026-11-26T00:00:00Z", hash: "h" });

test("review R2: a shared items pack that would pass the vault's product cap is refused and nothing is written", async () => {
  const cap = LICENCE_LIMITS.starter.products;
  const { c, apply } = await vault("starter");
  try {
    c.query(`INSERT INTO products(product_id) SELECT 'L'||i FROM range(${cap - 1}) t(i)`);
    // Shared items add to the items already held (same keys are replaced), so 2 new ones pass a Starter vault's cap.
    await assert.rejects(apply("share.imported", {}, [entry(items(2, "S"))], "file", null), (e: any) => e?.code === "LICENCE" && /Starter capacity/.test(e.message));
    assert.equal(rows(c, "SELECT count(*) AS n FROM products")[0].n, String(cap - 1), "the refused pack wrote nothing");
    await apply("share.imported", {}, [entry(items(1, "S"))], "file", null);
    assert.equal(rows(c, "SELECT count(*) AS n FROM products")[0].n, String(cap), "a pack that fits applies");
  } finally { c.close(); }
});
