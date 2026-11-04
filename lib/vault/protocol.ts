import type { VaultService } from './service';
import type { RuleInput, GuardInput } from '../pricing/rules';
import type { Role, Settings } from "../studio/formats";
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
export type Tier = "starter" | "professional" | "scale";
export type Scope = { userId: string; tenantId: string };
/** What the signed-in person may do in this vault. Computed in the worker; the UI only mirrors it. */
export type Access = { role: RoleId; roleLabel: string; assigned: boolean; viewAs: RoleId | null; caps: Cap[]; sections: string[]; ownerNamed: boolean; repSeesCost: boolean };
export type VaultStatus = {
  licence?: {writable:boolean;tier:Tier;offline:boolean;until:string|null;reason:string};
  state: "locked" | "unlocked"; exists: boolean; dirty: boolean; recovered: boolean;
  /** writable: the first change will not need a copy; preparing: that copy is running in the background. */
  writable: boolean; preparing: boolean;
  lines: string; products: string; customers: string; auditEntries: string;
  schemaVersion: string; generation: string; tier: Tier; lastSaved: string | null;
  /** cost and margin are null for roles that may not see cost: the worker never selects them. */
  totals?: { list: string; discounts: string; freight: string; rebates: string; pocket: string; cost: string | null; margin: string | null };
  access?: Access;
};
export type Person = { userId: string; name: string; role: RoleId; roleLabel: string; assignedAt: string; you: boolean };
export type RoleList = { people: Person[]; you: Access; repSeesCost: boolean; pricingOwner: string | null; canManage: boolean };
export type HomeData = {
  access: Access; checklist: Checklist; pricingOwner: string | null; guardrails: string;
  roi?: RoiSummary; margin?: { netPocket: string; margin: string; rate: string; uncostedLines: string; lines: string };
  openFixLater?: string; openRecon?: string; previews?: string; rules?: string; cleanup?: { duplicates: string; units: string; categories: string };
};
export type CleanupApplied = { fix: string; finished: boolean; status: VaultStatus; scan: Scan; history: FixView[] };
export type CleanupMergedAll = { merged: string; skipped: string; unfinished: string; ids: string[]; status: VaultStatus; scan: Scan; history: FixView[] };
export type CleanupUndone = { summary: string; restored: string; skipped: string; status: VaultStatus; scan: Scan; history: FixView[] };
export type StorageStatus = { persistent: boolean; usage: string; quota: string; namedOpfsBytes: string; files: string };
export type ImportEstimate = { bytes: string; estimatedMemoryBytes: string; maxLines: string; maxProducts: string; warning: string };
export type Commands = {
  home: Record<string, never>;
  checklist: Record<string, never>;
  checklistMark: { step: Step };
  roleList: Record<string, never>;
  roleSet: { userId: string; name: string; role: RoleId };
  roleRemove: { userId: string };
  accessSet: { repSeesCost: boolean };
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
  rulePreview: { id:string; offset?:number };
  ruleApprove: { id:string };
  priceExport: { id:string; profile:ErpProfile; format:'csv'|'xlsx' };
  backupStatus: Record<string, never>;
  backupConfigure: { directory:FileSystemDirectoryHandle|null; hours:number };
  backupNow: Record<string, never>;
  backupExport: Record<string, never>;
  backupRestore: { file:Blob; passphrase:string };
  init: { scope: Scope };
  /** ownerName is required: a vault always starts with a named Pricing Owner. */
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
  studioUpdate: { id: string; settings?: Partial<Settings>; role?: Role | null; erp?: ErpProfile; field?: { name: string; source: FieldSource }; confirmed?: boolean };
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
  marginDrill: { dim: Dim; filters?: Filters; sort?: "margin" | "pocket" | "rate" };
  marginWhale: { filters?: Filters };
  marginMath: { metric: Metric; filters?: Filters; offset?: number };
  leaks: Record<string, never>;
  leakRows: { id: string; offset?: number };
  leakReport: Record<string, never>;
  roi: Record<string, never>;
  reconcile: Record<string, never>;
  reconAccept: { id: string | null };
  reconRebuild: Record<string, never>;
};
export type LeaksView = { result: LeakResult; roi: RoiSummary; sample: boolean; recorded: number };
export type CommitResult = { loaded: string; rejected: string; files: string; cleanup: boolean };
export type Results = {
  licenceSet: VaultStatus;
  home: HomeData; checklist: Checklist; checklistMark: Checklist; roleList: RoleList; roleSet: RoleList; roleRemove: RoleList; accessSet: RoleList; rolePreview: RoleList;
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
  leaks: LeaksView; leakRows: { rows: LeakRow[]; count: string; sum: string; engineAgrees: boolean };
  leakReport: { name: string; blob: Blob; bytes: string; status: VaultStatus }; roi: RoiSummary;
  reconcile: ReconSummary; reconAccept: { status: VaultStatus; recon: ReconSummary }; reconRebuild: { status: VaultStatus; recon: ReconSummary };
};
export type Action = keyof Commands;
export type Request = { [K in Action]: { id: string; action: K; data: Commands[K] } }[Action];
export type Response = { [K in Action]: { id: string; action: K; result: Results[K] } }[Action]
  | { id: string; error: { code: string; message: string } }
  | { event: "progress"; stage: string; done: string; total: string }
  | { event: "locked"; reason: string }
  | { event: "writable" }
  | { event: "licence"; status:VaultStatus };
export class VaultError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
// One reviewed limit definition is shared with assertion issuance and tests.
export { LICENCE_LIMITS as CAPS } from '../licence-policy';
export const MAX_CSV_BYTES = 256 * 1024 * 1024;
export const AUTO_LOCK_MS = 10 * 60 * 1000;
// A closed or crashed tab's lease is released by the browser shortly after its
// worker dies; wait this long before reporting that another tab holds the vault.
export const LEASE_WAIT_MS = 10_000;
