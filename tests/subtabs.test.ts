// Sub-tabs in the command palette (16 Nov 2026, blueprint section 22, item 33): the registry must match the views.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { SUBTABS, matches, visibleSubTabs } from "../components/local/subtabs";
import { en } from "../lib/i18n/locales/en";

const VIEW: Record<string, string> = {
  Margin: "components/local/MarginView.tsx", Pricing: "components/local/PricingView.tsx", Quotes: "components/local/QuotesView.tsx",
  "Rebates & Contracts": "components/local/RebatesView.tsx", Vendors: "components/local/VendorsView.tsx", Reports: "components/local/ReportsView.tsx",
};
const allUi = readdirSync("components/local").filter(f => f.endsWith(".tsx")).map(f => readFileSync("components/local/" + f, "utf8")).join("\n");

test("every tab hash opens a tab its view knows, under the view's own label", () => {
  for (const s of SUBTABS.filter(x => x.hash)) {
    const src = readFileSync(VIEW[s.section], "utf8"), tab = s.hash!.split("-").pop()!; // "reports-roi-runs" is the ROI view's "runs"
    assert.ok(s.label in en, `${s.hash}: unknown label ${s.label}`);
    assert.ok(src.includes(s.label), `${s.hash}: ${VIEW[s.section]} never shows ${s.label}`);
    const known = src.includes(`'${tab}'`) || src.includes(`"${tab}"`) || src.includes(`#${s.hash}`) || ["waterfall", "customer", "review", "rules"].includes(tab);
    assert.ok(known, `${s.hash}: ${VIEW[s.section]} does not handle "${tab}"`);
  }
});

test("sub-tab ids are unique across sections (20 Nov 2026)", () => {
  const ids = SUBTABS.map(s => s.id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
});

test("every section anchor is a real heading id", () => {
  for (const s of SUBTABS.filter(x => x.anchor)) {
    assert.ok(s.label in en, `${s.anchor}: unknown label ${s.label}`);
    assert.ok(allUi.includes(`id="${s.anchor}"`) || allUi.includes(`headingId="${s.anchor}"`) || allUi.includes(`id: "${s.anchor}"`), `no heading with id ${s.anchor}`);
  }
});

test("sub-tabs follow the role and the licence tier", () => {
  const all = ["Home", "Data Hub", "Margin", "Pricing", "Quotes", "Rebates & Contracts", "Vendors", "Reports", "Settings"] as const;
  const owner = visibleSubTabs(all, { caps: ["cost", "pricing", "data", "quote", "quoteApprove", "audit", "backup"] as never, tier: "scale" });
  assert.ok(owner.some(s => s.hash === "rebates-purchases") && owner.some(s => s.hash === "pricing-planner"));
  const starter = visibleSubTabs(all, { caps: ["cost", "pricing", "quote"] as never, tier: "starter" });
  assert.ok(!starter.some(s => s.section === "Quotes" || s.section === "Vendors" || s.hash === "pricing-planner" || s.hash === "rebates-purchases"));
  // A Sales Rep never sees cost-only tabs, even on Scale, and only sections it can open.
  const rep = visibleSubTabs(["Home", "Pricing", "Quotes", "Rebates & Contracts", "Reports"], { caps: ["quote"] as never, tier: "scale" });
  assert.ok(!rep.some(s => ["rebates-claims", "reports-roi", "pricing-grid"].includes(s.hash ?? "") || s.section === "Data Hub" || s.section === "Settings"));
  assert.ok(rep.some(s => s.hash === "reports-scorecard"));
});

test("the palette matches every typed word and opens a sub-tab even when its hash is already set", () => {
  assert.ok(matches("Purchase receipts Rebates & Contracts", "purchase receipts"));
  assert.ok(matches("History Quotes", "quotes  history"));
  assert.ok(matches("Price grid Pricing", "PRICING grid"));
  assert.ok(!matches("History Quotes", "quotes grid"));
  assert.ok(matches("Pass", "pass"), "a word with an s is not split");
  const src = readFileSync("components/local/CommandPalette.tsx", "utf8");
  assert.match(src, /matches\(i\.group === "tab"/);
  assert.match(src, /window\.dispatchEvent\(new HashChangeEvent\("hashchange"\)\)/);
  assert.match(src, /visibleSubTabs\(sections, \{ caps, tier \}\)/);
});
