import type { Role, Settings } from "../studio/formats";
import type { ErpProfile, FieldSource } from "../studio/mapper";
import type { FixGroup, FixRow } from "../studio/fixlater";
import type { Health } from "../studio/health";
import type { PlaygroundManifest } from "../studio/playground";
import type { SourceView, StudioState } from "../studio/studio";
export type Tier = "starter" | "professional" | "scale";
export type Scope = { userId: string; tenantId: string };
export type VaultStatus = {
  state: "locked" | "unlocked"; exists: boolean; dirty: boolean; recovered: boolean;
  /** writable: the first change will not need a copy; preparing: that copy is running in the background. */
  writable: boolean; preparing: boolean;
  lines: string; products: string; customers: string; auditEntries: string;
  schemaVersion: string; generation: string; tier: Tier; lastSaved: string | null;
  totals?: { list: string; discounts: string; freight: string; rebates: string; pocket: string; cost: string; margin: string };
};
export type StorageStatus = { persistent: boolean; usage: string; quota: string; namedOpfsBytes: string; files: string };
export type ImportEstimate = { bytes: string; estimatedMemoryBytes: string; maxLines: string; maxProducts: string; warning: string };
export type Commands = {
  init: { scope: Scope };
  create: { passphrase: string; tier: Tier };
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
};
export type CommitResult = { loaded: string; rejected: string; files: string; cleanup: boolean };
export type Results = {
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
};
export type Action = keyof Commands;
export type Request = { [K in Action]: { id: string; action: K; data: Commands[K] } }[Action];
export type Response = { [K in Action]: { id: string; action: K; result: Results[K] } }[Action]
  | { id: string; error: { code: string; message: string } }
  | { event: "progress"; stage: string; done: string; total: string }
  | { event: "locked"; reason: string }
  | { event: "writable" };
export class VaultError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export const CAPS = {
  starter: { products: 20_000, lines: 200_000 },
  professional: { products: 100_000, lines: 1_000_000 },
  scale: { products: 200_000, lines: 1_000_000 },
} as const;
export const MAX_CSV_BYTES = 256 * 1024 * 1024;
export const AUTO_LOCK_MS = 10 * 60 * 1000;
// A closed or crashed tab's lease is released by the browser shortly after its
// worker dies; wait this long before reporting that another tab holds the vault.
export const LEASE_WAIT_MS = 10_000;
