// Chunk 8C-1: win/loss log, audit and compliance pack, and local templates. Expected values are worked out by hand.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import Papa from "papaparse";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { schemaSql, TABLES, SCHEMA_VERSION, tablesFor, upgradeSql } from "../lib/vault/schema";
import type { Engine } from "../lib/vault/engine";
import * as wl from "../lib/quotes/winloss";
import { auditPack } from "../lib/reports/auditpack";
import { negotiationSheet, rebateAgreement } from "../lib/reports/templates";
import { appendAudit, GENESIS } from "../lib/vault/audit";
import { VaultService } from "../lib/vault/service";
import { dispatch } from "../lib/vault/dispatch";
import { VaultError, type Request } from "../lib/vault/protocol";
import { ACTION_CAP } from "../lib/roles/access";
import { READ_ONLY_ACTIONS } from "../lib/vault/licence";

const AT = "2026-11-01T10:00:00.000Z";
async function vault() {
  const c = await duckdbConnection();
  c.query("DROP VIEW IF EXISTS rebate_sales");
  for (const t of [...TABLES].reverse()) c.query("DROP TABLE IF EXISTS " + t);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count) VALUES(1,${SCHEMA_VERSION},'professional','unit','${GENESIS}',0);
INSERT INTO products(product_id,description,category,current_cost,list_price) VALUES('P1','Valve','Valves',6000,10000),('P2','Pipe','Pipe',NULL,1500);
INSERT INTO customers(customer_id,name,tier) VALUES('C1','Acme','T1'),('C2','Beta','T1');
INSERT INTO role_assignments VALUES('own','Owner','owner','own','2026-01-01'),('rep','Rep One','sales_rep','own','2026-01-01'),('rep2','Rep Two','sales_rep','own','2026-01-01'),('sm','Manager','sales_manager','own','2026-01-01'),('acc','Books','accountant','own','2026-01-01');
INSERT INTO quotes(id,number,customer_id,status,created_by,created_at,updated_at) VALUES
 ('q1','Q-1','C1','submitted','rep','${AT}','${AT}'),('q2','Q-2','C2','approved','rep','${AT}','${AT}'),('q3','Q-3','C1','submitted','rep2','${AT}','${AT}'),
 ('q4','Q-4','C1','draft','rep','${AT}','${AT}'),('q5','Q-5','C2','pending','rep2','${AT}','${AT}');
