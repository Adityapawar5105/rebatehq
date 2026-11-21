// Roadmap Phase 11 (Quote Desk completion; blueprint section 22, item 34), run through the real worker dispatcher:
// copy and revise, validity dates, the customer quote PDF and branding, the customer price list, the price-increase
// mailing list and barcode lookup.
import test from "node:test";
import assert from "node:assert/strict";
import { duckdbConnection } from "./helpers/duckdb-node";
import { schemaSql, tablesFor, SCHEMA_VERSION } from "../lib/vault/schema";
import { type RoleId } from "../lib/roles/access";
import { VaultService } from "../lib/vault/service";
import { dispatch } from "../lib/vault/dispatch";
import { VaultError, type Request } from "../lib/vault/protocol";
import { Pdf } from "../lib/margin/pdf";
import { businessToday, addDays } from "../lib/vault/today";

type Conn = Awaited<ReturnType<typeof duckdbConnection>>;
const people: Record<string, RoleId> = { owner1: "owner", po: "pricing_owner", rep: "sales_rep", rep2: "sales_rep" };
const COST = "4321";
async function vault() {
  const c = await duckdbConnection();
  for (const table of [...tablesFor(SCHEMA_VERSION)].reverse()) c.query(`DROP TABLE IF EXISTS ${table}`);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count,pricing_revision) VALUES(1,${SCHEMA_VERSION},'professional','unit','tip',0,0);
