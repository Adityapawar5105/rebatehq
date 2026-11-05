// Local roles and what each may do. The worker (lib/vault/service.ts) checks these
// before it runs a query, so a role that may not see cost never receives a cost value;
// the UI only mirrors the result. Money here is never computed; this module is policy.
import type { Action } from "../vault/protocol";
import { ROLE_IDS } from "../vault/schema";
import { msg } from "../i18n/core";
export type RoleId = typeof ROLE_IDS[number];
export const ROLES: Array<{ id: RoleId; label: string; summary: string }> = [
  // Labels are message references (English text plus key); the UI shows them with say().
  { id: "owner", label: msg("role.owner"), summary: msg("role.owner.summary") },
  { id: "pricing_owner", label: msg("role.pricing_owner"), summary: msg("role.pricing_owner.summary") },
  { id: "pricing_manager", label: msg("role.pricing_manager"), summary: msg("role.pricing_manager.summary") },
  { id: "sales_manager", label: msg("role.sales_manager"), summary: msg("role.sales_manager.summary") },
  { id: "sales_rep", label: msg("role.sales_rep"), summary: msg("role.sales_rep.summary") },
  { id: "accountant", label: msg("role.accountant"), summary: msg("role.accountant.summary") },
  { id: "admin", label: msg("role.admin"), summary: msg("role.admin.summary") },
];
export const ROLE_LABEL = Object.fromEntries(ROLES.map(r => [r.id, r.label])) as Record<RoleId, string>;
export const isRole = (value: unknown): value is RoleId => typeof value === "string" && (ROLE_IDS as readonly string[]).includes(value);
/**
 * view: counts and price totals (never cost). guards: price floors and targets.
 * cost: cost, margin, leaks and the ROI total. data: imports, Fix Later, item cleanup, cost basis choice.
 * pricing: guardrails, rules, simulations. approve: approve a price change. export: ERP files.
 * reconcile: reconciliation. audit: verify the audit chain. roles: team roles. backup: backups.
 * quote (7B): Quote Desk and Price Check. A quote shows price, start/target/floor and the zone; its cost and
 * margin need "cost" as well, so a Sales Rep quotes without ever receiving cost (decision 16).
 * quoteApprove (7B): decide a below-floor quote exception (Sales Manager, Pricing Owner, Owner / CFO). It is
 * separate from "approve", which approves price changes and belongs to the named Pricing Owner only.
 */
export type Cap = "view" | "guards" | "cost" | "data" | "pricing" | "approve" | "export" | "reconcile" | "audit" | "roles" | "backup" | "collaborate" | "quote" | "quoteApprove";
export const CAPS_ALL: Cap[] = ["view", "guards", "cost", "data", "pricing", "approve", "export", "reconcile", "audit", "roles", "backup", "collaborate", "quote", "quoteApprove"];
const PRICING_OWNER: Cap[] = CAPS_ALL;
const BASE: Cap[] = ["view", "guards", "collaborate"];
const BY_ROLE: Record<RoleId, Cap[]> = {
  owner: CAPS_ALL.filter(c => c !== "approve"), // approval belongs to the named Pricing Owner
  pricing_owner: PRICING_OWNER,
  pricing_manager: [...BASE, "cost", "data", "pricing", "export", "reconcile", "audit", "quote"],
  sales_manager: [...BASE, "cost", "quote", "quoteApprove"],
  sales_rep: [...BASE, "quote"],
  accountant: [...BASE, "cost", "reconcile", "audit"],
  admin: ["view", "guards", "roles", "backup", "audit"],
};
/**
 * Capabilities of one person: their role, plus everything a Pricing Owner may do when they are the named owner.
 * A Sales Rep never gets "cost" (blueprint decision 16). The 5A owner switch that allowed it was removed in 7B;
 * a vault that still stores it "on" is ignored. Someone trusted with margins gets the Sales Manager role instead.
 */
export function capsFor(role: RoleId, namedOwner: boolean): Cap[] {
  const set = new Set<Cap>(BY_ROLE[role]);
  if (namedOwner) for (const c of PRICING_OWNER) set.add(c);
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
  relayView:"collaborate",relayRegister:"collaborate",relayJoin:"collaborate",relayRotate:"collaborate",relaySync:"collaborate",relayShare:"collaborate",relayRequest:"collaborate",relayDecide:"collaborate",relayComment:"collaborate",relayRetry:"collaborate",relayDiscard:"collaborate",
  capacityUpgrade: "roles", licenceSet: null, init: null, create: null, unlock: null, lock: null, touch: null, cancel: null, save: null, storage: null,
  status: null, search: "view", home: "view", checklist: "view", checklistMark: "roles", roleList: "view",
  // Previewing a role can only remove capabilities (see accessFor), so anyone may use it, which also lets an Owner leave a preview.
  roleSet: "roles", roleRemove: "roles", rolePreview: "view",
  pricingState: "guards", pricingOwner: "roles", guardSet: "pricing", ruleSave: "pricing", ruleSimulate: "pricing", rulePreview: "pricing", ruleApprove: "approve", priceExport: "export",
  backupStatus: "backup", backupConfigure: "backup", backupNow: "backup", backupExport: "backup", backupRestore: null,
  verify: "audit",
  studioAdd: "data", studioUpdate: "data", studioDrop: "data", studioClear: "data", studioState: "data", studioPlan: "data", studioCommit: "data", studioDownload: "data", studioZip: "data",
  recipeSave: "data", recipeApply: "data", sources: "data", sourceRemove: "data",
  fixGroups: "data", fixRows: "data", fixSet: "data", fixDismiss: "data", fixRecheck: "data", health: "data",
  playgroundLoad: "data", playgroundRemove: "data", creditsLoad: "data",
  cleanupScan: "data", cleanupApply: "data", cleanupUndo: "data", cleanupMergeAll: "data", cleanupUndoMany: "data", cleanupHistory: "data", costBasis: "cost", costBasisSet: "data",
  marginWaterfall: "cost", marginDrill: "cost", marginWhale: "cost", marginMath: "cost", leaks: "cost", leakRows: "cost", leakReport: "cost", roi: "cost",
  reconcile: "reconcile", reconAccept: "reconcile", reconRebuild: "reconcile",
  // 7B. Cost and margin inside a quote view also need "cost" (checked in the service, not here).
  priceCheck: "quote", quoteCreate: "quote", quoteLines: "quote", quoteSubmit: "quote", quoteGet: "quote", quoteList: "quote", quoteShare: "quote", quoteRelaySync: "quote", quoteDecide: "quoteApprove",
};
/** Sections of the app a role can open (the worker still checks every command). */
export function sectionsFor(caps: Cap[]): string[] {
  const has = (c: Cap) => caps.includes(c);
  return ["Home", ...(has("data") ? ["Data Hub"] : []), ...(has("cost") ? ["Margin"] : []), ...(has("guards") ? ["Pricing"] : []), ...(has("quote") ? ["Quotes"] : []), ...(has("cost") || has("reconcile") || has("audit") ? ["Reports"] : []), ...(has("roles") || has("backup") || has("audit") ? ["Settings"] : [])];
}