INSERT INTO quote_lines(quote_id,line_no,product_id,quantity,unit_price_cents,price_source,guard_status,cost_cents) VALUES
 ('q1',1,'P1',2,10000,'list','unset',6000),('q2',1,'P1',1,9000,'list','unset',6000),('q3',1,'P2',3,1500,'list','unset',NULL),('q4',1,'P1',1,10000,'list','unset',6000),('q5',1,'P1',1.5,3333,'list','unset',2000);`);
  return { c, e: { conn: { query: async (s: string) => c.query(s) } } as unknown as Engine };
}
const record = async (c: { query: (s: string) => unknown }, e: Engine, id: string, input: wl.OutcomeInput) => c.query(await wl.outcomeSql(e, id, input, "rep", AT));
const SEED: [string, wl.OutcomeInput][] = [["q1", { outcome: "won", reason: "price" }], ["q2", { outcome: "lost", reason: "competitor", competitor: "Acme Supply", note: "They matched list less 12%" }], ["q3", { outcome: "lost", reason: "price" }], ["q5", { outcome: "no_decision", reason: "timing" }]];
/** Text shown by a RebateHQ PDF: the strings of its Tj operators, octal escapes decoded as WinAnsi (Latin-1 range). */
const pdfText = (bytes: Uint8Array) => [...Buffer.from(bytes).toString("latin1").matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(m => m[1].replace(/\\([0-7]{3}|.)/g, (_, x: string) => x.length === 3 ? String.fromCharCode(parseInt(x, 8)) : x)).join(" ");

test("8C-1 schema v20: one outcome per quote, codes checked", async () => {
  assert.ok(SCHEMA_VERSION >= 20);
  assert.deepEqual(tablesFor(20).filter(t => !tablesFor(19).includes(t)), ["quote_outcomes"]);
  assert.ok(upgradeSql(19).startsWith("CREATE TABLE quote_outcomes")); assert.ok(!upgradeSql(20).includes("quote_outcomes"), "v20 tables are created once");
  const { c } = await vault();
  try {
    assert.throws(() => c.query(`INSERT INTO quote_outcomes VALUES('q1','maybe','price',NULL,NULL,'rep','${AT}')`));
    assert.throws(() => c.query(`INSERT INTO quote_outcomes VALUES('q1','won','luck',NULL,NULL,'rep','${AT}')`));
  } finally { c.close(); }
});

test("8C-1 outcomes: recorded on sent quotes only, validated, replaced on change", async () => {
  const { c, e } = await vault();
  try {
    await record(c, e, "q1", { outcome: "lost", reason: "price" });
    await record(c, e, "q1", { outcome: "won", reason: "relationship", competitor: "  ", note: "Signed" });
    assert.deepEqual(await wl.outcomeOf(e, "q1"), { outcome: "won", reason: "relationship", competitor: null, note: "Signed", recordedBy: "rep", recordedAt: AT });
    await assert.rejects(wl.outcomeSql(e, "q4", { outcome: "won", reason: "price" }, "rep", AT), (x: unknown) => x instanceof VaultError && x.code === "WINLOSS", "a draft has no outcome");
    await assert.rejects(wl.outcomeSql(e, "q5", { outcome: "won", reason: "price" }, "rep", AT), (x: unknown) => x instanceof VaultError && x.code === "WINLOSS", "a pending exception is not won");
    assert.ok((await wl.outcomeSql(e, "q5", { outcome: "lost", reason: "price" }, "rep", AT)).includes("'lost'"), "a pending quote can still be lost");
    for (const bad of [{ outcome: "maybe", reason: "price" }, { outcome: "won", reason: "luck" }, { outcome: "won", reason: "price", competitor: "x".repeat(101) }, { outcome: "won", reason: "price", note: "x".repeat(1001) }, { outcome: "won", reason: "price", note: "a\u0000b" }])
      await assert.rejects(wl.outcomeSql(e, "q1", bad, "rep", AT), VaultError);
    await assert.rejects(wl.outcomeSql(e, "nope", { outcome: "won", reason: "price" }, "rep", AT), VaultError);
  } finally { c.close(); }
});

test("8C-1 report by reason, customer and rep, with exact values; reps see their own quotes and no margin", async () => {
  const { c, e } = await vault();
  try {
    for (const [id, input] of SEED) await record(c, e, id, input);
    const range = { from: "2026-10-01", to: "2026-11-10" }, owner = { userId: "own", mineOnly: false, withCost: true };
    // q1 won: 2 × 100.00 = 200.00, margin 2 × 40.00 = 80.00. q2 lost: 90.00, margin 30.00. q3 lost: 3 × 15.00 = 45.00, no cost.
    // q5 no decision: 1.5 × 33.33 = 49.995 -> 50.00. Win rate = won ÷ (won + lost).
    const reason = await wl.report(e, { ...range, by: "reason" }, owner), byKey = Object.fromEntries(reason.rows.map(r => [r.key, r]));
    assert.deepEqual(byKey.price, { key: "price", label: "price", quotes: "2", won: "1", lost: "1", open: "0", won_value: "20000", lost_value: "4500", won_margin: "8000", lost_margin: "0", win_rate: "50.00" });
    assert.deepEqual([byKey.competitor.lost_value, byKey.competitor.lost_margin, byKey.competitor.win_rate], ["9000", "3000", "0.00"]);
    assert.deepEqual([byKey.timing.open, byKey.timing.win_rate], ["1", null]);
    assert.deepEqual(reason.total, { quotes: "4", won: "1", lost: "2", open: "1", winRate: "33.33", wonValue: "20000", lostValue: "13500", wonMargin: "8000", lostMargin: "3000" });
    const customer = await wl.report(e, { ...range, by: "customer" }, owner);
    assert.deepEqual(customer.rows.map(r => [r.key, r.label, r.won, r.lost, r.open]).sort(), [["C1", "Acme", "1", "1", "0"], ["C2", "Beta", "0", "1", "1"]]);
    const rep = await wl.report(e, { ...range, by: "rep" }, owner);
    assert.deepEqual(rep.rows.map(r => [r.key, r.label, r.quotes]).sort(), [["rep", "Rep One", "2"], ["rep2", "Rep Two", "2"]]);
    // A Sales Rep: only q1 and q2, and no margin anywhere in the payload.
    const mine = await wl.report(e, { ...range, by: "reason" }, { userId: "rep", mineOnly: true, withCost: false });
    assert.deepEqual(mine.rows.map(r => r.key).sort(), ["competitor", "price"]); assert.deepEqual([mine.total.quotes, mine.total.winRate], ["2", "50.00"]);
    assert.ok(!/margin/i.test(JSON.stringify(mine)), "a rep report carries margin");
    assert.equal((await wl.report(e, { from: "2026-10-01", to: "2026-10-31" }, owner)).total.quotes, "0", "outcomes are filtered by the date they were recorded");
    const sorted = await wl.report(e, { ...range, by: "reason", grid: { sort: { col: "lost_value", dir: "desc" } } }, owner);
    assert.deepEqual(sorted.rows.map(r => r.key), ["competitor", "price", "timing"]);
    await assert.rejects(wl.report(e, { from: "2026-11-10", to: "2026-10-01" }, owner), VaultError);
  } finally { c.close(); }
});

test("8C-1 audit pack: an independent check of the exported chain, the files, the cover page and tamper detection", async () => {
  const { c, e } = await vault();
  try {
    await appendAudit(e, "roles.assigned", { actor: "own", user: "rep", role: "sales_rep" });
    await appendAudit(e, "pricing.exported", { run_id: "r1", profile: "generic" });
    await appendAudit(e, "quote.decided", { quote_id: "q2", decision: "approve" });
    c.query(`INSERT INTO price_versions VALUES('v1','r1','own','{"rows":"3","impact":"100"}','2026-11-02T00:00:00Z');