INSERT INTO pricing_settings VALUES(1,'po','Pat Owner',7);
INSERT INTO role_assignments VALUES ${Object.entries(people).map(([id, role]) => `('${id}','${id}','${role}','owner1','2025-01-01')`).join(",")};
INSERT INTO products(product_id,description,category,uom,current_cost,list_price,barcode) VALUES('P1','Ball valve','Valves','EA',${COST},12000,'0012345678905'),('P2','Gate valve','Valves','EA',NULL,9000,NULL),('P3','Hose','Hoses','EA',100,500,NULL);
INSERT INTO customers(customer_id,name,tier,branch,region) VALUES('C1','Acme','T01','North','East'),('C2','Beta','T02','South','West'),('C3','Corex','T01','North','East');
INSERT INTO price_guardrails(id,scope,start,target,floor,tier,category) VALUES('g1','unit_price',11000,10000,8000,'T01','Valves');
INSERT INTO price_matrix(id,product_id,category,customer_id,tier,qty_break,price,valid_from,valid_to) VALUES
 ('m1','P1','Valves',NULL,'T01',0,10500,'2025-01-01',NULL),('m3','P1','Valves','C3',NULL,0,10200,'2025-01-01',NULL);`);
  return c;
}
function serviceFor(c: Conn, userId: string, tier = "professional") {
  const s = new VaultService(() => undefined) as unknown as Record<string, unknown>;
  s.engine = { conn: { query: async (sql: string) => c.query(sql) } }; s.identity = { userId, tenantId: "t" };
  s.licence = { tier, assert() {}, guard() {}, view: () => null, claims: { tier } };
  s.writable = async () => s.engine; s.save = async () => undefined; s.touch = () => undefined;
  return s as unknown as VaultService;
}
const call = <A extends Request["action"]>(s: VaultService, action: A, data: Extract<Request, { action: A }>["data"]) =>
  dispatch(s, { id: "1", action, data } as Request, { signal: () => new AbortController().signal, progress: () => undefined }) as Promise<never>;
const code = (c: string) => (e: unknown) => e instanceof VaultError && e.code === c;
type V = { id: string; number: string; status: string; lines: { productId: string; quantity: string; unitCents: string; guard: string }[]; validUntil: string | null; expired: boolean; revisionOf: { id: string; number: string } | null; allowedNext: string[]; decidedAt: string | null };
/** A tiny valid-looking baseline JPEG header (64 by 32, RGB): enough for the PDF writer, which embeds it as is. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

test("11.1: copy makes a new draft of the caller's own, priced again; revise makes -R1, -R2 drafts that never carry the approval", async () => {
  const c = await vault();
  try {
    const rep = serviceFor(c, "rep"), rep2 = serviceFor(c, "rep2"), po = serviceFor(c, "po");
    const q = await call(rep, "quoteCreate", { customerId: "C1" }) as V;
    await call(rep, "quoteLines", { id: q.id, lines: [{ productId: "P1", quantity: "3", unitCents: "7000" }] });
    const pending = await call(rep, "quoteSubmit", { id: q.id, reason: "Competitor" }) as V;
    assert.equal(pending.status, "pending");
    await assert.rejects(call(rep, "quoteRevise", { id: q.id }), code("QUOTE"), "a pending quote is withdrawn, not revised");
    const approved = await call(po, "quoteDecide", { id: q.id, decision: "approve", note: null }) as V;
    assert.equal(approved.status, "approved"); assert.ok(approved.allowedNext.includes("revise") && approved.allowedNext.includes("pdf"));
    // Revise: a fresh draft numbered after the original, pointing at it, below floor again until a new approval.
    const r1 = await call(rep, "quoteRevise", { id: q.id }) as V;
    assert.equal(r1.number, q.number + "-R1"); assert.equal(r1.status, "draft"); assert.equal(r1.decidedAt, null);
    assert.deepEqual(r1.revisionOf, { id: q.id, number: q.number });
    assert.deepEqual(r1.lines.map(l => [l.productId, l.quantity, l.unitCents, l.guard]), [["P1", "3.0000", "7000", "red"]], "same lines, checked again: still needs approval");
    const r2 = await call(po, "quoteRevise", { id: q.id }) as V;
    assert.equal(r2.number, q.number + "-R2", "an approver may revise too");
    await assert.rejects(call(rep2, "quoteRevise", { id: q.id }), code("FORBIDDEN"), "another rep cannot open, so cannot revise, someone else's quote");
    assert.equal((await call(rep, "quoteGet", { id: q.id }) as V).status, "approved", "the original stays as it was");
    // A new quote's number ignores revisions; copy goes to the caller with today's book price checked again.
    const next = await call(rep, "quoteCreate", { customerId: "C1" }) as V;
    assert.equal(Number(next.number.slice(-4)), Number(q.number.slice(-4)) + 1, "revisions are not counted in the next number");
    const copied = await call(po, "quoteCopy", { id: q.id }) as V;
    assert.equal(copied.status, "draft"); assert.equal(copied.revisionOf, null); assert.equal(copied.validUntil, null);
    assert.deepEqual(copied.lines.map(l => l.unitCents), ["7000"]); assert.ok(copied.allowedNext.includes("edit"), "the copy belongs to the caller");
  } finally { c.close(); }
});

test("11.2: a validity date is set by the author while editable, from today up to a year ahead, and shows when it has passed", async () => {
  const c = await vault();
  try {
    const rep = serviceFor(c, "rep"), rep2 = serviceFor(c, "rep2"), today = businessToday();
    const q = await call(rep, "quoteCreate", { customerId: "C1" }) as V;
    const v = await call(rep, "quoteValidity", { id: q.id, validUntil: addDays(today, 30) }) as V;
    assert.equal(v.validUntil, addDays(today, 30)); assert.equal(v.expired, false);
    for (const bad of [addDays(today, -1), addDays(today, 400), "2026-02-30x", "tomorrow"]) await assert.rejects(call(rep, "quoteValidity", { id: q.id, validUntil: bad }), code("QUOTE"), bad);
    await assert.rejects(call(rep2, "quoteValidity", { id: q.id, validUntil: today }), (e: unknown) => e instanceof VaultError);
    assert.equal((await call(rep, "quoteValidity", { id: q.id, validUntil: null }) as V).validUntil, null);
    c.query(`UPDATE quotes SET valid_until=DATE '${addDays(today, -3)}' WHERE id='${q.id}'`);
    const old = await call(rep, "quoteGet", { id: q.id }) as V;
    assert.equal(old.expired, true, "a date in the past reads as expired");
    await call(rep, "quoteLines", { id: q.id, lines: [{ productId: "P1", quantity: "1" }] }); await call(rep, "quoteSubmit", { id: q.id, reason: null });
    await assert.rejects(call(rep, "quoteValidity", { id: q.id, validUntil: today }), code("QUOTE"), "a sent quote's validity is changed by revising it");
  } finally { c.close(); }
});

test("11.3: the customer PDF prints branding and prices only, never cost, floor or zone; only an Owner sets the branding", async () => {
  const c = await vault();
  try {
    const rep = serviceFor(c, "rep"), owner = serviceFor(c, "owner1"), po = serviceFor(c, "po");
    await assert.rejects(call(rep, "brandingSet", { input: { company: "X" } }), code("FORBIDDEN"));
    await assert.rejects(call(owner, "brandingSet", { input: { company: "" } }), code("QUOTE"), "a company name is required");
    await assert.rejects(call(owner, "brandingSet", { input: { company: "Acme Supply", logo: b64(new TextEncoder().encode("not a jpeg")) } }), code("QUOTE"));
    await assert.rejects(call(owner, "brandingSet", { input: { company: "Acme Supply", logo: b64(new Uint8Array(200_001).fill(0xff)) } }), code("QUOTE"), "a logo over 200 kB");
    const saved = await call(owner, "brandingSet", { input: { company: "Acme Supply", address: "1 Main St\nSpringfield", terms: "Net 30. Prices exclude tax.", logo: b64(JPEG) } }) as { company: string; logo: string };
    assert.equal(saved.company, "Acme Supply"); assert.equal(saved.logo, b64(JPEG));
    assert.equal((await call(owner, "brandingSet", { input: { company: "Acme Supply Co", address: "1 Main St\nSpringfield", terms: "Net 30. Prices exclude tax." } }) as { logo: string }).logo, b64(JPEG), "leaving the logo out keeps it");
    const q = await call(rep, "quoteCreate", { customerId: "C1" }) as V;
    await call(rep, "quoteLines", { id: q.id, lines: [{ productId: "P1", quantity: "2" }] });
    await assert.rejects(call(rep, "quotePdf", { id: q.id, locale: "en" }), code("QUOTE"), "a draft is not sent to a customer");
    await call(rep, "quoteSubmit", { id: q.id, reason: null });
    for (const who of [rep, po]) {
      const pdf = await call(who, "quotePdf", { id: q.id, locale: "en" }) as { name: string; bytes: Uint8Array }, text = new TextDecoder().decode(pdf.bytes);
      assert.equal(pdf.name, q.number + ".pdf");
      for (const want of ["Acme Supply Co", "Springfield", "Net 30", `Quote ${q.number}`, "Acme \\(C1\\)", "P1 \\267 Ball valve", "$105.00", "$210.00", "/DCTDecode"]) assert.ok(text.includes(want), want);
      for (const never of [COST, "43.21", "Floor", "Target", "Margin", "margin", "Green", "11000", "$110.00", "$80.00"]) assert.ok(!text.includes(never), `the customer PDF shows ${never}`);
    }
    await assert.rejects(call(rep, "quotePdf", { id: q.id, locale: "xx" as never }), code("QUOTE"));
    const fr = new TextDecoder().decode((await call(rep, "quotePdf", { id: q.id, locale: "fr-CA" }) as { bytes: Uint8Array }).bytes);
    assert.ok(fr.includes("Soumission " + q.number), "Canadian French says soumission");
  } finally { c.close(); }
});

test("11.4: a customer price list at quantity 1 (prices only, formula-safe) and the mailing list of a planned increase", async () => {
  const c = await vault();
  try {
    const rep = serviceFor(c, "rep"), po = serviceFor(c, "po");
    c.query("UPDATE products SET description='=HYPERLINK(\"x\")' WHERE product_id='P3'");
    const list = await call(rep, "priceList", { customerId: "C3", format: "csv" }) as { name: string; blob: Blob; rows: number }, text = await list.blob.text();
    assert.equal(list.rows, 3); assert.match(list.name, /^rebatehq-price-list-C3-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.ok(text.includes('"P1","Ball valve","Valves","EA","0012345678905","102.00","customer"'), "the customer's own price wins");
    assert.ok(text.includes('"P2","Gate valve","Valves","EA","","90.00","list"') && text.includes(`"'=HYPERLINK`), "list price fallback; a formula is neutralised");
    assert.ok(!text.includes("43.21") && !text.includes(COST) && !/cost|margin/i.test(text), "no cost in a price list");
    const xlsx = await call(rep, "priceList", { customerId: "C1", format: "xlsx" }) as { name: string; blob: Blob };
    assert.ok(xlsx.name.endsWith(".xlsx") && xlsx.blob.size > 1000);
    await assert.rejects(call(rep, "priceList", { customerId: "NOPE", format: "csv" }), code("QUOTE"));
    await assert.rejects(call(rep, "priceList", { customerId: "C1", format: "pdf" as never }), code("QUOTE"));
    c.query(`INSERT INTO price_changesets VALUES('run1','planner',NULL,'tier','T01',450,'po','2026-01-01'),('run2','rollback',NULL,'version','v1',NULL,'po','2026-01-01')`);
    const mail = await call(po, "priceMailing", { runId: "run1" }) as { blob: Blob; rows: number }, mailText = await mail.blob.text();
    assert.equal(mail.rows, 2); assert.ok(mailText.includes('"C1","Acme","T01","North","East","tier:T01","4.50"') && mailText.includes('"C3","Corex"') && !mailText.includes('"C2"'));
    await assert.rejects(call(po, "priceMailing", { runId: "run2" }), code("QUOTE"), "a rollback has no letter");
    await assert.rejects(call(serviceFor(c, "po", "starter"), "priceMailing", { runId: "run1" }), (e: unknown) => e instanceof VaultError);
  } finally { c.close(); }
});

