// Every sub-tab and on-page section the command palette can open (16 Nov 2026, blueprint section 22, item 33).
// A tab opens through its hash (each view reads it on hashchange); an anchor opens its section and scrolls to a heading id.
// The visibility rules mirror each view's own tab rules; tests/subtabs.test.ts checks every hash and label against the view.
import type { MessageKey } from "@/lib/i18n";
import type { Cap } from "@/lib/roles/access";
import type { Tier } from "@/lib/vault/protocol";
import type { Section } from "./VaultApp";

export type SubTabContext = { caps: readonly Cap[]; tier: Tier | undefined };
export type SubTab = { id: string; section: Section; label: MessageKey; show?: (c: SubTabContext) => boolean } & ({ hash: string; anchor?: never } | { anchor: string; hash?: never });

const has = (cap: Cap) => (c: SubTabContext) => c.caps.includes(cap);
const paid = (c: SubTabContext) => c.tier === "professional" || c.tier === "scale";
const notStarter = (c: SubTabContext) => c.tier !== "starter";
const all = (...rules: ((c: SubTabContext) => boolean)[]) => (c: SubTabContext) => rules.every(r => r(c));

export const SUBTABS: readonly SubTab[] = [
  // Data Hub (jump sections)
  { id: "studio", section: "Data Hub", label: "studio.importStudio", anchor: "studio-heading" },
  { id: "fix", section: "Data Hub", label: "studio.fixLater", anchor: "fix-heading" },
  { id: "recon", section: "Data Hub", label: "studio.reconciliation", anchor: "recon-heading" },
  { id: "health", section: "Data Hub", label: "studio.dataHealth", anchor: "health-heading" },
  { id: "playground", section: "Data Hub", label: "studio.playground", anchor: "playground-heading" },
  { id: "sources", section: "Data Hub", label: "studio.importedFiles", anchor: "sources-heading" },
  { id: "cleanup", section: "Data Hub", label: "cleanup.itemMasterCleanup", anchor: "cleanup-heading" },
  { id: "basis", section: "Data Hub", label: "basis.costBasis", anchor: "basis-heading", show: has("cost") },
  { id: "customers", section: "Data Hub", label: "notes.customers", anchor: "customers-heading", show: has("data") },
  { id: "items", section: "Data Hub", label: "notes.items", anchor: "items-heading", show: has("data") },
  // Margin
  { id: "waterfall", section: "Margin", label: "margin.waterfall", hash: "margin-waterfall" },
  { id: "health", section: "Margin", label: "monitor.healthTab", hash: "margin-health" },
  { id: "bridge", section: "Margin", label: "ops.bridge", hash: "margin-bridge", show: paid },
  { id: "competitors", section: "Margin", label: "pc2.competitors", hash: "margin-competitors", show: paid },
  { id: "service", section: "Margin", label: "pc2.service", hash: "margin-service", show: paid },
  // Pricing
  { id: "rules", section: "Pricing", label: "ops.rules", hash: "pricing-rules" },
  { id: "grid", section: "Pricing", label: "pc2.grid", hash: "pricing-grid", show: has("pricing") },
  { id: "landed", section: "Pricing", label: "pc2.landed", hash: "pricing-landed", show: all(has("pricing"), paid) },
  { id: "planner", section: "Pricing", label: "ops.planner", hash: "pricing-planner", show: all(has("pricing"), paid) },
  { id: "versions", section: "Pricing", label: "ops.versions", hash: "pricing-versions", show: all(has("pricing"), paid) },
  { id: "exceptions", section: "Pricing", label: "ops.exceptions", hash: "pricing-exceptions", show: all(has("pricing"), paid) },
  { id: "expiry", section: "Pricing", label: "ops.expiry", hash: "pricing-expiry", show: all(has("pricing"), paid) },
  // Quotes (Professional and Scale)
  { id: "check", section: "Quotes", label: "quotes.tab.check", hash: "quotes-check", show: notStarter },
  { id: "new", section: "Quotes", label: "quotes.tab.new", hash: "quotes-new", show: notStarter },
  { id: "inbox", section: "Quotes", label: "quotes.tab.inbox", hash: "quotes-inbox", show: all(notStarter, has("quoteApprove")) },
  { id: "history", section: "Quotes", label: "quotes.tab.history", hash: "quotes-history", show: notStarter },
  { id: "winloss", section: "Quotes", label: "winloss.tab", hash: "quotes-winloss", show: notStarter },
  // Rebates & Contracts
  { id: "customer", section: "Rebates & Contracts", label: "rebate.heading", hash: "rebates-customer" },
  { id: "claims", section: "Rebates & Contracts", label: "supplier.claims", hash: "rebates-claims", show: all(has("cost"), notStarter) },
  { id: "purchases", section: "Rebates & Contracts", label: "supplier.purchases", hash: "rebates-purchases", show: all(has("cost"), notStarter) },
  { id: "supplier", section: "Rebates & Contracts", label: "supplier.progress", hash: "rebates-supplier", show: all(has("cost"), notStarter) },
  // Vendors (Professional and Scale)
  { id: "review", section: "Vendors", label: "vendor.review", hash: "vendors-review", show: notStarter },
  { id: "ppv", section: "Vendors", label: "vendor.ppv", hash: "vendors-ppv", show: notStarter },
  { id: "sim", section: "Vendors", label: "sim.tab", hash: "vendors-sim", show: all(notStarter, has("pricing")) },
  { id: "index", section: "Vendors", label: "index.tab", hash: "vendors-index", show: notStarter },
  { id: "dead", section: "Vendors", label: "dead.tab", hash: "vendors-dead", show: notStarter },
  // Reports
  { id: "review", section: "Reports", label: "cadence.reviewTab", hash: "reports-review", show: has("cost") },
  { id: "roi", section: "Reports", label: "cadence.roiTab", hash: "reports-roi", show: has("cost") },
  { id: "roi-findings", section: "Reports", label: "cadence.findings", hash: "reports-roi-findings", show: has("cost") },
  { id: "roi-runs", section: "Reports", label: "cadence.runs", hash: "reports-roi-runs", show: has("cost") },
  { id: "roi-recoveries", section: "Reports", label: "cadence.recoveries", hash: "reports-roi-recoveries", show: has("cost") },
  { id: "scorecard", section: "Reports", label: "cadence.scoreTab", hash: "reports-scorecard", show: has("quote") },
  { id: "leak", section: "Reports", label: "shell.report.heading", anchor: "report-card-heading", show: has("cost") },
  { id: "bench", section: "Reports", label: "bench.heading", anchor: "bench-heading", show: all(has("cost"), notStarter) },
  { id: "audit", section: "Reports", label: "shell.audit.heading", anchor: "audit-heading", show: has("audit") },
  // Settings (jump sections)
  { id: "prefs", section: "Settings", label: "shell.prefs.heading", anchor: "prefs-heading" },
  { id: "currency", section: "Settings", label: "fx.workspace", anchor: "currency-heading" },
  { id: "backup", section: "Settings", label: "backup.encryptedBackupAndRestore", anchor: "backup-heading", show: has("backup") },
  { id: "roles", section: "Settings", label: "roles.teamAndRoles", anchor: "roles-heading" },
  { id: "storage", section: "Settings", label: "shell.storage.heading", anchor: "storage-heading" },
  { id: "offline", section: "Settings", label: "offline.heading", anchor: "offline-heading" },
];

/** Palette search: every word typed must appear in the item's text, so "purchase receipts" and "pricing grid" both match. */
export const matches = (text: string, query: string) => { const hay = text.toLocaleLowerCase(); return query.toLocaleLowerCase().split(/\s+/).filter(Boolean).every(word => hay.includes(word)); };

/** The sub-tabs and sections this role can open, in registry order. */
export function visibleSubTabs(sections: readonly Section[], ctx: SubTabContext) {
  return SUBTABS.filter(s => sections.includes(s.section) && (!s.show || s.show(ctx)));
}