UPDATE quotes SET decided_by='sm', decided_at='2026-11-03T00:00:00Z', status='approved' WHERE id='q2';
INSERT INTO price_export_receipts VALUES('x1','r1','generic','2026-11-02T01:00:00Z','abc123','[]');
UPDATE products SET notes='NOTE-SENTINEL-8C' WHERE product_id='P1'`);
    const pack = await auditPack(e, "en", "2026-11-11T00:00:00.000Z"), zip = await JSZip.loadAsync(pack.bytes);
    assert.deepEqual(Object.keys(zip.files).sort(), ["approvals.csv", "audit-log.csv", "cover.pdf", "current-roles.csv", "export-receipts.csv", "exports.csv", "role-changes.csv", "verification.json"]);
    const log = Papa.parse<Record<string, string>>(await zip.file("audit-log.csv")!.async("string"), { header: true, skipEmptyLines: true }).data;
    let previous = GENESIS;
    for (const r of log) { // the rule in verification.json, recomputed with Node's own SHA-256
      assert.equal(r.previous_hash, previous);
      assert.equal(createHash("sha256").update(JSON.stringify([r.sequence, r.id, r.occurred_at, r.action, r.details, r.previous_hash])).digest("hex"), r.hash);
      previous = r.hash;
    }
    const v = JSON.parse(await zip.file("verification.json")!.async("string"));
    assert.deepEqual([v.format, v.entries, v.chain_valid, v.tip_hash, log.length], ["rebatehq-audit-pack/1", "3", true, previous, 3]);
    assert.deepEqual(v.counts, { approvals: 2, export_events: 1, export_receipts: 1, role_events: 1, current_roles: 5 });
    const approvals = Papa.parse<Record<string, string>>(await zip.file("approvals.csv")!.async("string"), { header: true }).data.filter(r => r.kind);
    assert.deepEqual(approvals.map(r => [r.kind, r.reference, r.decided_by, r.decision, r.rows]), [["price_change", "r1", "own", "approved", "3"], ["quote_exception", "Q-2", "sm", "approved", ""]]);
    const all = (await Promise.all(Object.values(zip.files).map(f => f.async("string")))).join("\n");
    assert.ok(!all.includes("NOTE-SENTINEL-8C") && !all.includes("10000"), "the pack holds no notes and no prices");
    const cover = pdfText(await zip.file("cover.pdf")!.async("uint8array"));
    assert.ok(cover.includes("Audit chain verified: 3 entries") && cover.includes(previous), cover);
    const coverOf = async (bytes: Uint8Array) => pdfText(await (await JSZip.loadAsync(bytes)).file("cover.pdf")!.async("uint8array"));
    assert.ok((await coverOf((await auditPack(e, "fr")).bytes)).includes("Chaîne d'audit vérifiée"), "the cover page follows the user's language");
    c.query(`UPDATE audit_log SET details='{"actor":"someone else"}' WHERE sequence=2`);
    const tampered = await auditPack(e, "en");
    assert.deepEqual([tampered.verification.chain_valid, tampered.verification.entries], [false, "2"]);
    assert.ok((await coverOf(tampered.bytes)).includes("NOT verified"));
  } finally { c.close(); }
});

test("8C-1 templates: vendor negotiation sheet and rebate agreement content", async () => {
  const { c, e } = await vault();
  try {
    c.query(`INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file) VALUES('a','V','P1',5000,'2026-01-01','f'),('b','V','P1',5500,'2026-09-01','f'),('c','W','P1',5200,'2026-08-01','f'),('d','V','P2',1000,'2026-02-01','f');
