// Every sub-page and on-page section of the app, for the sidebar and the command palette (16 Nov 2026, blueprint
// section 22, item 33; the sidebar since 23 Nov 2026, item 36). A sub-page opens through its hash (each view reads it
// on hashchange); an anchor is a section heading on one of those pages, opened by switching to `page` and scrolling.
// The visibility rules mirror each view's own tab rules; tests/subtabs.test.ts checks every hash and label against the view.
import type { MessageKey } from "@/lib/i18n";
import type { Cap } from "@/lib/roles/access";
import type { Tier } from "@/lib/vault/protocol";
import type { Section } from "./VaultApp";

export type SubTabContext = { caps: readonly Cap[]; tier: Tier | undefined };
/** `nav: false` keeps an entry out of the sidebar (palette only); `testId` is the sidebar link's test id. */
export type SubTab = { id: string; section: Section; label: MessageKey; show?: (c: SubTabContext) => boolean; testId?: string; nav?: false }
  & ({ hash: string; anchor?: never; page?: never } | { anchor: string; page: string; hash?: never });

const has = (cap: Cap) => (c: SubTabContext) => c.caps.includes(cap);
const paid = (c: SubTabContext) => c.tier === "professional" || c.tier === "scale";
const notStarter = (c: SubTabContext) => c.tier !== "starter";
const all = (...rules: ((c: SubTabContext) => boolean)[]) => (c: SubTabContext) => rules.every(r => r(c));

/** The hash that opens each section; a sub-page hash starts with it ("data-hub-fix", "rebates-claims"). */
export const SECTION_HASH: Record<Section, string> = { Home: "home", "Data Hub": "data-hub", Margin: "margin", Pricing: "pricing", Quotes: "quotes", "Rebates & Contracts": "rebates", Vendors: "vendors", Reports: "reports", Settings: "settings" };

