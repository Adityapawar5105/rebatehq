// Local roles and what each may do. The worker (lib/vault/service.ts) checks these
// before it runs a query, so a role that may not see cost never receives a cost value;
// the UI only mirrors the result. Money here is never computed; this module is policy.
import type { Action } from "../vault/protocol";
import { ROLE_IDS } from "../vault/schema";
export type RoleId = typeof ROLE_IDS[number];
export const ROLES: Array<{ id: RoleId; label: string; summary: string }> = [
  { id: "owner", label: "Owner / CFO", summary: "Watches margin health and the ROI tracker; manages roles and backups." },
  { id: "pricing_owner", label: "Pricing Owner", summary: "Accountable for pricing: everything, including approving price changes." },
  { id: "pricing_manager", label: "Pricing Manager", summary: "Imports data, cleans the item master, builds rules, simulates and exports." },
  { id: "sales_manager", label: "Sales Manager", summary: "Reviews margins and customer profitability (read-only)." },
  { id: "sales_rep", label: "Sales Rep", summary: "Checks price floors. Never sees cost unless the owner allows it." },
  { id: "accountant", label: "Accountant", summary: "Reconciliation, cost and the audit log (read-only on pricing)." },
  { id: "admin", label: "Admin / IT", summary: "Team roles, backups and the audit log. No cost or pricing data." },
];
export const ROLE_LABEL = Object.fromEntries(ROLES.map(r => [r.id, r.label])) as Record<RoleId, string>;
export const isRole = (value: unknown): value is RoleId => typeof value === "string" && (ROLE_IDS as readonly string[]).includes(value);
/**
 * view: counts and price totals (never cost). guards: price floors and targets.
 * cost: cost, margin, leaks and the ROI total. data: imports, Fix Later, item cleanup, cost basis choice.
 * pricing: guardrails, rules, simulations. approve: approve a price change. export: ERP files.
 * reconcile: reconciliation. audit: verify the audit chain. roles: team roles. backup: backups.
 */
export type Cap = "view" | "guards" | "cost" | "data" | "pricing" | "approve" | "export" | "reconcile" | "audit" | "roles" | "backup";
export const CAPS_ALL: Cap[] = ["view", "guards", "cost", "data", "pricing", "approve", "export", "reconcile", "audit", "roles", "backup"];
const PRICING_OWNER: Cap[] = CAPS_ALL;
const BASE: Cap[] = ["view", "guards"];
const BY_ROLE: Record<RoleId, Cap[]> = {
  owner: CAPS_ALL.filter(c => c !== "approve"), // approval belongs to the named Pricing Owner
  pricing_owner: PRICING_OWNER,
  pricing_manager: [...BASE, "cost", "data", "pricing", "export", "reconcile", "audit"],
  sales_manager: [...BASE, "cost"],
  sales_rep: BASE,
  accountant: [...BASE, "cost", "reconcile", "audit"],
  admin: [...BASE, "roles", "backup", "audit"],
};
/** Capabilities of one person: their role, plus everything a Pricing Owner may do when they are the named owner. */
export function capsFor(role: RoleId, namedOwner: boolean, repSeesCost: boolean): Cap[] {
  const set = new Set<Cap>(BY_ROLE[role]);
  if (namedOwner) for (const c of PRICING_OWNER) set.add(c);
  if (role === "sales_rep" && repSeesCost) set.add("cost");
  return CAPS_ALL.filter(c => set.has(c));
}
/** The owner previews another role without elevating: only capabilities both hold remain. */
export const intersect = (a: Cap[], b: Cap[]) => a.filter(c => b.includes(c));
/**
 * What each worker command needs. `null` commands touch no business data (vault open/close,
 * progress, storage). Every command must be listed: TypeScript and tests/roles.test.ts
 * fail when a new command is added without a decision.
 */
export const ACTION_CAP: Record<Action, Cap | null> = {
  init: null, create: null, unlock: null, lock: null, touch: null, cancel: null, save: null, storage: null,
  status: null, home: "view", checklist: "view", checklistMark: "roles", roleList: "view",
  // Previewing a role can only remove capabilities (see accessFor), so anyone may use it, which also lets an Owner leave a preview.
  roleSet: "roles", roleRemove: "roles", accessSet: "roles", rolePreview: "view",
  pricingState: "guards", pricingOwner: "roles", guardSet: "pricing", ruleSave: "pricing", ruleSimulate: "pricing", rulePreview: "pricing", ruleApprove: "approve", priceExport: "export",
  backupStatus: "backup", backupConfigure: "backup", backupNow: "backup", backupExport: "backup", backupRestore: null,
  verify: "audit",
  studioAdd: "data", studioUpdate: "data", studioDrop: "data", studioClear: "data", studioState: "data", studioPlan: "data", studioCommit: "data", studioDownload: "data", studioZip: "data",
  recipeSave: "data", recipeApply: "data", sources: "data", sourceRemove: "data",
  fixGroups: "data", fixRows: "data", fixSet: "data", fixDismiss: "data", fixRecheck: "data", health: "data",
  playgroundLoad: "data", playgroundRemove: "data", creditsLoad: "data",
  cleanupScan: "data", cleanupApply: "data", cleanupUndo: "data", cleanupHistory: "data", costBasis: "cost", costBasisSet: "data",
  marginWaterfall: "cost", marginDrill: "cost", marginWhale: "cost", marginMath: "cost", leaks: "cost", leakRows: "cost", leakReport: "cost", roi: "cost",
  reconcile: "reconcile", reconAccept: "reconcile", reconRebuild: "reconcile",
};
/** Sections of the app a role can open (the worker still checks every command). */
export function sectionsFor(caps: Cap[]): string[] {
  const has = (c: Cap) => caps.includes(c);
  return ["Home", ...(has("data") ? ["Data Hub"] : []), ...(has("cost") ? ["Margin"] : []), ...(has("guards") ? ["Pricing"] : []), ...(has("cost") || has("reconcile") || has("audit") ? ["Reports"] : []), ...(has("roles") || has("backup") || has("audit") ? ["Settings"] : [])];
}
