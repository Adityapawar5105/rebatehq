export type Tier = "starter" | "professional" | "scale";
export type Scope = { userId: string; tenantId: string };
export type VaultStatus = {
  state: "locked" | "unlocked"; exists: boolean; dirty: boolean; recovered: boolean;
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
  estimate: { file: File };
  import: { file: File; confirmed: boolean };
  cancel: Record<string, never>;
  save: Record<string, never>;
  verify: Record<string, never>;
  storage: Record<string, never>;
};
export type Results = {
  init: VaultStatus; create: VaultStatus; unlock: VaultStatus; lock: VaultStatus; status: VaultStatus;
  touch: { ok: boolean }; cancel: { ok: boolean }; save: VaultStatus;
  estimate: ImportEstimate; import: VaultStatus;
  verify: { valid: boolean; entries: string }; storage: StorageStatus;
};
export type Action = keyof Commands;
export type Request = { [K in Action]: { id: string; action: K; data: Commands[K] } }[Action];
export type Response = { [K in Action]: { id: string; action: K; result: Results[K] } }[Action]
  | { id: string; error: { code: string; message: string } }
  | { event: "progress"; stage: string; done: string; total: string }
  | { event: "locked"; reason: string };
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