export const SUBTABS: readonly SubTab[] = [
  // Data Hub: four pages (23 Nov 2026, D1) holding the sections that were one long page
  { id: "data-import", section: "Data Hub", label: "nav.data.import", hash: "data-hub-import" },
  { id: "data-fix", section: "Data Hub", label: "nav.data.fix", hash: "data-hub-fix" },
  { id: "data-cleanup", section: "Data Hub", label: "nav.data.cleanup", hash: "data-hub-cleanup" },
  { id: "data-records", section: "Data Hub", label: "nav.data.records", hash: "data-hub-records", show: has("data") },
  { id: "studio", section: "Data Hub", label: "studio.importStudio", anchor: "studio-heading", page: "data-hub-import" },
  { id: "playground", section: "Data Hub", label: "studio.playground", anchor: "playground-heading", page: "data-hub-import" },
  { id: "sources", section: "Data Hub", label: "studio.importedFiles", anchor: "sources-heading", page: "data-hub-import" },
  { id: "fix", section: "Data Hub", label: "studio.fixLater", anchor: "fix-heading", page: "data-hub-fix" },
  { id: "recon", section: "Data Hub", label: "studio.reconciliation", anchor: "recon-heading", page: "data-hub-fix" },
  { id: "data-health", section: "Data Hub", label: "studio.dataHealth", anchor: "health-heading", page: "data-hub-fix" },
  { id: "cleanup", section: "Data Hub", label: "cleanup.itemMasterCleanup", anchor: "cleanup-heading", page: "data-hub-cleanup" },
  { id: "basis", section: "Data Hub", label: "basis.costBasis", anchor: "basis-heading", page: "data-hub-cleanup", show: has("cost") },
  { id: "customers", section: "Data Hub", label: "notes.customers", anchor: "customers-heading", page: "data-hub-records", show: has("data") },
  { id: "items", section: "Data Hub", label: "notes.items", anchor: "items-heading", page: "data-hub-records", show: has("data") },
  // Margin
  { id: "waterfall", section: "Margin", label: "margin.waterfall", hash: "margin-waterfall", testId: "ops-tab-waterfall" },
  { id: "margin-health", section: "Margin", label: "monitor.healthTab", hash: "margin-health", testId: "ops-tab-health" },
  { id: "bridge", section: "Margin", label: "ops.bridge", hash: "margin-bridge", show: paid, testId: "ops-tab-margin-bridge" },
  { id: "competitors", section: "Margin", label: "pc2.competitors", hash: "margin-competitors", show: paid, testId: "ops-tab-competitors" },
  { id: "service", section: "Margin", label: "pc2.service", hash: "margin-service", show: paid, testId: "ops-tab-service" },
  // Pricing
  { id: "rules", section: "Pricing", label: "ops.rules", hash: "pricing-rules", testId: "ops-tab-rules" },
  { id: "grid", section: "Pricing", label: "pc2.grid", hash: "pricing-grid", show: has("pricing"), testId: "ops-tab-grid" },
  { id: "landed", section: "Pricing", label: "pc2.landed", hash: "pricing-landed", show: all(has("pricing"), paid), testId: "ops-tab-landed" },
  { id: "planner", section: "Pricing", label: "ops.planner", hash: "pricing-planner", show: all(has("pricing"), paid), testId: "ops-tab-planner" },
  { id: "versions", section: "Pricing", label: "ops.versions", hash: "pricing-versions", show: all(has("pricing"), paid), testId: "ops-tab-versions" },
  { id: "exceptions", section: "Pricing", label: "ops.exceptions", hash: "pricing-exceptions", show: all(has("pricing"), paid), testId: "ops-tab-exceptions" },
  { id: "expiry", section: "Pricing", label: "ops.expiry", hash: "pricing-expiry", show: all(has("pricing"), paid), testId: "ops-tab-expiry" },
  // Quotes (Professional and Scale)
  { id: "check", section: "Quotes", label: "quotes.tab.check", hash: "quotes-check", show: notStarter, testId: "quotes-tab-check" },
  { id: "new", section: "Quotes", label: "quotes.tab.new", hash: "quotes-new", show: notStarter, testId: "quotes-tab-new" },
  { id: "inbox", section: "Quotes", label: "quotes.tab.inbox", hash: "quotes-inbox", show: all(notStarter, has("quoteApprove")), testId: "quotes-tab-inbox" },
  { id: "history", section: "Quotes", label: "quotes.tab.history", hash: "quotes-history", show: notStarter, testId: "quotes-tab-history" },
  { id: "winloss", section: "Quotes", label: "winloss.tab", hash: "quotes-winloss", show: notStarter, testId: "quotes-tab-winloss" },
  // Rebates & Contracts
  { id: "customer", section: "Rebates & Contracts", label: "rebate.heading", hash: "rebates-customer", testId: "supplier-tab-customer" },
  { id: "claims", section: "Rebates & Contracts", label: "supplier.claims", hash: "rebates-claims", show: all(has("cost"), notStarter), testId: "supplier-tab-claims" },
  { id: "purchases", section: "Rebates & Contracts", label: "supplier.purchases", hash: "rebates-purchases", show: all(has("cost"), notStarter), testId: "supplier-tab-purchases" },
  { id: "supplier", section: "Rebates & Contracts", label: "supplier.progress", hash: "rebates-supplier", show: all(has("cost"), notStarter), testId: "supplier-tab-progress" },
  // Vendors (Professional and Scale)
  { id: "vendor-review", section: "Vendors", label: "vendor.review", hash: "vendors-review", show: notStarter, testId: "vendor-tab-review" },
  { id: "ppv", section: "Vendors", label: "vendor.ppv", hash: "vendors-ppv", show: notStarter, testId: "vendor-tab-ppv" },
  { id: "sim", section: "Vendors", label: "sim.tab", hash: "vendors-sim", show: all(notStarter, has("pricing")), testId: "vendor-tab-sim" },
  { id: "index", section: "Vendors", label: "index.tab", hash: "vendors-index", show: notStarter, testId: "vendor-tab-index" },
  { id: "dead", section: "Vendors", label: "dead.tab", hash: "vendors-dead", show: notStarter, testId: "vendor-tab-dead" },
  // Reports
  { id: "review-pack", section: "Reports", label: "cadence.reviewTab", hash: "reports-review", show: has("cost"), testId: "reports-tab-review" },
  { id: "roi", section: "Reports", label: "cadence.roiTab", hash: "reports-roi", show: has("cost"), testId: "reports-tab-roi" },
  { id: "roi-findings", section: "Reports", label: "cadence.findings", hash: "reports-roi-findings", show: has("cost"), nav: false },
  { id: "roi-runs", section: "Reports", label: "cadence.runs", hash: "reports-roi-runs", show: has("cost"), nav: false },
  { id: "roi-recoveries", section: "Reports", label: "cadence.recoveries", hash: "reports-roi-recoveries", show: has("cost"), nav: false },
  { id: "scorecard", section: "Reports", label: "cadence.scoreTab", hash: "reports-scorecard", show: has("quote"), testId: "reports-tab-scorecard" },
  // The three Reports cards stay below the tabs (R1 was left as a "maybe" on 23 Nov 2026).
  { id: "leak", section: "Reports", label: "shell.report.heading", anchor: "report-card-heading", page: "reports", show: has("cost") },
  { id: "bench", section: "Reports", label: "bench.heading", anchor: "bench-heading", page: "reports", show: all(has("cost"), notStarter) },
  { id: "audit", section: "Reports", label: "shell.audit.heading", anchor: "audit-heading", page: "reports", show: has("audit") },
  // Settings: three pages (23 Nov 2026, D2); the account pages follow them in the sidebar (A1)
  { id: "settings-general", section: "Settings", label: "nav.settings.general", hash: "settings-general" },
  { id: "settings-security", section: "Settings", label: "nav.settings.security", hash: "settings-security" },
  { id: "settings-team", section: "Settings", label: "roles.teamAndRoles", hash: "settings-team" },
  { id: "prefs", section: "Settings", label: "shell.prefs.heading", anchor: "prefs-heading", page: "settings-general" },
  { id: "currency", section: "Settings", label: "fx.workspace", anchor: "currency-heading", page: "settings-general" },
  { id: "backup", section: "Settings", label: "backup.encryptedBackupAndRestore", anchor: "backup-heading", page: "settings-security", show: has("backup") },
  { id: "storage", section: "Settings", label: "shell.storage.heading", anchor: "storage-heading", page: "settings-security" },
  { id: "offline", section: "Settings", label: "offline.heading", anchor: "offline-heading", page: "settings-security" },
  { id: "roles", section: "Settings", label: "roles.teamAndRoles", anchor: "roles-heading", page: "settings-team" },
  // Team sharing S1: the encrypted hand-off file (Professional and Scale; the worker checks the tier and role)
  { id: "share", section: "Settings", label: "share.heading", anchor: "share-heading", page: "settings-team", show: notStarter },
  { id: "share-grid", section: "Settings", label: "share.grid.heading", anchor: "share-grid-heading", page: "settings-team", show: c => notStarter(c) && c.caps.includes("roles") },
];

