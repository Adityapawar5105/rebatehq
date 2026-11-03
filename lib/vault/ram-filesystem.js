/* Runs only in the dedicated DuckDB worker, before the pinned EH bundle.
 * Its OPFS bridge is backed EXCLUSIVELY by these RAM blocks. It uses no real
 * OPFS backing; the outer vault worker writes ciphertext.
 * No synchronous file access handle or business buffer crosses to the UI. */
const RAM_BLOCK = 1024 * 1024;
const ramFiles = new Map();
function notFound() { return new DOMException("RAM file not found", "NotFoundError"); }
function handle(name, create) {
  name = name.replace(/^opfs:\/\//, "");
  if (!ramFiles.has(name)) {
    if (!create) throw notFound();
    ramFiles.set(name, { size: 0, blocks: [] });
  }
  const file = ramFiles.get(name);
  return {
    async createSyncAccessHandle() {
      return {
        getSize: () => file.size,
        truncate(size) {
          if (!Number.isSafeInteger(size) || size < 0 || size > 512 * RAM_BLOCK) throw new Error("RAM file size limit");
          if (size < file.size && size % RAM_BLOCK) file.blocks[Math.floor(size / RAM_BLOCK)]?.fill(0, size % RAM_BLOCK);
          file.size = size; file.blocks.length = Math.ceil(size / RAM_BLOCK);
        },
        read(target, options = {}) {
          let at = options.at || 0, copied = 0;
          const out = new Uint8Array(target.buffer, target.byteOffset, target.byteLength), length = Math.min(out.length, Math.max(0, file.size - at));
          while (copied < length) {
            const index = Math.floor(at / RAM_BLOCK), offset = at % RAM_BLOCK, n = Math.min(length - copied, RAM_BLOCK - offset);
            out.set(file.blocks[index]?.subarray(offset, offset + n) || new Uint8Array(n), copied); copied += n; at += n;
          }
          return copied;
        },
        write(source, options = {}) {
          let at = options.at || 0, copied = 0;
          const input = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
          if (at + input.length > 512 * RAM_BLOCK) throw new Error("RAM file size limit");
          while (copied < input.length) {
            const index = Math.floor(at / RAM_BLOCK), offset = at % RAM_BLOCK, n = Math.min(input.length - copied, RAM_BLOCK - offset);
            file.blocks[index] ||= new Uint8Array(RAM_BLOCK); file.blocks[index].set(input.subarray(copied, copied + n), offset); copied += n; at += n;
          }
          file.size = Math.max(file.size, at); return copied;
        },
        flush() {}, close() {},
      };
    },
  };
}
const ramDirectory = {
  async getDirectoryHandle() { return ramDirectory; },
  async getFileHandle(name, options = {}) { return handle(name, options.create); },
  async removeEntry(name) { ramFiles.delete(name); },
};
Object.defineProperty(navigator.storage, "getDirectory", { value: async () => ramDirectory });
self.addEventListener("message", event => {
  if (event.data?.type === "vault-ram-clear") { event.stopImmediatePropagation(); for (const file of ramFiles.values()) for (const block of file.blocks) block?.fill(0); ramFiles.clear(); return; }
  if (event.data?.type === "vault-ram-export") {
    event.stopImmediatePropagation();
    const file = ramFiles.get("vault-ram.duckdb");
    const bytes = new Uint8Array(file?.size || 0);
    for (let at = 0; at < bytes.length; at += RAM_BLOCK) {
      const block = file.blocks[Math.floor(at / RAM_BLOCK)];
      if (block) bytes.set(block.subarray(0, Math.min(RAM_BLOCK, bytes.length - at)), at);
    }
    self.postMessage({ type: "vault-ram-exported", bytes }, [bytes.buffer]); return;
  }
});
// The build concatenates the pinned EH worker here; no runtime script fetch.
