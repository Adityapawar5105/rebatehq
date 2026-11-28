import type { SimInput, SimDim } from '../vendor/simulate';
import type {BridgeInput} from "../margin/bridge";
import type {GridMeta,GridQuery,GridType,Totals} from "../grid/core";
import type {PlanInput,ExceptionInput} from "../pricing/ops";
import type { VaultService } from './service';
import type { RuleInput, GuardInput } from '../pricing/rules';
import type { Role, Settings, SettingsPatch } from "../studio/formats";
import type { ErpProfile, FieldSource } from "../studio/mapper";
import type { FixGroup, FixRow } from "../studio/fixlater";
import type { Health } from "../studio/health";
import type { PlaygroundManifest } from "../studio/playground";
import type { SourceView, StudioState } from "../studio/studio";
import type { Dim, Drill, Filters, MathPanel, Metric, Waterfall, Whale } from "../margin/views";
import type { LeakResult, LeakRow } from "../margin/leaks";
import type { RoiSummary } from "../margin/roi";
import type { ReconSummary } from "../margin/aggregate";
import type { Cap, RoleId } from "../roles/access";
import type { Checklist, Step } from "../setup/checklist";
import type { FixKind, FixView, Scan } from "../cleanup/item-master";
import type { BasisId, CostBasisView } from "../cost/basis";
import type { RelayView } from '../relay/session';
import type { ShareInput } from '../relay/protocol';
import type { LineInput, PricePoint, QuoteSummary, QuoteView } from "../quotes/quotes";
export type Tier = "starter" | "professional" | "scale";
export type Scope = { userId: string; tenantId: string };
/** What the signed-in person may do in this vault. Computed in the worker; the UI only mirrors it. */
export type Access = { role: RoleId; roleLabel: string; assigned: boolean; viewAs: RoleId | null; caps: Cap[]; sections: string[]; ownerNamed: boolean;
  /** Team sharing S3c: the packs this receiving seat holds read-only, with each publisher (lib/sharing/governed.ts). */
  shared?: import("../sharing/governed").SharedLock };
/** Roadmap 9.2: the vault's state as one value, decided in the worker (the older flags stay beside it). In order of
 *  precedence: no vault on this device, locked, read-only licence, unsaved changes, preparing the first change, ready. */
export type VaultPhase = "none" | "locked" | "readOnly" | "unsaved" | "preparing" | "ready";
export function vaultPhase(s: { state: "locked" | "unlocked"; exists: boolean; dirty: boolean; preparing: boolean; licence?: { writable: boolean } }): VaultPhase {
  if (s.state === "locked") return s.exists ? "locked" : "none";
  if (s.licence && !s.licence.writable) return "readOnly";
  return s.dirty ? "unsaved" : s.preparing ? "preparing" : "ready";
}
export type VaultStatus = {
  phase: VaultPhase;
  licence?: {writable:boolean;tier:Tier;offline:boolean;until:string|null;reason:string};
  state: "locked" | "unlocked"; exists: boolean; dirty: boolean; recovered: boolean;
  /** writable: the first change will not need a copy; preparing: that copy is running in the background. */
  writable: boolean; preparing: boolean;
  lines: string; products: string; customers: string; auditEntries: string;
  currency: string; schemaVersion: string; generation: string; tier: Tier; lastSaved: string | null;
  /** Unlocked only: the last saved snapshot's size against the 512 MiB limit; near from 85% (review flaw 11). */
  size?: { bytes: string; limit: string; near: boolean };
  /** Unlocked only: whether the vault holds no files, only the Playground's sample files, both, or real files only. */
  sample?: import("../studio/playground").SampleState;
  /** cost and margin are null for roles that may not see cost: the worker never selects them. */
  totals?: { list: string; discounts: string; freight: string; rebates: string; pocket: string; cost: string | null; margin: string | null };
  access?: Access;
};
export type Person = { userId: string; name: string; role: RoleId; roleLabel: string; assignedAt: string; you: boolean };
/** Team sharing on this vault, for Team and roles: whether this device joined, whether role edits are an unsigned Owner
 *  draft (signed at the next key rotation), and the packs each person receives under that grid (null with no grid). */