/** Palette search: every word typed must appear in the item's text, so "purchase receipts" and "pricing grid" both match. */
export const matches = (text: string, query: string) => { const hay = text.toLocaleLowerCase(); return query.toLocaleLowerCase().split(/\s+/).filter(Boolean).every(word => hay.includes(word)); };

/** The sub-tabs and sections this role can open, in registry order. */
export function visibleSubTabs(sections: readonly Section[], ctx: SubTabContext) {
  return SUBTABS.filter(s => sections.includes(s.section) && (!s.show || s.show(ctx)));
}

export type NavPage = SubTab & { hash: string };
/** The sidebar's sub-pages for one section, in order. A section with a single page shows no sub-list. */
export function sectionPages(section: Section, ctx: SubTabContext): NavPage[] {
  return SUBTABS.filter((s): s is NavPage => s.section === section && !!s.hash && s.nav !== false && (!s.show || s.show(ctx)));
}

const SECTIONS = Object.keys(SECTION_HASH) as Section[];
/** The section a hash belongs to ("quotes-open-12" is Quotes, "data-hub" is Data Hub), or null for an unknown hash. */
export function sectionOfHash(raw: string): Section | null {
  const value = raw.replace(/^#/, "");
  return SECTIONS.find(s => value === SECTION_HASH[s] || value.startsWith(SECTION_HASH[s] + "-")) ?? null;
}

// Hashes that open a page under another name: an opened quote shows on the Quote page, a filled check on Price Check.
const ALIAS: [string, string][] = [["quotes-open-", "quotes-new"], ["quotes-check-", "quotes-check"]];
/** Which of a section's pages a hash shows; the first page when the hash names only the section. */
export function pageOfHash(raw: string, pages: readonly { hash: string }[]): string | null {
  if (!pages.length) return null;
  const value = raw.replace(/^#/, "");
  const exact = pages.find(p => p.hash === value);
  if (exact) return exact.hash;
  for (const [prefix, target] of ALIAS) if (value.startsWith(prefix) && pages.some(p => p.hash === target)) return target;
  const prefixed = pages.filter(p => value.startsWith(p.hash + "-")).sort((a, b) => b.hash.length - a.hash.length)[0];
  return prefixed ? prefixed.hash : pages[0].hash;
}

/** The page that holds a section heading, so a link to the heading can switch page first. */
export function pageOfAnchor(anchor: string): string | null {
  return SUBTABS.find(s => s.anchor === anchor)?.page ?? null;
}

/** Fired when a view changes its own sub-page without a hash change (an opened quote), so the sidebar follows. */
export const SUBPAGE_EVENT = "rebatehq-subpage";
/** Puts a sub-page's hash in the address bar without reloading the view, and tells the sidebar. */
export function markSubPage(hash: string) {
  if (typeof location === "undefined" || location.hash === "#" + hash) return;
  history.replaceState(null, "", "#" + hash);
  window.dispatchEvent(new Event(SUBPAGE_EVENT));
}
