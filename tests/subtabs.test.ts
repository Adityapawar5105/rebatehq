// Sub-tabs in the command palette (16 Nov 2026, blueprint section 22, item 33) and the sidebar (23 Nov 2026, item 36):
// the registry must match the views.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { SUBTABS, matches, pageOfAnchor, pageOfHash, sectionOfHash, sectionPages, visibleSubTabs } from "../components/local/subtabs";
import { en } from "../lib/i18n/locales/en";

const VIEW: Record<string, string> = {
  Margin: "components/local/MarginView.tsx", Pricing: "components/local/PricingView.tsx", Quotes: "components/local/QuotesView.tsx",
  "Rebates & Contracts": "components/local/RebatesView.tsx", Vendors: "components/local/VendorsView.tsx", Reports: "components/local/ReportsView.tsx",
  // Data Hub and Settings pages are chosen in the shell itself.
  "Data Hub": "components/local/VaultApp.tsx", Settings: "components/local/VaultApp.tsx",
};
const allUi = readdirSync("components/local").filter(f => f.endsWith(".tsx")).map(f => readFileSync("components/local/" + f, "utf8")).join("\n");

test("every tab hash opens a tab its view knows", () => {
  for (const s of SUBTABS.filter(x => x.hash)) {
    const src = readFileSync(VIEW[s.section], "utf8"), tab = s.hash!.split("-").pop()!; // "reports-roi-runs" is the ROI view's "runs"
    assert.ok(s.label in en, `${s.hash}: unknown label ${s.label}`);
    // The label is the sidebar link's text (23 Nov 2026); the view no longer draws its own tab row.
    const known = src.includes(`'${tab}'`) || src.includes(`"${tab}"`) || src.includes(`#${s.hash}`) || src.includes(`"${s.hash}"`) || ["waterfall", "customer", "review", "rules"].includes(tab);
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

test("every hash in the app and the browser gate resolves to its section and sub-page (23 Nov 2026)", () => {
  const owner = { caps: ["cost", "pricing", "data", "quote", "quoteApprove", "audit", "backup", "roles"] as never, tier: "scale" as const };
  const cases: [string, string | null, string | null][] = [
    ["#home", "Home", null], ["#data-hub", "Data Hub", "data-hub-import"], ["#data-hub-fix", "Data Hub", "data-hub-fix"], ["#data-hub-cleanup", "Data Hub", "data-hub-cleanup"],
    ["#margin", "Margin", "margin-waterfall"], ["#margin-health", "Margin", "margin-health"], ["#margin-bridge", "Margin", "margin-bridge"], ["#margin-competitors", "Margin", "margin-competitors"], ["#margin-service", "Margin", "margin-service"],
    ["#pricing", "Pricing", "pricing-rules"], ["#pricing-rules", "Pricing", "pricing-rules"], ["#pricing-versions", "Pricing", "pricing-versions"], ["#pricing-planner", "Pricing", "pricing-planner"], ["#pricing-exceptions", "Pricing", "pricing-exceptions"], ["#pricing-expiry", "Pricing", "pricing-expiry"],
    ["#quotes", "Quotes", "quotes-check"], ["#quotes-new", "Quotes", "quotes-new"], ["#quotes-open-Q%2D1", "Quotes", "quotes-new"], ["#quotes-check-product-SKU-1", "Quotes", "quotes-check"], ["#quotes-history", "Quotes", "quotes-history"],
    ["#rebates", "Rebates & Contracts", "rebates-customer"], ["#rebates-purchases", "Rebates & Contracts", "rebates-purchases"], ["#rebates-claims", "Rebates & Contracts", "rebates-claims"],
    ["#vendors", "Vendors", "vendors-review"], ["#vendors-ppv", "Vendors", "vendors-ppv"], ["#vendors-sim", "Vendors", "vendors-sim"], ["#vendors-index", "Vendors", "vendors-index"], ["#vendors-dead", "Vendors", "vendors-dead"],
    ["#reports", "Reports", "reports-review"], ["#reports-review", "Reports", "reports-review"], ["#reports-roi", "Reports", "reports-roi"], ["#reports-roi-runs", "Reports", "reports-roi"], ["#reports-scorecard", "Reports", "reports-scorecard"],
    ["#settings", "Settings", "settings-general"], ["#settings-security", "Settings", "settings-security"], ["#settings-team", "Settings", "settings-team"],
    ["#nowhere", null, null], ["", null, null],
  ];
  for (const [hash, section, page] of cases) {
    assert.equal(sectionOfHash(hash), section, hash);
    if (section && page) assert.equal(pageOfHash(hash, sectionPages(section as never, owner)), page, hash);
  }
});

test("the sidebar lists only pages, follows role and tier, and a one-page section has no sub-list", () => {
  const owner = sectionPages("Reports", { caps: ["cost", "quote", "audit"] as never, tier: "scale" });
  assert.deepEqual(owner.map(p => p.hash), ["reports-review", "reports-roi", "reports-scorecard"], "ROI sub-views and the Reports cards stay out of the sidebar");
  const rep = (s: string) => sectionPages(s as never, { caps: ["view", "guards", "collaborate", "rebates", "quote"] as never, tier: "scale" }).map(p => p.hash);
  assert.deepEqual(rep("Quotes"), ["quotes-check", "quotes-new", "quotes-history", "quotes-winloss"]);
  assert.deepEqual(rep("Pricing"), ["pricing-rules"]);
  assert.deepEqual(rep("Rebates & Contracts"), ["rebates-customer"]);
  assert.deepEqual(rep("Reports"), ["reports-scorecard"]);
  assert.deepEqual(sectionPages("Vendors", { caps: ["cost"] as never, tier: "starter" }), [], "Starter has no vendor pages");
  assert.deepEqual(sectionPages("Data Hub", { caps: ["data", "cost"] as never, tier: "starter" }).map(p => p.hash), ["data-hub-import", "data-hub-fix", "data-hub-cleanup", "data-hub-records"]);
  assert.deepEqual(sectionPages("Settings", { caps: [] as never, tier: "starter" }).map(p => p.hash), ["settings-general", "settings-security", "settings-team"]);
});

test("every heading sits on a page that exists, so an old link to it switches page first", () => {
  const pages = new Set(SUBTABS.filter(s => s.hash).map(s => s.hash));
  for (const s of SUBTABS.filter(x => x.anchor)) {
    const page = pageOfAnchor(s.anchor!);
    assert.ok(page && (pages.has(page) || sectionOfHash(page) === s.section), `${s.anchor} has no page`);
    assert.equal(sectionOfHash(page!), s.section, `${s.anchor} is on another section's page`);
  }
  // The old tab rows' test ids now live on the sidebar links, which the browser gate clicks.
  for (const id of ["ops-tab-health", "ops-tab-margin-bridge", "ops-tab-grid", "ops-tab-expiry", "vendor-tab-ppv", "vendor-tab-sim", "supplier-tab-claims", "supplier-tab-purchases", "supplier-tab-progress"])
    assert.ok(SUBTABS.some(s => s.testId === id), `no sidebar link has test id ${id}`);
});
