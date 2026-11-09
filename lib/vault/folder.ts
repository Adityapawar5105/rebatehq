// Chunk 7F-2: the remembered import folder for folder re-import. Only the folder handle is kept, in this browser's
// IndexedDB under the vault scope (like the backup folder, lib/vault/backup.ts); never a file, a path or business data.
// Read permission is asked again in each session by the page, in the user's click (File System Access in Chrome/Edge).
import { VaultError } from "./protocol";
import { msg } from "../i18n/core";
async function db() { return new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("rebatehq-import-folders", 1); r.onupgradeneeded = () => r.result.createObjectStore("handles"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(new VaultError("FOLDER", msg("folder.unavailable"))); }); }
export async function importFolder(scope: string): Promise<FileSystemDirectoryHandle | null> {
  const d = await db();
  try { return await new Promise((resolve, reject) => { const r = d.transaction("handles").objectStore("handles").get(scope); r.onsuccess = () => resolve((r.result as FileSystemDirectoryHandle | undefined) ?? null); r.onerror = () => reject(r.error); }); }
  finally { d.close(); }
}
export async function storeImportFolder(scope: string, directory: FileSystemDirectoryHandle | null) {
  if (directory !== null && (typeof directory !== "object" || (directory as { kind?: string }).kind !== "directory")) throw new VaultError("FOLDER", msg("folder.invalid"));
  const d = await db();
  try { await new Promise<void>((resolve, reject) => { const tx = d.transaction("handles", "readwrite"); if (directory) tx.objectStore("handles").put(directory, scope); else tx.objectStore("handles").delete(scope); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
  finally { d.close(); }
}