test("11.5: a scanned UPC/EAN finds its item in Price Check, on a quote line and in the type-ahead; an exact SKU wins", async () => {
  const c = await vault();
  try {
    const rep = serviceFor(c, "rep");
    const point = await call(rep, "priceCheck", { productId: "0012345678905", customerId: "C1", quantity: "1" }) as { productId: string; bookCents: string };
    assert.deepEqual([point.productId, point.bookCents], ["P1", "10500"]);
    const q = await call(rep, "quoteCreate", { customerId: "C1" }) as V;
    assert.equal((await call(rep, "quoteLines", { id: q.id, lines: [{ productId: "0012345678905", quantity: "1" }] }) as V).lines[0].productId, "P1");
    const hits = await call(rep, "search", { text: "0012345678905" }) as { kind: string; id: string }[];
    assert.deepEqual(hits.filter(h => h.kind === "product").map(h => h.id), ["P1"]);
    c.query("INSERT INTO products(product_id,description,category,uom,list_price,barcode) VALUES('P3X','Clash','Hoses','EA',100,'P3')");
    assert.equal((await call(rep, "priceCheck", { productId: "P3", customerId: null, quantity: "1" }) as { productId: string }).productId, "P3", "an exact SKU beats a barcode");
  } finally { c.close(); }
});

test("PDF writer: reads JPEG size and channels, refuses CMYK and non-JPEG, and keeps the file ASCII", () => {
  assert.deepEqual(Pdf.jpegInfo(JPEG), { width: 64, height: 32, colors: 3 });
  const cmyk = JPEG.slice(); cmyk[29] = 4; assert.equal(Pdf.jpegInfo(cmyk), null);
  assert.equal(Pdf.jpegInfo(new TextEncoder().encode("GIF89a")), null);
  const bytes = new Pdf().image(10, 10, 64, 32, JPEG).bytes("t");
  assert.ok(bytes.every(b => b < 128), "the PDF stays ASCII");
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes("/XObject << /Im0 8 0 R >>") && text.includes("/Width 64 /Height 32 /ColorSpace /DeviceRGB") && text.includes("ffd8ffe0"));
});
