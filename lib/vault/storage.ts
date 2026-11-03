// Chromium File System Access async iteration is not yet in TypeScript DOM.
declare global { interface FileSystemDirectoryHandle { entries(): AsyncIterableIterator<[string, FileSystemHandle]>; } }
import { digest, encrypt, type Key } from "./crypto";
import { VaultError, type Scope, type StorageStatus } from "./protocol";
export type Head = { format: 1; current: string; previous: string | null; sequence: string; savedAt: string };
const validName = (name: unknown): name is string => typeof name === "string" && /^snapshot-[0-9a-f-]{36}\.enc$/.test(name);
export class VaultStorage {
  activeHead: Head | null = null;
  constructor(public directory: FileSystemDirectoryHandle, public scope: string) {}
  static async open(scope: Scope) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(scope.userId) || !/^[a-zA-Z0-9-]{1,80}$/.test(scope.tenantId)) throw new VaultError("SCOPE", "A signed-in workspace is required.");
    const name = await digest(JSON.stringify([scope.userId, scope.tenantId]));
    const root = await navigator.storage.getDirectory();
    const parent = await root.getDirectoryHandle("margindesk-vaults", { create: true });
    return new VaultStorage(await parent.getDirectoryHandle(name, { create: true }), name);
  }
  async readHead(name = "head.json"): Promise<Head | null> {
    try {
      const file = await (await this.directory.getFileHandle(name)).getFile();
      if (file.size > 4096) throw new Error("head");
      const head: Head = JSON.parse(await file.text());
      if (head.format !== 1 || !validName(head.current) || (head.previous !== null && !validName(head.previous)) || !/^\d{1,18}$/.test(head.sequence) || typeof head.savedAt !== "string") throw new Error("head");
      return head;
    } catch (e) { if (e instanceof DOMException && e.name === "NotFoundError") return null; throw new VaultError("MANIFEST", "The vault pointer is damaged. Try the retained recovery generation."); }
  }
  async candidates() {
    let head: Head | null = null, backup: Head | null = null;
    try { head = await this.readHead(); } catch { /* fallback is explicit and reported */ }
    try { backup = await this.readHead("head.previous.json"); } catch { /* never trust invalid pointers */ }
    const candidates: Array<{ name: string; sequence: string | null; recovered: boolean; savedAt: string | null }> = [];
    if (head) candidates.push({ name: head.current, sequence: head.sequence, recovered: false, savedAt: head.savedAt });
    if (head?.previous) candidates.push({ name: head.previous, sequence: null, recovered: true, savedAt: backup?.current === head.previous ? backup.savedAt : null });
    if (backup) candidates.push({ name: backup.current, sequence: backup.sequence, recovered: true, savedAt: backup.savedAt });
    return candidates.filter((v, i, a) => a.findIndex(x => x.name === v.name) === i);
  }
  async exists() {
    for await (const [name, entry] of this.directory.entries()) if (entry.kind === "file" && (validName(name) || name === "head.json")) return true;
    return false;
  }
  async publish(bytes: Uint8Array, key: Key, sequence: string): Promise<Head> {
    let old: Head | null = this.activeHead;
    if (!old) try { old = await this.readHead(); } catch { old = await this.readHead("head.previous.json"); }
    const name = `snapshot-${crypto.randomUUID()}.enc`;
    const handle = await this.directory.getFileHandle(name, { create: true });
    // createWritable commits an atomic replacement at close. Never edit a live
    // snapshot in place; old pointers remain valid if any earlier write fails.
    const head: Head = { format: 1, current: name, previous: old?.current || null, sequence, savedAt: new Date().toISOString() };
    try {
      await encrypt(bytes, await handle.createWritable(), key, this.scope, sequence);
      if (old) await this.writeJson("head.previous.json", old);
      await this.writeJson("head.json", head);
    } catch (error) {
      // Remove only this unpublished attempt. In particular an initial failed
      // creation must not strand an empty pointer that blocks a safe retry.
      let current: Head | null = null;
      try { current = await this.readHead(); } catch { /* old snapshot is untouched */ }
      if (current?.current !== name) {
        await this.directory.removeEntry(name).catch(() => undefined);
        if (!old && !current) await this.directory.removeEntry("head.json").catch(() => undefined);
      }
      throw error;
    }
    this.activeHead = head;
    // Retention is bounded. Cleanup failure is not a failed durable commit.
    const keep = new Set([head.current, head.previous, old?.previous]);
    try { for await (const [file, entry] of this.directory.entries()) if (entry.kind === "file" && validName(file) && !keep.has(file)) await this.directory.removeEntry(file); } catch { /* retry on next save */ }
    return head;
  }
  private async writeJson(name: string, value: Head) {
    const stream = await (await this.directory.getFileHandle(name, { create: true })).createWritable();
    try { await stream.write(JSON.stringify(value)); await stream.close(); } catch (e) { await stream.abort(); throw e; }
  }
  async file(name: string) { if (!validName(name)) throw new Error("snapshot name"); return (await this.directory.getFileHandle(name)).getFile(); }
}
export async function storageStatus(): Promise<StorageStatus> {
  const persistent = await navigator.storage.persisted();
  let bytes = 0, files = 0;
  async function count(directory: FileSystemDirectoryHandle) { for await (const [, entry] of directory.entries()) { if (entry.kind === "directory") await count(entry as FileSystemDirectoryHandle); else { bytes += (await (entry as FileSystemFileHandle).getFile()).size; files++; } } }
  await count(await navigator.storage.getDirectory());
  const estimate = await navigator.storage.estimate();
  return { persistent, usage: String(estimate.usage || 0), quota: String(estimate.quota || 0), namedOpfsBytes: String(bytes), files: String(files) };
}
