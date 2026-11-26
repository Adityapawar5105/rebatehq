// Team sharing S3 (SHARING_DESIGN.md section 6): on a receiving seat, the data a publisher shares through the relay is
// read-only. The publisher is authoritative: a local edit to a shared row would be replaced by the next publish, so the
// worker refuses it instead of letting it vanish. Every write command is classified here, and
// tests/sharing-governed.test.ts fails when a new one is added without a decision.
import type { Action } from "../vault/protocol";
import type { PackId } from "./packs";

/** The packs an import of each file kind writes over (lib/studio/load.ts). Sales history, purchases and AR aging only add
 *  IDs that are missing, so they never touch a shared row and are not listed. */
export const IMPORT_PACKS: Readonly<Record<string, readonly PackId[]>> = {
  item_master: ["items", "cost"], customer_list: ["customers"], vendor_cost: ["cost"], price_list: ["book", "contracts"],
};

/** Writes that change a table a shared pack carries: the packs they write, "import" (decided by the staged files' kinds)
 *  or "any" (refused while any pack is shared through the relay). */
export const GOVERNED: Readonly<Partial<Record<Action, readonly PackId[] | "import" | "any">>> = {
  guardSet: ["guards", "cost_floors"],            // price_guardrails
  ruleApprove: ["book", "contracts", "guards"],   // applies an approved change to price_matrix and price_guardrails
  costBasisSet: ["cost"],                         // cost_basis_settings
  cleanupApply: ["items"], cleanupUndo: ["items"], cleanupMergeAll: ["items"], cleanupUndoMany: ["items"], // products
  studioPlan: "import", studioCommit: "import",
  fixRecheck: "import",                           // reloads rows of one earlier file: decided by that file's kind (review R1)
  playgroundLoad: "any",                          // loads sample items, customers and prices
  shareImport: "any",                             // an S1 hand-off file would replace relay copies
};

/** Writes that never change a shared row, each with the reason. */
export const NOT_GOVERNED: Readonly<Partial<Record<Action, string>>> = {
  reportCheck: "report history", reportExport: "a generated file", roiRecord: "ROI records", roiVoid: "ROI records", scorecardOptIn: "own consent",
  simSave: "saved simulations", simSavedDelete: "saved simulations", shareExport: "a file for a colleague", shareGridSave: "the grid draft",
  shareGridDiscard: "the grid draft", sharePublish: "publishers only", agentRun: "agent findings", agentMark: "agent findings",
  agentSettingsSave: "agent settings", indexTriggerSave: "cost index triggers", indexTriggerDelete: "cost index triggers",
  benchMapSave: "benchmark mapping", benchShared: "benchmark records", benchFiguresSave: "benchmark records", benchWithdrawn: "benchmark records",
  deadSettingsSave: "dead-stock settings", deadDraft: "a draft that needs approval", studioFolder: "the remembered folder",
  supplierClaimSave: "supplier claims", supplierClaimStatus: "supplier claims", supplierClaimExport: "supplier claims",
  supplierPaymentRecord: "claim payments", supplierPaymentVoid: "claim payments", rebateFinanceExport: "a generated file",
  noteSet: "own notes, kept local", rebateSave: "rebate programmes", rebateDelete: "rebate programmes", rebateRecalculate: "rebate accruals",
  currencySet: "currency settings", competitorAdd: "competitor log", priceGridDraft: "a draft that needs approval",
  priceLandedCheck: "export receipts", serviceFlag: "cost-to-serve flags", pricePlan: "a draft that needs approval",
  priceRollback: "a draft that needs approval", priceLetter: "a generated file", quoteOutcome: "quotes", auditPack: "a generated file",
  negotiationSheet: "a generated file", rebateAgreement: "a generated file", relayView: "relay state", relayRegister: "relay state",
  relayJoin: "relay state", relayRotate: "relay state", relaySync: "relay state", relayShare: "relay state", relayRequest: "relay state",
  relayDecide: "relay state", relayComment: "relay state", relayRetry: "relay state", relayDiscard: "relay state",
  relayThreadOpen: "relay state", relayThreadReply: "relay state", relayThreadStatus: "relay state", relayThreadTask: "relay state", inboxSeen: "relay state",
  capacityUpgrade: "vault capacity", create: "a new vault", vaultReset: "starting again on this device", passphraseChange: "the passphrase",
  checklistMark: "the checklist", roleSet: "roles follow the signed grid", roleRemove: "roles follow the signed grid", pricingOwner: "roles follow the signed grid",
  ruleSave: "a draft that needs approval", ruleSimulate: "a preview", priceExport: "export files and receipts",
  exportLayoutSave: "export layouts", exportLayoutDelete: "export layouts", backupRestore: "whole-vault recovery; newer publishes apply again",
  studioAdd: "staging only", studioUpdate: "staging only", studioDrop: "staging only", studioClear: "staging only",
  recipeSave: "import recipes", recipeApply: "staging only", sourceRemove: "removes only rows its own file supplied",
  fixSet: "staging only", fixDismiss: "staging only", playgroundRemove: "removes only sample files",
  creditsLoad: "credit notes", leakReport: "a generated file", reconAccept: "reconciliation", reconRebuild: "reconciliation",
  quoteCreate: "quotes", quoteLines: "quotes", quoteSubmit: "quotes", quoteWithdraw: "quotes", quoteCopy: "quotes", quoteRevise: "quotes",
  quoteValidity: "quotes", brandingSet: "quote branding", priceList: "a generated file", priceMailing: "a generated file",
  quoteShare: "quotes", quoteRelaySync: "quotes", quoteDecide: "quotes",
};

/** What a receiving seat holds read-only: each pack received through the relay, with its publisher's name. Null on a
 *  publisher, without sharing, or with nothing received. Carried on Access so screens can disable a write before it is tried. */
export type SharedLock = { packs: Record<string, string> } | null;

/** The packs a write would change that this seat holds read-only (empty when the write is allowed). The worker refuses
 *  the command and the screens disable its button, both from this one rule. */
export function lockedPacks(action: string, held: SharedLock, fileRoles: readonly (string | null | undefined)[] = []): string[] {
  const rule = GOVERNED[action as Action]; if (!rule || !held) return [];
  const packs = rule === "any" ? Object.keys(held.packs) : rule === "import" ? fileRoles.flatMap(r => IMPORT_PACKS[String(r ?? "")] ?? []) : rule;
  return [...new Set(packs.filter(p => p in held.packs))];
}