INSERT INTO source_files VALUES('s','po.csv','customer_list',1,'2026-10-01');
INSERT INTO purchases(source_id,line_id,receipt_ref,supplier,product_id,receipt_date,quantity,amount_cents,entry_kind,uom,source_row) VALUES('s',1,'R1','V','P1','2026-10-01',10,55000,'receipt','EA',2),('s',2,'R2','V','P1','2024-10-01',99,99000,'receipt','EA',3);
INSERT INTO rebate_programs(id,reference,name,customer_id,mode,booking_mode,period_start,period_end,eligible_skus,excluded_skus,enabled,created_by,created_at) VALUES('rp','ACME-2026','Growth','C1','retroactive','additional','2026-01-01','2026-12-31','','P9',true,'own','${AT}');
INSERT INTO rebate_tiers(program_id,from_cents,to_cents,rate_milli) VALUES('rp',0,1000000,2000),('rp',1000000,NULL,3500);`);
    // P1: newest V cost 55.00 (was 50.00, +10%); W quotes 52.00; 10 bought in the last 12 months (the 2024 receipt is out).
    // Matching W on that quantity: (55.00 − 52.00) × 10 = 30.00. Spend 550.00 across 2 items.
    const sheet = await negotiationSheet(e, "V", "en", "USD", "2026-11-11"), text = pdfText(sheet.bytes);
    assert.deepEqual(sheet.facts, { items: 2, spend: "55000", gap: "3000", rises: 1, cheaper: 1 });
    for (const want of ["Negotiation sheet: V", "Purchases in the last 12 months: $550.00 across 2 items", "Items another vendor quotes for less: 1. Matching those prices on last year's quantities is worth $30.00.", "P1 · Valve", "$55.00", "$50.00", "$52.00", "Talking points"])
      assert.ok(text.includes(want), `negotiation sheet is missing "${want}"`);
    assert.ok(/10(\.00)?\s?%/.test(text));
    assert.ok(!text.includes("$990.00"), "a purchase older than 12 months is counted");
    await assert.rejects(negotiationSheet(e, "Nobody", "en", "USD"), VaultError);
    const agreement = pdfText((await rebateAgreement(e, "rp", "en", "USD", "2026-11-11")).bytes);
    for (const want of ["Rebate agreement", "ACME-2026 · Growth", "Customer: Acme (account C1)", "Retroactive:", "$0.00", "$10,000.00", "No limit", "2%", "3.5%", "Eligible: all items", "Excluded: P9", "For the customer"])
      assert.ok(agreement.includes(want), `agreement is missing "${want}"`);
    assert.ok(pdfText((await rebateAgreement(e, "rp", "es", "USD")).bytes).includes("Acuerdo de reembolso"));
    await assert.rejects(rebateAgreement(e, "nope", "en", "USD"), VaultError);
  } finally { c.close(); }
});

test("8C-1 service: who records outcomes, who reads the report, the pack and the templates; tiers", async () => {
  assert.deepEqual(["quoteOutcome", "winLoss", "auditPack", "templateVendors", "negotiationSheet", "rebateAgreement"].map(a => ACTION_CAP[a as keyof typeof ACTION_CAP]), ["quote", "quote", "audit", "cost", "cost", "rebateManage"]);
  assert.ok(["winLoss", "templateVendors"].every(a => READ_ONLY_ACTIONS.has(a as never)) && ["quoteOutcome", "auditPack", "negotiationSheet", "rebateAgreement"].every(a => !READ_ONLY_ACTIONS.has(a as never)), "file exports are audited writes");
  const { c, e } = await vault();
  try {
    const make = (userId: string, tier: "starter" | "professional") => {
      const s = new VaultService(() => undefined); s.engine = e;
      Object.assign(s, { identity: { userId, tenantId: "t" }, writable: async () => e, save: async () => undefined, touch: () => ({ ok: true }) });
      const now = Math.floor(Date.now() / 1000); s.licence.claims = { v: 1, sub: userId, workspace: "t", device: "d", tier, state: "active", issued: now, expires: now + 3600, offlineUntil: now + 86400, reason: "" }; return s;
    };
    const call = (s: VaultService, action: string, data: unknown = {}) => dispatch(s, { id: "x", action, data } as Request, { signal: () => new AbortController().signal, progress: () => undefined }) as Promise<any>;
    const is = (code: string) => (x: unknown) => x instanceof VaultError && x.code === code;
    const view = await call(make("rep", "professional"), "quoteOutcome", { id: "q1", input: { outcome: "won", reason: "price" } });
    assert.equal(view.outcome.outcome, "won"); assert.ok(q(c, "SELECT action FROM audit_log").some(r => r.action === "quote.outcome"));
    await assert.rejects(call(make("rep", "professional"), "quoteOutcome", { id: "q3", input: { outcome: "won", reason: "price" } }), is("FORBIDDEN"), "a rep records outcomes on their own quotes only");
    await call(make("sm", "professional"), "quoteOutcome", { id: "q3", input: { outcome: "lost", reason: "price" } });
    await assert.rejects(call(make("rep", "professional"), "quoteOutcome", { id: "q4", input: { outcome: "won", reason: "price" } }), is("WINLOSS"));
    await assert.rejects(call(make("rep", "starter"), "winLoss"), is("LICENCE"));
    const repReport = await call(make("rep", "professional"), "winLoss", { by: "rep" });
    assert.deepEqual([repReport.mineOnly, repReport.total.quotes, "wonMargin" in repReport.total], [true, "1", false]);
    assert.equal((await call(make("sm", "professional"), "winLoss", {})).total.quotes, "2");
    for (const a of ["auditPack", "templateVendors", "negotiationSheet"]) await assert.rejects(call(make("rep", "professional"), a, { locale: "en", vendor: "V" }), is("FORBIDDEN"), a);
    await assert.rejects(call(make("sm", "professional"), "rebateAgreement", { id: "rp", locale: "en" }), is("FORBIDDEN"), "a Sales Manager does not manage rebates");
    const pack = await call(make("acc", "starter"), "auditPack", { locale: "en" });
    assert.ok(pack.name.endsWith(".zip") && pack.blob.size > 0 && pack.verification.chain_valid, "an Accountant on Starter downloads the audit pack");
    await assert.rejects(call(make("own", "starter"), "templateVendors"), is("LICENCE"));
  } finally { c.close(); }
});
