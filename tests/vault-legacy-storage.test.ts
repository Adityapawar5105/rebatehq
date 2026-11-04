import assert from "node:assert/strict";
import test from "node:test";
import { openVaultDirectory } from "../lib/vault/storage";

class Dir {
  children = new Map<string, Dir>();
  constructor(public name: string) {}
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const found = this.children.get(name);
    if (found) return found;
    if (!options?.create) throw new DOMException("missing", "NotFoundError");
    const made = new Dir(name); this.children.set(name, made); return made;
  }
  folder(name: string) { const made = new Dir(name); this.children.set(name, made); return made; }
}
const asRoot = (root: Dir) => root as unknown as FileSystemDirectoryHandle;
const open = (root: Dir, scope: string) => openVaultDirectory(asRoot(root), scope) as unknown as Promise<Dir>;

test("a fresh browser creates the vault under the RebateHQ folder only", async () => {
  const root = new Dir("");
  const vault = await open(root, "scope-a");
  assert.deepEqual([...root.children.keys()], ["rebatehq-vaults"]);
  assert.equal(root.children.get("rebatehq-vaults")!.children.get("scope-a"), vault);
});

test("a vault saved before the rename is opened where it is, without copying or creating anything", async () => {
  const root = new Dir("");
  const legacyVault = root.folder("margindesk-vaults").folder("scope-a");
  legacyVault.folder("marker");
  const vault = await open(root, "scope-a");
  assert.equal(vault, legacyVault);
  assert.deepEqual([...root.children.keys()], ["margindesk-vaults"]);
  assert.ok(vault.children.has("marker"));
});

test("new vaults go to the RebateHQ folder even while legacy vaults exist, and keep their own location", async () => {
  const root = new Dir("");
  const legacyVault = root.folder("margindesk-vaults").folder("old-scope");
  const created = await open(root, "new-scope");
  assert.equal(root.children.get("rebatehq-vaults")!.children.get("new-scope"), created);
  assert.equal(await open(root, "new-scope"), created);
  assert.equal(await open(root, "old-scope"), legacyVault);
  assert.equal(root.children.get("rebatehq-vaults")!.children.has("old-scope"), false);
});

test("if a vault exists in both folders the RebateHQ copy wins and the legacy one is untouched", async () => {
  const root = new Dir("");
  const legacyVault = root.folder("margindesk-vaults").folder("scope-a");
  const current = root.folder("rebatehq-vaults").folder("scope-a");
  assert.equal(await open(root, "scope-a"), current);
  assert.equal(root.children.get("margindesk-vaults")!.children.get("scope-a"), legacyVault);
});
