// Team sharing S3: sealing a pack into encrypted chunks and a manifest, and opening it again (SHARING_DESIGN.md section 5).
import test from "node:test";
import assert from "node:assert/strict";
import { sealPack, openPack, CHUNK_BYTES } from "../lib/sharing/publish";
import { ManifestSchema } from "../lib/relay/protocol";
import { PACKS, type PackData } from "../lib/sharing/packs";

const toB64 = (v: Uint8Array) => Buffer.from(v).toString("base64");
const key = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
function book(n: number): PackData {
  // Random-looking descriptions so gzip cannot shrink the pack below one chunk.
  return [{ part: 0, columns: PACKS.book.parts[0].columns.map(c => c.name), rows: Array.from({ length: n }, (_, i) => [`m${i}`, `P${i}-${crypto.randomUUID()}`, "Valves", "T01", "0", String(1000 + i), "2025-01-01", null]) }];
}
test("S3 seal and open: chunks round-trip; the manifest lists every chunk; nothing readable leaves the device", async () => {
  const k = key(), id = crypto.randomUUID(), data = book(20000);
  const { chunks, manifest } = await sealPack("book", data, k, id);
  ManifestSchema.parse(manifest);
  assert.ok(chunks.length > 1, "a large pack spans several chunks"); assert.equal(manifest.chunks.length, chunks.length);
  assert.ok(chunks.every(c => atob(c.ciphertext).length <= CHUNK_BYTES + 16));
  const sealed = JSON.stringify({ chunks, manifest });
  for (const plain of ["Valves", "P1-", "1001"]) assert.ok(!sealed.includes(plain) || plain === "1001" && !sealed.includes('"1001"'), `${plain} must not appear in clear`);
  assert.deepEqual(await openPack("book", manifest, chunks, k, id), data);
});
test("S3 open refuses a missing, altered, swapped or replayed chunk, the wrong key, version or pack, and a planted cost column", async () => {
  const k = key(), id = crypto.randomUUID(), data = book(20000), { chunks, manifest } = await sealPack("book", data, k, id);
  await assert.rejects(openPack("book", manifest, chunks.slice(1), k, id));
  const altered = chunks.map((c, i) => i ? c : { ...c, ciphertext: (() => { const b = Buffer.from(c.ciphertext, "base64"); b[5] ^= 1; return toB64(b); })() });
  await assert.rejects(openPack("book", manifest, altered, k, id));
  await assert.rejects(openPack("book", manifest, chunks.map((c, i) => ({ ...c, n: chunks.length - 1 - i })), k, id), "chunks in the wrong order");
  await assert.rejects(openPack("book", manifest, chunks, key(), id), "another pack key");
  await assert.rejects(openPack("book", manifest, chunks, k, crypto.randomUUID()), "another version");
  await assert.rejects(openPack("items", manifest, chunks, k, id), "another pack");
  await assert.rejects(sealPack("items", [{ part: 0, columns: [...PACKS.items.parts[0].columns.map(c => c.name).slice(0, -1), "current_cost"], rows: [] }], k, id), "the decision 16 scan runs before sealing");
  const small = await sealPack("book", book(1), k, id);
  assert.equal(small.chunks.length, 1); assert.equal((await openPack("book", small.manifest, small.chunks, k, id))[0].rows.length, 1);
});
