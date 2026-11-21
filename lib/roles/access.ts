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
export type Cap = "view" | "guards" | "cost" | "data" | "pricing" | "approve" | "export" | "reconcile" | "audit" | "roles" | "backup" | "collaborate" | "quote" | "quoteApprove" | "rebates" | "rebateManage";
export const CAPS_ALL: Cap[] = ["view", "guards", "cost", "data", "pricing", "approve", "export", "reconcile", "audit", "roles", "backup", "collaborate", "quote", "quoteApprove", "rebates", "rebateManage"];
const PRICING_OWNER: Cap[] = CAPS_ALL;
const BASE: Cap[] = ["view", "guards", "collaborate","rebates"];
const BY_ROLE: Record<RoleId, Cap[]> = {
  owner: CAPS_ALL.filter(c => c !== "approve"), // approval belongs to the named Pricing Owner
  pricing_owner: PRICING_OWNER,
  pricing_manager: [...BASE, "cost", "data", "pricing", "export", "reconcile", "audit", "quote","rebateManage"],
  sales_manager: [...BASE, "cost", "quote", "quoteApprove"],
  sales_rep: [...BASE, "quote"],
  accountant: [...BASE, "cost", "reconcile", "audit","rebateManage"],
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
/** Roadmap 9.3 (audit B-6): whether a command only reads, writes, or may run with no licence at all. A command that writes
 *  needs a writable licence; a read keeps working while the licence is read-only. Kept beside the capability so the two
 *  cannot drift apart (they were two hand-kept lists before). */
export type Mode = "read" | "write" | "always";
const r = (cap: Cap | null) => ({ cap, mode: "read" as Mode }), w = (cap: Cap | null) => ({ cap, mode: "write" as Mode }), always = (cap: Cap | null) => ({ cap, mode: "always" as Mode });
export const ACTIONS: Record<Action, { cap: Cap | null; mode: Mode }> = {
  reportState:r("cost"),reportCheck:w("cost"),reportExport:w("cost"),roiV2:r("cost"),roiRows:r("cost"),roiRecord:w("reconcile"),roiVoid:w("reconcile"),scorecard:r("quote"),scorecardOptIn:w("quote"),
  vendorSheets:r("cost"),vendorReview:r("cost"),vendorReviewQuotes:r("cost"),vendorPpv:r("cost"),vendorPpvLines:r("cost"),
  // 7E-2: the historical simulator is a pricing simulation (every role with "pricing" also has "cost"); Scale only.
  simOptions:r("pricing"),simRun:r("pricing"),simRows:r("pricing"),
  // 8A: deal guidance and cross-sell are Quote Desk reads; rep-safe and scanned for decision 16 (tests/quotes.test.ts).
  quoteGuidance:r("quote"),quoteCrossSell:r("quote"),
  // v2.6 gap 2: local yes/no for the relay set-up card (reviewed for decision 16 in tests/quotes.test.ts).
  relayLocal:r("collaborate"),
  // 8B-1: Margin Drain inbox and cost index triggers read cost; saving settings and triggers is a pricing decision.
  agentState:r("cost"),agentRows:r("cost"),agentRun:w("cost"),agentMark:w("cost"),agentSettingsSave:w("pricing"),indexState:r("cost"),indexSkus:r("cost"),indexTriggerSave:w("pricing"),indexTriggerDelete:w("pricing"),deadState:r("cost"),benchState:r("cost"),benchPreview:r("cost"),benchMapSave:w("cost"),benchShared:w("cost"),benchFiguresSave:w("cost"),benchWithdrawn:w("cost"),deadRows:r("cost"),deadSettingsSave:w("pricing"),deadDraft:w("pricing"),
  // 7F-2: folder re-import is an import (Import Studio, every tier).
  folderGet:r("data"),folderSet:r("data"),studioFolder:w("data"),folderPickup:r("data"),folderPickupSet:r("data"),
  supplierClaims:r("cost"),supplierPurchases:r("cost"),supplierProgress:r("cost"),supplierClaimPreview:r("cost"),supplierClaimSave:w("rebateManage"),supplierClaimStatus:w("rebateManage"),supplierClaimExport:w("rebateManage"),supplierClaimBalance:r("cost"),supplierPaymentRecord:w("rebateManage"),supplierPaymentVoid:w("rebateManage"),rebateFinanceExport:w("cost"),
  customerList:r("data"),productList:r("data"),noteSet:w("data"),sourceRemovePreview:r("data"),
  gridTotals:r("view"),
  rebateProgress:r("rebates"),rebateState:r("cost"),rebateRows:r("cost"),rebateSave:w("rebateManage"),rebateDelete:w("rebateManage"),rebateRecalculate:w("rebateManage"),
  currencySet:w("roles"),
  competitorList:r("cost"),
  homeMonitor:r("cost"),
  competitorAdd:w("pricing"),
  priceGrid:r("pricing"),
  priceGridPaste:r("pricing"),
  priceGridDraft:w("pricing"),
  ruleWhatIf:r("pricing"),
  priceLandedState:r("pricing"),
  priceLandedCheck:w("pricing"),
  serviceOrders:r("cost"),
  serviceFlag:w("pricing"),
  marginBridge:r("cost"),priceOpsState:r("pricing"),priceExceptions:r("cost"),priceExpiry:r("cost"),pricePlan:w("pricing"),priceRollback:w("pricing"),priceLetter:w("pricing"),quoteOutcome:w("quote"),winLoss:r("quote"),auditPack:w("audit"),templateVendors:r("cost"),negotiationSheet:w("cost"),rebateAgreement:w("rebateManage"),
  relayView:w("collaborate"),relayRegister:w("collaborate"),relayJoin:w("collaborate"),relayRotate:w("collaborate"),relaySync:w("collaborate"),relayShare:w("collaborate"),relayRequest:w("collaborate"),relayDecide:w("collaborate"),relayComment:w("collaborate"),relayRetry:w("collaborate"),relayDiscard:w("collaborate"),
  capacityUpgrade:w("roles"), licenceSet:r(null), init:r(null), create:w(null), unlock:r(null), vaultReset:always(null), passphraseChange:w(null), lock:r(null), touch:r(null), cancel:r(null), save:r(null), storage:r(null),
  status:r(null), search:r("view"), home:r("view"), checklist:r("view"), checklistMark:w("roles"), roleList:r("view"),
  // Previewing a role can only remove capabilities (see accessFor), so anyone may use it, which also lets an Owner leave a preview.
  roleSet:w("roles"), roleRemove:w("roles"), rolePreview:r("view"),
  pricingState:r("guards"), pricingOwner:w("roles"), guardSet:w("pricing"), ruleSave:w("pricing"), ruleSimulate:w("pricing"), rulePreview:r("pricing"), ruleApprove:w("approve"), priceExport:w("export"), exportLayouts:r("export"), exportLayoutSave:w("export"), exportLayoutDelete:w("export"),
  backupStatus:r("backup"), backupConfigure:r("backup"), backupNow:r("backup"), backupExport:r("backup"), backupRestore:w(null),
  verify:r("audit"),
  studioAdd:w("data"), studioUpdate:w("data"), studioDrop:w("data"), studioClear:w("data"), studioState:r("data"), studioPlan:w("data"), studioCommit:w("data"), studioDownload:r("data"), studioZip:r("data"),
  recipeSave:w("data"), recipeApply:w("data"), sources:r("data"), sourceRemove:w("data"),
  fixGroups:r("data"), fixRows:r("data"), fixSet:w("data"), fixDismiss:w("data"), fixRecheck:w("data"), health:r("data"),
  playgroundLoad:w("data"), playgroundRemove:w("data"), creditsLoad:w("data"),
  cleanupScan:r("data"), cleanupApply:w("data"), cleanupUndo:w("data"), cleanupMergeAll:w("data"), cleanupUndoMany:w("data"), cleanupHistory:r("data"), costBasis:r("cost"), costBasisSet:w("data"),
  marginWaterfall:r("cost"), marginDrill:r("cost"), marginWhale:r("cost"), marginMath:r("cost"), leaks:r("cost"), leakRows:r("cost"), leakReport:w("cost"), roi:r("cost"),
  reconcile:r("reconcile"), reconAccept:w("reconcile"), reconRebuild:w("reconcile"),
  // 7B. Cost and margin inside a quote view also need "cost" (checked in the service, not here).
  priceCheck:r("quote"), quoteCreate:w("quote"), quoteLines:w("quote"), quoteSubmit:w("quote"), quoteWithdraw:w("quote"), quoteCopy:w("quote"), quoteRevise:w("quote"), quoteValidity:w("quote"), quotePdf:r("quote"), brandingGet:r("quote"), brandingSet:w("roles"), priceList:w("quote"), priceMailing:w("pricing"), quoteGet:r("quote"), quoteList:r("quote"), quoteShare:w("quote"), quoteRelaySync:w("quote"), quoteDecide:w("quoteApprove"),
};
/** The capability each command needs, read from ACTIONS. */
export const ACTION_CAP = Object.fromEntries(Object.entries(ACTIONS).map(([action, v]) => [action, v.cap])) as Record<Action, Cap | null>;
/** Commands that keep working while the licence is read-only, read from ACTIONS. */
export const READ_ONLY_ACTIONS: ReadonlySet<Action> = new Set((Object.keys(ACTIONS) as Action[]).filter(action => ACTIONS[action].mode === "read"));
/** Sections of the app a role can open (the worker still checks every command). */
export function sectionsFor(caps: Cap[]): string[] {
  const has = (c: Cap) => caps.includes(c);
  return ["Home", ...(has("data") ? ["Data Hub"] : []), ...(has("cost") ? ["Margin"] : []), ...(has("guards") ? ["Pricing"] : []), ...(has("quote") ? ["Quotes"] : []), ...(has("rebates") ? ["Rebates & Contracts"] : []), ...(has("cost") ? ["Vendors"] : []), ...(has("cost") || has("reconcile") || has("audit") || has("quote") ? ["Reports"] : []), ...(has("roles") || has("backup") || has("audit") ? ["Settings"] : [])];
}