export type RoleSharing = { joined: boolean; canSign: boolean; draft: boolean; receives: Record<string, string[]> | null };
export type RoleList = { people: Person[]; you: Access; pricingOwner: string | null; canManage: boolean; sharing: RoleSharing };
export type HomeData = {
  access: Access; checklist: Checklist; pricingOwner: string | null; guardrails: string;
  /** The caller's own display name from Team and roles (or the Pricing Owner name if that is them), for the Home greeting. */
  displayName: string | null;
  roi?: RoiSummary; margin?: { netPocket: string; margin: string; rate: string; uncostedLines: string; lines: string };
  openFixLater?: string; openRecon?: string; previews?: string; rules?: string; cleanup?: { duplicates: string; units: string; categories: string };
};
export type CleanupApplied = { fix: string; finished: boolean; status: VaultStatus; scan: Scan; history: FixView[] };
export type CleanupMergedAll = { merged: string; skipped: string; unfinished: string; ids: string[]; status: VaultStatus; scan: Scan; history: FixView[] };
export type CleanupUndone = { summary: string; restored: string; skipped: string; status: VaultStatus; scan: Scan; history: FixView[] };
export type StorageStatus = { persistent: boolean; usage: string; quota: string; namedOpfsBytes: string; files: string };
export type ImportEstimate = { bytes: string; estimatedMemoryBytes: string; maxLines: string; maxProducts: string; warning: string };
export type Commands = {
  reportState:{};
  reportCheck:{kind:import('../reports/pack').PackKind;month?:string};
  reportExport:{id:string;locale?:string};
  roiV2:{};
  roiRows:{kind:import('../reports/roi').RoiKind;offset?:number;grid?:GridQuery};
  roiRecord:{input:import('../reports/roi').RecoveryInput};
  roiVoid:{id:string};
  scorecard:import('../reports/scorecard').ScoreInput;
  scorecardOptIn:{optIn:boolean};
  vendorSheets:Record<string,never>;
  vendorReview:{sheet:string;window?:number;offset?:number;grid?:GridQuery};
  vendorReviewQuotes:{sheet:string;offset?:number;grid?:GridQuery};
  vendorPpv:{from?:string;to?:string;offset?:number;grid?:GridQuery};
  vendorPpvLines:{product:string;from?:string;to?:string;offset?:number;grid?:GridQuery};
  simOptions:Record<string,never>;
  simRun:{scenario:SimInput};
  simRows:{dim:SimDim;offset?:number;grid?:GridQuery};
  customerList:{offset?:number;grid?:GridQuery};
  productList:{offset?:number;grid?:GridQuery};
  noteSet:{kind:"customer"|"product";id:string;text:string};
  sourceRemovePreview:{id:string};
  gridTotals:{types:GridType[];values:(string|null)[][]};
  supplierClaims:{offset?:number;grid?:GridQuery};
  supplierPurchases:{offset?:number;grid?:GridQuery;claimId?:string};
  supplierProgress:{offset?:number;grid?:GridQuery};
  supplierClaimPreview:{id:string};
  supplierClaimSave:{input:import('../rebate/supplier').ClaimInput};
  supplierClaimStatus:{id:string;status:import('../rebate/supplier').ClaimStatus};
  supplierClaimExport:{id:string;format:'csv'|'xlsx';fingerprint:string};
  rebateProgress:{offset?:number;grid?:GridQuery};
  rebateState:Record<string,never>;
  rebateRows:{id:string;offset?:number;grid?:GridQuery};
  rebateSave:{input:import('../rebate/store').ProgramInput};
  rebateDelete:{id:string};
  rebateRecalculate:Record<string,never>;
  homeMonitor:{thresholdBp?:string};
  currencySet: { currency: string };
  competitorList:{product:string;customer?:string|null};
  competitorAdd:{input:import("../pricing/market").CompetitorInput};
  priceGrid:{offset?:number;search?:string;grid?:GridQuery};
  priceGridPaste:{text:string;keys:string[];start:number};
  priceGridDraft:{edits:import("../pricing/grid").GridEdit[];revision:string};
  ruleWhatIf:{id:string;increase:string;exact:boolean};
  priceLandedState:{id?:string;offset?:number;grid?:GridQuery};
  priceLandedCheck:{receipt:string;file:File};
  serviceOrders:{offset?:number;grid?:GridQuery};
  serviceFlag:{key:string;free:boolean};
  marginBridge:{input?:BridgeInput};
  priceOpsState:Record<string,never>;
  priceExceptions:{input?:ExceptionInput};
  priceExpiry:{days:number;asOf?:string;offset?:number;grid?:GridQuery};
  pricePlan:{input:PlanInput};
  priceRollback:{version:string};
  priceLetter:{id:string;locale:import("../i18n/core").Locale};
  relayView:Record<string,never>;relayRegister:Record<string,never>;relayJoin:{fingerprint:string};relayRotate:{confirmations:{deviceId:string;fingerprint:string}[]};relaySync:Record<string,never>;
  relayShare:{input:Omit<ShareInput,'amountMinor'>&{amount:string}};relayRequest:{id:string;approvers:string[]};relayDecide:{id:string;decision:'approve'|'reject'};relayComment:{id:string;text:string;mentions:string[]};relayRetry:Record<string,never>;relayDiscard:Record<string,never>;
  relayThreadOpen:{target:import('../sharing/threads').Target;text:string;mentions:string[];task:import('../sharing/threads').TaskState|null};relayThreadReply:{id:string;text:string;mentions:string[]};relayThreadStatus:{id:string;resolved:boolean};relayThreadTask:{id:string;task:import('../sharing/threads').TaskState};
  home: Record<string, never>;
  checklist: Record<string, never>;
  checklistMark: { step: Step };
  roleList: Record<string, never>;
  roleSet: { userId: string; name: string; role: RoleId };
  roleRemove: { userId: string };
  rolePreview: { role: RoleId | null };
  cleanupScan: Record<string, never>;
  cleanupHistory: Record<string, never>;
  cleanupApply: { kind: FixKind; key: string; target?: string | null };
  cleanupUndo: { id: string };
  cleanupMergeAll: Record<string, never>;
  cleanupUndoMany: { ids: string[] };
  costBasis: Record<string, never>;
  costBasisSet: { group: string; basis: BasisId | null };
  pricingState: Record<string, never>;
  pricingOwner: { name:string; userId:string; backupDays:number };
  guardSet: { input:GuardInput };
  ruleSave: { input:RuleInput };
  ruleSimulate: { id:string };
  rulePreview: { id:string; offset?:number; grid?:GridQuery };
  ruleApprove: { id:string };
  priceExport: { id:string; profile:ErpProfile; format:'csv'|'xlsx'; layout?:string };
  exportLayouts: Record<string, never>; simSaved: Record<string, never>; simSave: { name: string }; simSavedDelete: { id: string }; exportLayoutSave: { input: unknown; id?: string }; exportLayoutDelete: { id: string };
  backupStatus: Record<string, never>;
  backupConfigure: { directory:FileSystemDirectoryHandle|null; hours:number };
  backupNow: Record<string, never>;
  backupExport: Record<string, never>;
  backupRestore: { file:Blob; passphrase:string };
  init: { scope: Scope };
  /** ownerName is required: a vault always starts with a named Pricing Owner. */
  capacityUpgrade: Record<string, never>;
  licenceSet: { envelope: import("../licence-policy").LicenceEnvelope | null; device:string; offline:boolean };
  create: { passphrase: string; tier: Tier; ownerName: string };
  unlock: { passphrase: string };
  lock: Record<string, never>;
  touch: Record<string, never>;
  status: Record<string, never>;
  cancel: Record<string, never>;
  save: Record<string, never>;
  verify: Record<string, never>;
  storage: Record<string, never>;
  studioAdd: { files: File[]; replaces?: string | null };
  folderGet: Record<string, never>; folderSet: { directory: FileSystemDirectoryHandle | null }; studioFolder: { files: File[] }; folderPickup: Record<string, never>; supplierClaimBalance: { id: string }; supplierPaymentRecord: { input: import("../rebate/finance").PaymentInput }; supplierPaymentVoid: { id: string }; rebateFinanceExport: { format: "csv" | "xlsx" }; folderPickupSet: { every: number; auto: boolean };
  studioUpdate: { id: string; settings?: SettingsPatch; role?: Role | null; erp?: ErpProfile; field?: { name: string; source: FieldSource }; confirmed?: boolean; range?: { from: string | null; to: string | null } };
  studioDrop: { id: string };
  studioClear: Record<string, never>;
  studioState: Record<string, never>;
  studioPlan: Record<string, never>;
  studioCommit: { acknowledge: boolean };
  studioDownload: { id: string };
  studioZip: Record<string, never>;
  recipeSave: { id: string; name: string };
  recipeApply: { id: string; recipeId: string };
  sources: Record<string, never>;
  sourceRemove: { id: string };
  fixGroups: Record<string, never>;
  fixRows: { sourceId: string; code: string; offset?: number };
  fixSet: { sourceId: string; code: string; field: string; value: string; rows?: number[] | null };
  fixDismiss: { sourceId: string; code: string; rows?: number[] | null };
  fixRecheck: { sourceId: string; code: string };
  health: Record<string, never>;
  playgroundLoad: Record<string, never>;
  playgroundRemove: Record<string, never>;
  creditsLoad: { sourceId: string };
  marginWaterfall: { filters?: Filters };
  marginDrill: { dim: Dim; filters?: Filters; sort?: "margin" | "pocket" | "rate"; grid?: GridQuery };
  marginWhale: { filters?: Filters };
  marginMath: { metric: Metric; filters?: Filters; offset?: number; grid?: GridQuery };
  leaks: Record<string, never>;
  leakRows: { id: string; offset?: number; grid?: GridQuery };
  leakReport: { locale?: string; ids?: string[] };
  search: { text: string };
  priceCheck: { productId: string; customerId: string | null; quantity: string };
  quoteCreate: { customerId: string }; quoteLines: { id: string; lines: LineInput[] }; quoteSubmit: { id: string; reason: string | null }; quoteWithdraw: { id: string }; quoteCopy: { id: string }; quoteRevise: { id: string }; quoteValidity: { id: string; validUntil: string | null }; quotePdf: { id: string; locale: import("../i18n/core").Locale }; brandingGet: Record<string, never>; brandingSet: { input: unknown }; priceList: { customerId: string; format: "csv" | "xlsx" }; priceMailing: { runId: string };
  vaultReset: Record<string, never>; passphraseChange: { current: string; next: string };
  quoteDecide: { id: string; decision: "approve" | "reject"; note: string | null }; quoteGet: { id: string }; quoteList: { pendingOnly?: boolean };
  quoteGuidance: { id: string }; quoteCrossSell: { id: string }; relayLocal: Record<string, never>;
  threadList: { target: { type: import("../sharing/threads").TargetType; ref: string[] } | null }; inboxState: Record<string, never>; inboxSeen: Record<string, never>; activityFeed: Record<string, never>;
  shareState: Record<string, never>; shareCounts: Record<string, never>; shareExport: { packs: string[]; role: RoleId; name: string };
  shareImportPreview: { file: Blob; code: string }; shareImport: { file: Blob; code: string };
  shareGrid: Record<string, never>; shareGridSave: { grid: import("../relay/protocol").Grid }; shareGridDiscard: Record<string, never>; sharePublish: Record<string, never>;
  quoteOutcome: { id: string; input: import("../quotes/winloss").OutcomeInput }; winLoss: import("../quotes/winloss").ReportInput; auditPack: { locale: import("../i18n/core").Locale };
  templateVendors: Record<string, never>; negotiationSheet: { vendor: string; locale: import("../i18n/core").Locale }; rebateAgreement: { id: string; locale: import("../i18n/core").Locale };
  agentState: Record<string, never>; agentRows: { offset?: number; grid?: GridQuery }; agentRun: Record<string, never>; agentMark: { key: string; status: "new" | "read" | "dismissed" };
  agentSettingsSave: { input: Omit<import("../agents/agents").AgentSettings, "updatedAt"> }; indexState: Record<string, never>; indexSkus: { id: string; offset?: number; grid?: GridQuery };
  indexTriggerSave: { input: import("../agents/costindex").TriggerInput }; indexTriggerDelete: { id: string };
  deadState: Record<string, never>;
  benchState: Record<string, never>; benchPreview: { quarter: string }; benchMapSave: { mapping: Record<string, string | null> }; benchShared: { payload: unknown; stored: number }; benchFiguresSave: { quarter: string; cells: unknown }; benchWithdrawn: Record<string, never>; deadRows: { offset?: number; grid?: GridQuery }; deadSettingsSave: { input: Omit<import("../inventory/deadstock").DeadSettings, "updatedAt"> }; deadDraft: { ids: string[] };
  quoteShare: { id: string; preset: "standard" | "conservative" }; quoteRelaySync: { id: string };
  roi: Record<string, never>;
  reconcile: Record<string, never>;
  reconAccept: { id: string | null };
  reconRebuild: Record<string, never>;
};
export type LeaksView = { result: LeakResult; roi: RoiSummary; sample: boolean; recorded: number };
/** totalsStale (review flaw 16): the rows were imported and saved, but the margin totals could not be rebuilt; the next change rebuilds them. */
export type CommitResult = { loaded: string; rejected: string; files: string; cleanup: boolean; totalsStale?: boolean };
export type Results = {
  reportState:Awaited<ReturnType<VaultService["reportState"]>>;
  reportCheck:Awaited<ReturnType<VaultService["reportCheck"]>>;
  reportExport:Awaited<ReturnType<VaultService["reportExport"]>>;
  roiV2:Awaited<ReturnType<VaultService["roiV2"]>>;
  roiRows:Awaited<ReturnType<VaultService["roiRows"]>>;
  roiRecord:Awaited<ReturnType<VaultService["roiRecord"]>>;
  roiVoid:Awaited<ReturnType<VaultService["roiVoid"]>>;
  scorecard:Awaited<ReturnType<VaultService["scorecard"]>>;
  scorecardOptIn:Awaited<ReturnType<VaultService["scorecardOptIn"]>>;
  vendorSheets:Awaited<ReturnType<VaultService["vendorSheets"]>>;
  vendorReview:Awaited<ReturnType<VaultService["vendorReview"]>>;
  vendorReviewQuotes:Awaited<ReturnType<VaultService["vendorReviewQuotes"]>>;
  vendorPpv:Awaited<ReturnType<VaultService["vendorPpv"]>>;
  vendorPpvLines:Awaited<ReturnType<VaultService["vendorPpvLines"]>>;
  simOptions:Awaited<ReturnType<VaultService["simOptions"]>>;
  relayLocal:Awaited<ReturnType<VaultService["relayLocal"]>>; threadList:Awaited<ReturnType<VaultService["threadList"]>>; inboxState:Awaited<ReturnType<VaultService["inboxState"]>>; inboxSeen:Awaited<ReturnType<VaultService["inboxSeen"]>>; activityFeed:Awaited<ReturnType<VaultService["activityFeed"]>>; shareState:Awaited<ReturnType<VaultService["shareState"]>>; shareCounts:Awaited<ReturnType<VaultService["shareCounts"]>>; shareExport:Awaited<ReturnType<VaultService["shareExport"]>>; shareImportPreview:Awaited<ReturnType<VaultService["shareImportPreview"]>>; shareImport:Awaited<ReturnType<VaultService["shareImport"]>>; shareGrid:Awaited<ReturnType<VaultService["shareGrid"]>>; shareGridSave:Awaited<ReturnType<VaultService["shareGridSave"]>>; shareGridDiscard:Awaited<ReturnType<VaultService["shareGridDiscard"]>>; sharePublish:Awaited<ReturnType<VaultService["sharePublish"]>>; quoteOutcome:Awaited<ReturnType<VaultService["quoteOutcome"]>>; winLoss:Awaited<ReturnType<VaultService["winLoss"]>>; auditPack:Awaited<ReturnType<VaultService["auditPack"]>>;
  templateVendors:Awaited<ReturnType<VaultService["templateVendors"]>>; negotiationSheet:Awaited<ReturnType<VaultService["negotiationSheet"]>>; rebateAgreement:Awaited<ReturnType<VaultService["rebateAgreement"]>>;
  agentState:Awaited<ReturnType<VaultService["agentState"]>>; agentRows:Awaited<ReturnType<VaultService["agentRows"]>>; agentRun:Awaited<ReturnType<VaultService["agentRun"]>>; agentMark:Awaited<ReturnType<VaultService["agentMark"]>>;
  agentSettingsSave:Awaited<ReturnType<VaultService["agentSettingsSave"]>>; indexState:Awaited<ReturnType<VaultService["indexState"]>>; indexSkus:Awaited<ReturnType<VaultService["indexSkus"]>>;
  indexTriggerSave:Awaited<ReturnType<VaultService["indexTriggerSave"]>>; indexTriggerDelete:Awaited<ReturnType<VaultService["indexTriggerDelete"]>>; deadState:Awaited<ReturnType<VaultService["deadState"]>>; benchState:Awaited<ReturnType<VaultService["benchState"]>>; benchPreview:Awaited<ReturnType<VaultService["benchPreview"]>>; benchMapSave:Awaited<ReturnType<VaultService["benchMapSave"]>>; benchShared:Awaited<ReturnType<VaultService["benchShared"]>>; benchFiguresSave:Awaited<ReturnType<VaultService["benchFiguresSave"]>>; benchWithdrawn:Awaited<ReturnType<VaultService["benchWithdrawn"]>>; deadRows:Awaited<ReturnType<VaultService["deadRows"]>>; deadSettingsSave:Awaited<ReturnType<VaultService["deadSettingsSave"]>>; deadDraft:Awaited<ReturnType<VaultService["deadDraft"]>>; quoteGuidance:Awaited<ReturnType<VaultService["quoteGuidance"]>>; quoteCrossSell:Awaited<ReturnType<VaultService["quoteCrossSell"]>>;
  folderGet:Awaited<ReturnType<VaultService["folderGet"]>>; folderSet:Awaited<ReturnType<VaultService["folderSet"]>>; studioFolder:Awaited<ReturnType<VaultService["studioFolder"]>>; folderPickup:Awaited<ReturnType<VaultService["folderPickup"]>>; supplierClaimBalance:Awaited<ReturnType<VaultService["supplierClaimBalance"]>>; supplierPaymentRecord:Awaited<ReturnType<VaultService["supplierPaymentRecord"]>>; supplierPaymentVoid:Awaited<ReturnType<VaultService["supplierPaymentVoid"]>>; rebateFinanceExport:Awaited<ReturnType<VaultService["rebateFinanceExport"]>>; folderPickupSet:Awaited<ReturnType<VaultService["folderPickupSet"]>>;
  simRun:Awaited<ReturnType<VaultService["simRun"]>>;
  simRows:Awaited<ReturnType<VaultService["simRows"]>>;
  customerList:Awaited<ReturnType<VaultService["customerList"]>>;
  productList:Awaited<ReturnType<VaultService["productList"]>>;
  noteSet:Awaited<ReturnType<VaultService["noteSet"]>>;
  sourceRemovePreview:Awaited<ReturnType<VaultService["sourceRemovePreview"]>>;
  gridTotals:Totals[];
  supplierClaims:Awaited<ReturnType<VaultService['supplierClaims']>>;
  supplierPurchases:Awaited<ReturnType<VaultService['supplierPurchases']>>;
  supplierProgress:Awaited<ReturnType<VaultService['supplierProgress']>>;
  supplierClaimPreview:Awaited<ReturnType<VaultService['supplierClaimPreview']>>;
  supplierClaimSave:Awaited<ReturnType<VaultService['supplierClaimSave']>>;
  supplierClaimStatus:Awaited<ReturnType<VaultService['supplierClaimStatus']>>;
  supplierClaimExport:Awaited<ReturnType<VaultService['supplierClaimExport']>>;
  rebateProgress:Awaited<ReturnType<VaultService['rebateProgress']>>;
  rebateState:Awaited<ReturnType<VaultService['rebateState']>>;
  rebateRows:Awaited<ReturnType<VaultService['rebateRows']>>;
  rebateSave:Awaited<ReturnType<VaultService['rebateSave']>>;
  rebateDelete:Awaited<ReturnType<VaultService['rebateDelete']>>;
  rebateRecalculate:Awaited<ReturnType<VaultService['rebateRecalculate']>>;
  homeMonitor:Awaited<ReturnType<VaultService['homeMonitor']>>;
  currencySet: VaultStatus;
  competitorList:Awaited<ReturnType<VaultService["competitorList"]>>;
  competitorAdd:Awaited<ReturnType<VaultService["competitorAdd"]>>;
  priceGrid:Awaited<ReturnType<VaultService["priceGrid"]>>;
  priceGridPaste:Awaited<ReturnType<VaultService["priceGridPaste"]>>;
  priceGridDraft:Awaited<ReturnType<VaultService["priceGridDraft"]>>;
  ruleWhatIf:Awaited<ReturnType<VaultService["ruleWhatIf"]>>;
  priceLandedState:Awaited<ReturnType<VaultService["priceLandedState"]>>;
  priceLandedCheck:Awaited<ReturnType<VaultService["priceLandedCheck"]>>;
  serviceOrders:Awaited<ReturnType<VaultService["serviceOrders"]>>;
  serviceFlag:Awaited<ReturnType<VaultService["serviceFlag"]>>;
  marginBridge:Awaited<ReturnType<VaultService["marginBridge"]>>;
  priceOpsState:Awaited<ReturnType<VaultService["priceOpsState"]>>;
  priceExceptions:Awaited<ReturnType<VaultService["priceExceptions"]>>;
  priceExpiry:Awaited<ReturnType<VaultService["priceExpiry"]>>;
  pricePlan:Awaited<ReturnType<VaultService["pricePlan"]>>;
  priceRollback:Awaited<ReturnType<VaultService["priceRollback"]>>;
  priceLetter:Awaited<ReturnType<VaultService["priceLetter"]>>;
  relayView:RelayView;relayRegister:RelayView;relayJoin:RelayView;relayRotate:RelayView;relaySync:RelayView;relayShare:RelayView;relayRequest:RelayView;relayDecide:RelayView;relayComment:RelayView;relayRetry:RelayView;relayDiscard:RelayView;relayThreadOpen:RelayView;relayThreadReply:RelayView;relayThreadStatus:RelayView;relayThreadTask:RelayView;
  capacityUpgrade: VaultStatus;
  licenceSet: VaultStatus;
  search: SearchHit[];
  priceCheck: PricePoint; quoteCreate: QuoteView; quoteLines: QuoteView; quoteSubmit: QuoteView; quoteWithdraw: QuoteView; quoteCopy: QuoteView; quoteRevise: QuoteView; quoteValidity: QuoteView; quotePdf: { name: string; bytes: Uint8Array }; brandingGet: import("../quotes/documents").Branding | null; brandingSet: import("../quotes/documents").Branding | null; priceList: { name: string; blob: Blob; rows: number }; priceMailing: { name: string; blob: Blob; rows: number }; vaultReset: VaultStatus; passphraseChange: VaultStatus; quoteDecide: QuoteView; quoteGet: QuoteView; quoteList: QuoteSummary[]; quoteShare: QuoteView; quoteRelaySync: QuoteView;
  home: HomeData; checklist: Checklist; checklistMark: Checklist; roleList: RoleList; roleSet: RoleList; roleRemove: RoleList; rolePreview: RoleList;
  cleanupScan: Scan; cleanupHistory: FixView[]; cleanupApply: CleanupApplied; cleanupUndo: CleanupUndone; cleanupMergeAll: CleanupMergedAll; cleanupUndoMany: CleanupUndone;
  costBasis: CostBasisView; costBasisSet: CostBasisView;
  pricingState: Awaited<ReturnType<VaultService['pricingState']>>;
  pricingOwner: Awaited<ReturnType<VaultService['pricingOwner']>>;
  guardSet: Awaited<ReturnType<VaultService['guardSet']>>;
  ruleSave: Awaited<ReturnType<VaultService['ruleSave']>>;
  ruleSimulate: Awaited<ReturnType<VaultService['ruleSimulate']>>;
  rulePreview: Awaited<ReturnType<VaultService['rulePreview']>>;
  ruleApprove: Awaited<ReturnType<VaultService['ruleApprove']>>;
  priceExport: Awaited<ReturnType<VaultService['priceExport']>>;
  exportLayouts: Awaited<ReturnType<VaultService['exportLayouts']>>; simSaved: Awaited<ReturnType<VaultService['simSaved']>>; simSave: Awaited<ReturnType<VaultService['simSave']>>; simSavedDelete: Awaited<ReturnType<VaultService['simSavedDelete']>>; exportLayoutSave: Awaited<ReturnType<VaultService['exportLayoutSave']>>; exportLayoutDelete: Awaited<ReturnType<VaultService['exportLayoutDelete']>>;
  backupStatus: Awaited<ReturnType<VaultService['backupStatus']>>;
  backupConfigure: Awaited<ReturnType<VaultService['backupConfigure']>>;
  backupNow: Awaited<ReturnType<VaultService['backupNow']>>;
  backupExport: Awaited<ReturnType<VaultService['backupExport']>>;
  backupRestore: Awaited<ReturnType<VaultService['backupRestore']>>;
  init: VaultStatus; create: VaultStatus; unlock: VaultStatus; lock: VaultStatus; status: VaultStatus;
  touch: { ok: boolean }; cancel: { ok: boolean }; save: VaultStatus;
  verify: { valid: boolean; entries: string }; storage: StorageStatus;
  studioAdd: StudioState; studioUpdate: StudioState; studioDrop: StudioState; studioClear: StudioState; studioState: StudioState;
  studioPlan: StudioState; recipeSave: StudioState; recipeApply: StudioState;
  studioCommit: { status: VaultStatus; studio: StudioState; result: CommitResult };
  studioDownload: { name: string; blob: Blob }; studioZip: { name: string; blob: Blob };
  sources: SourceView[]; sourceRemove: { status: VaultStatus; cleanup: boolean };
  fixGroups: FixGroup[]; fixRows: FixRow[]; fixSet: FixGroup[]; fixDismiss: { status: VaultStatus; groups: FixGroup[] };
  fixRecheck: { status: VaultStatus; groups: FixGroup[]; loaded: string; stillRejected: string };
  health: Health; playgroundLoad: { status: VaultStatus; manifest: PlaygroundManifest }; playgroundRemove: { status: VaultStatus; removed: string };
  creditsLoad: { status: VaultStatus; groups: FixGroup[]; loaded: string; stillRejected: string };
  marginWaterfall: Waterfall; marginDrill: Drill; marginWhale: Whale; marginMath: MathPanel;
  leaks: LeaksView; leakRows: { rows: LeakRow[]; count: string; sum: string; engineAgrees: boolean; grid: GridMeta };
  leakReport: { name: string; blob: Blob; bytes: string; status: VaultStatus }; roi: RoiSummary;
  reconcile: ReconSummary; reconAccept: { status: VaultStatus; recon: ReconSummary }; reconRebuild: { status: VaultStatus; recon: ReconSummary };
};
export type Action = keyof Commands;
export type Request = { [K in Action]: { id: string; action: K; data: Commands[K] } }[Action];
export type Response = { [K in Action]: { id: string; action: K; result: Results[K] } }[Action]
  | { id: string; error: { code: string; message: string } }
  | { event: "progress"; stage: string; done: string; total: string; /** Audit B-12: "save" offers no Cancel; "sim" and "check" label their Cancel. */ kind?: import("../studio/studio").ProgressKind }
  | { event: "locked"; reason: string }
  /** Sent LOCK_WARNING_MS before the idle lock (audit B-8): the page offers "Stay unlocked". */
  | { event: "locking" }
  | { event: "writable" }
  | { event: "agents" }
  /** Team sharing S4: a background sync applied newer shared data or changed the inbox. */
  | { event: "relay" }
  | { event: "pickup"; result: import("./folder").PickupResult; name: string | null }
  | { event: "licence"; status:VaultStatus };
/** Command palette hit: IDs and names only, never cost or price (chunk 7U). */
/** `note` is an excerpt of a matching note, only for a role allowed to see notes (never a Sales Rep). */
export type SearchHit = { kind: "product" | "customer"; id: string; label: string; detail: string; note?: string };
export class VaultError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
// One reviewed limit definition is shared with assertion issuance and tests.
export { LICENCE_LIMITS as CAPS } from '../licence-policy';
export const MAX_CSV_BYTES = 256 * 1024 * 1024;
export const AUTO_LOCK_MS = 10 * 60 * 1000;
export const LOCK_WARNING_MS = 60 * 1000;
// A closed or crashed tab's lease is released by the browser shortly after its
// worker dies; wait this long before reporting that another tab holds the vault.
export const LEASE_WAIT_MS = 10_000;
