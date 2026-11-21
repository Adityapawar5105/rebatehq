// Chunk 7F-2: the remembered import folder for folder re-import. Only the folder handle is kept, in this browser's
// IndexedDB under the vault scope (like the backup folder, lib/vault/backup.ts); never a file, a path or business data.
// Read permission is asked again in each session by the page, in the user's click (File System Access in Chrome/Edge).
// Roadmap 15.1 (21 Nov 2026): the scheduled pickup settings sit next to the handle, under "<scope>#pickup". They hold
// how often to check, whether a clean batch is imported automatically, and the last check's counts; no file names.
import { VaultError } from "./protocol";
import { msg } from "../i18n/core";
async function db() { return new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("rebatehq-import-folders", 1); r.onupgradeneeded = () => r.result.createObjectStore("handles"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(new VaultError("FOLDER", msg("folder.unavailable"))); }); }
async function read<T>(key: string): Promise<T | null> {
  const d = await db();
  try { return await new Promise((resolve, reject) => { const r = d.transaction("handles").objectStore("handles").get(key); r.onsuccess = () => resolve((r.result as T | undefined) ?? null); r.onerror = () => reject(r.error); }); }
  finally { d.close(); }
}
async function write(key: string, value: unknown) {
  const d = await db();
  try { await new Promise<void>((resolve, reject) => { const tx = d.transaction("handles", "readwrite"); if (value !== null) tx.objectStore("handles").put(value, key); else tx.objectStore("handles").delete(key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
  finally { d.close(); }
}
export async function importFolder(scope: string): Promise<FileSystemDirectoryHandle | null> { return read<FileSystemDirectoryHandle>(scope); }
export async function storeImportFolder(scope: string, directory: FileSystemDirectoryHandle | null) {
  if (directory !== null && (typeof directory !== "object" || (directory as { kind?: string }).kind !== "directory")) throw new VaultError("FOLDER", msg("folder.invalid"));
  await write(scope, directory);
}

/** Minutes between checks; 0 is off. */
export const PICKUP_EVERY = [0, 15, 60, 240, 1440] as const;
export type PickupResult = { at: string; added: number; skipped: number; imported: boolean; review: boolean; error: boolean };
export type PickupConfig = { every: number; auto: boolean; last: string | null; result: PickupResult | null };
const PICKUP_DEFAULTS: PickupConfig = { every: 0, auto: false, last: null, result: null };
export async function pickupConfig(scope: string): Promise<PickupConfig> { return { ...PICKUP_DEFAULTS, ...(await read<Partial<PickupConfig>>(scope + "#pickup")) }; }
export async function storePickupConfig(scope: string, config: PickupConfig) { await write(scope + "#pickup", config); }
export function checkPickupSettings(every: unknown, auto: unknown) {
  if (!(PICKUP_EVERY as readonly unknown[]).includes(every) || typeof auto !== "boolean") throw new VaultError("INPUT", msg("pickup.invalid"));
  return { every: every as number, auto };
}
/** A check is due when pickup is on and the last check is at least `every` minutes old. */
export function pickupDue(c: PickupConfig, now: number) { return c.every > 0 && (!c.last || now - Date.parse(c.last) >= c.every * 60_000); }
/** Only a batch with nothing to decide is imported without a person: no rejected rows, no warnings, no rebate terms
 * (they need an explicit confirmation), no skipped PDF pages, within the licence and replacing no file. */
export function cleanForAuto(report: { rejected: string; warnings: string[]; rebateTerms?: boolean; skippedPages?: boolean; capOk: boolean; replaces?: string | null } | null, roles: (string | null)[]) {
  return !!report && report.rejected === "0" && report.warnings.length === 0 && !report.rebateTerms && !report.skippedPages && report.capOk && !report.replaces
    && roles.length > 0 && roles.every(r => r !== null && r !== "rebate_agreement" && r !== "purchases");
}
type ReadHandle = FileSystemDirectoryHandle & { queryPermission?: (o: { mode: "read" }) => Promise<PermissionState>; values?: () => AsyncIterable<FileSystemHandle> };
/** The read permission already granted in this session, asked without a prompt (a prompt needs the person's click). */
export async function readPermission(directory: FileSystemDirectoryHandle): Promise<PermissionState> {
  try { return (await (directory as ReadHandle).queryPermission?.({ mode: "read" })) ?? "prompt"; } catch { return "prompt"; }
}
/** The folder's top-level files whose kind the converters support, at most `max` (the batch limit). */
export async function folderFiles(directory: FileSystemDirectoryHandle, supported: (name: string) => boolean, max = 64) {
  const files: File[] = [];
  for await (const entry of (directory as ReadHandle).values?.() ?? []) {
    if (entry.kind !== "file" || !supported(entry.name)) continue;
    files.push(await (entry as FileSystemFileHandle).getFile());
    if (files.length >= max) break;
  }
  return files;
}
