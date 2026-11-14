// Leak Report layout (14 Nov 2026): owner summary, priorities, recommended actions, selected scope and page numbers.
import test from "node:test";
import assert from "node:assert/strict";
import { leakReport, type ReportInput } from "../lib/margin/report";
import type { Finding } from "../lib/margin/leaks";

const finding = (id: string, type: Finding["type"], cents: string, lines: string, title: string): Finding => ({ id, type, label: type, title, scope: {}, lines, cents, formula: "f", detail: "d" });
const base = (findings: Finding[], scope?: ReportInput["scope"]): ReportInput => ({
  currency: "USD", locale: "en", generatedAt: "2026-11-14T12:00:00.000Z", sample: false, lines: "1000", from: "2026-01-01", to: "2026-10-31", sources: ["sales.csv"],
  waterfall: { filters: { by: [] }, lines: "1000", sales: { list: "1000000" } as never, credits: { lines: "0", pocket: "0" } as never, netPocket: "800000", costedLines: "1000", costedPocket: "800000", cost: "600000", margin: "200000", rate: "25.00",
    uncostedLines: "0", uncostedPocket: "0", steps: [{ key: "list", label: "List", kind: "start", cents: "1000000" }, { key: "margin", label: "Pocket margin", kind: "end", cents: "200000" }] as never, ms: 1 },
  leaks: { findings, totalCents: String(findings.reduce((a, f) => a + BigInt(f.cents), BigInt(0))), overlapCents: "0", overlapLines: "0", dedupedCents: String(findings.reduce((a, f) => a + BigInt(f.cents), BigInt(0))),
    checked: { saleLines: "1000", creditLines: "0", uncostedLines: "0", untieredLines: "0", tiers: "1" }, ms: 1 },
  roi: { identifiedCents: "0", findings: "0" } as never, evidence: {}, scope,
});
const text = (b: Uint8Array) => new TextDecoder().decode(b);

test("the report ranks findings with a priority and a recommended action", () => {
  const out = text(leakReport(base([finding("below_cost|all", "below_cost", "6000", "10", "Lines priced below cost"), finding("unrecovered_freight|small_lines", "unrecovered_freight", "1500", "40", "Freight not billed back"), finding("negative_margin|cost_rise", "negative_margin", "500", "3", "Vendor cost rises")], { chosen: 3, of: 3, affectedLines: "53" })));
  assert.ok(out.startsWith("%PDF-1.4") && out.trimEnd().endsWith("%%EOF"));
  for (const s of ["Executive summary", "What needs attention first", "Where the margin is leaking", "All findings in this report", "Scope: all 3 findings", "High", "Medium", "Low",
    "Raise these prices above cost", "Bill freight back on small orders", "Pass recent supplier cost increases", "$60.00", "75.0%", "Page 1 of"]) assert.ok(out.includes(s), s);
});
test("a selection is named in the scope line and drives every total", () => {
  const out = text(leakReport(base([finding("below_cost|all", "below_cost", "6000", "10", "Lines priced below cost")], { chosen: 1, of: 4, affectedLines: "10" })));
  assert.ok(out.includes("Scope: 1 of 4 findings, as selected in RebateHQ"));
  assert.ok(out.includes("100.0%") && !out.includes("Start with the top"));
});
test("an empty scope says no leaks were found", () => {
  assert.ok(text(leakReport(base([], { chosen: 0, of: 0, affectedLines: "0" }))).includes("No margin leaks were found"));
});
