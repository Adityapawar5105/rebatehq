// Team sharing S3 (SHARING_DESIGN.md section 5): turning one data pack into encrypted chunks and a signed manifest, and
// back. Independent of where the chunks are stored: the publisher hands the chunks to a transport, the receiver gets them
// back and checks every one against the manifest before anything is decrypted, decompressed or applied.
//   pack rows (deterministic JSON) → gzip → chunks of CHUNK_BYTES → AES-256-GCM per chunk under a key derived from the
//   pack key, the version ID and the chunk number → SHA-256 of each encrypted chunk in the manifest.
// The manifest itself is encrypted under the pack key and signed inside the pack version (lib/relay/crypto.ts).
import { scanPack, type PackData, type PackId } from "./packs";
import { RelayError, type Manifest } from "../relay/protocol";
import { msg } from "../i18n/core";

export const CHUNK_BYTES = 512 * 1024;
export const MAX_CHUNKS = 128;
/** The most a pack may hold uncompressed. Opening stops as soon as decompressed output passes it, so a signed but hostile
 *  manifest cannot expand a few compressed chunks into a decompression bomb in a receiving tab. */
export const MAX_JSON_BYTES = 256 * 1024 * 1024;
export type EncryptedChunk = { n: number; iv: string; ciphertext: string };
const enc = new TextEncoder();
const buf = (v: Uint8Array) => new Uint8Array(v).buffer;
const b64 = (v: Uint8Array) => { let s = ""; for (let i = 0; i < v.length; i += 0x8000) s += String.fromCharCode(...v.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (v: string) => Uint8Array.from(atob(v), c => c.charCodeAt(0));
const hex = async (v: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf(v))), b => b.toString(16).padStart(2, "0")).join("");
const fail = (): never => { throw new RelayError("CONTENT", msg("relay.crypto.anAuthenticatedButInvalid")); };
export async function inflate(bytes: Uint8Array, limit: number) {
  const reader = new Blob([buf(bytes)]).stream().pipeThrough(new DecompressionStream("gzip")).getReader(), parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.length; if (total > limit) { await reader.cancel(); throw new RelayError("LIMIT", msg("share.err.tooLarge")); }
    parts.push(value);
  }
  const out = new Uint8Array(total); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; p.fill(0); } return out;
}
async function pipe(bytes: Uint8Array, stream: CompressionStream) { return new Uint8Array(await new Response(new Blob([buf(bytes)]).stream().pipeThrough(stream)).arrayBuffer()); }
async function chunkKey(packKey: string, versionId: string, n: number) {
  const raw = unb64(packKey);
  try {
    const base = await crypto.subtle.importKey("raw", buf(raw), "HKDF", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: buf(enc.encode(versionId)), info: buf(enc.encode(JSON.stringify(["rehq.relay.packchunk.v1", n]))) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  } finally { raw.fill(0); }
}
const aad = (versionId: string, pack: string, n: number) => buf(enc.encode(JSON.stringify(["rehq.relay.packchunk.v1", versionId, pack, n])));

/** Seal a pack for one version: the chunks to upload and the manifest to sign. The pack is scanned first (decision 16). */
export async function sealPack(pack: PackId, data: PackData, packKey: string, versionId: string): Promise<{ chunks: EncryptedChunk[]; manifest: Manifest }> {
  scanPack(pack, data);
  const json = enc.encode(JSON.stringify(data));
  if (json.length > MAX_JSON_BYTES) throw new RelayError("LIMIT", msg("share.err.tooLarge"));
  const contentHash = await hex(json), zipped = await pipe(json, new CompressionStream("gzip"));
  json.fill(0);
  if (Math.ceil(zipped.length / CHUNK_BYTES) > MAX_CHUNKS) throw new RelayError("LIMIT", msg("share.err.tooLarge"));
  const chunks: EncryptedChunk[] = [], entries: Manifest["chunks"] = [];
  for (let at = 0, n = 0; at < zipped.length || n === 0; at += CHUNK_BYTES, n++) {
    const iv = crypto.getRandomValues(new Uint8Array(12)), plain = zipped.subarray(at, at + CHUNK_BYTES);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv), additionalData: aad(versionId, pack, n) }, await chunkKey(packKey, versionId, n), buf(plain)));
    chunks.push({ n, iv: b64(iv), ciphertext: b64(ct) });
    entries.push({ n: String(n), bytes: String(ct.length), sha256: await hex(ct) });
  }
  zipped.fill(0);
  return { chunks, manifest: { kind: "manifest", rows: String(data.reduce((s, d) => s + d.rows.length, 0)), contentHash, chunks: entries } };
}

/** Open a pack from its verified manifest and the fetched chunks. Any missing, extra, altered or reordered chunk fails. */
export async function openPack(pack: PackId, manifest: Manifest, chunks: EncryptedChunk[], packKey: string, versionId: string): Promise<PackData> {
  if (chunks.length !== manifest.chunks.length || !manifest.chunks.length) fail();
  const parts: Uint8Array[] = [];
  for (const [i, entry] of manifest.chunks.entries()) {
    const c = chunks.find(x => x.n === i);
    if (!c || entry.n !== String(i)) fail();
    const ct = unb64(c!.ciphertext);
    if (String(ct.length) !== entry.bytes || await hex(ct) !== entry.sha256) fail();
    try { parts.push(new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(unb64(c!.iv)), additionalData: aad(versionId, pack, i) }, await chunkKey(packKey, versionId, i), buf(ct)))); }
    catch { throw new RelayError("DECRYPT", msg("relay.crypto.thisSignedItemCould")); }
  }
  const zipped = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of parts) { zipped.set(p, at); at += p.length; p.fill(0); }
  let json: Uint8Array;
  try { json = await inflate(zipped, MAX_JSON_BYTES); } catch (error) { if (error instanceof RelayError && error.code === "LIMIT") throw error; return fail(); } finally { zipped.fill(0); }
  if (await hex(json) !== manifest.contentHash) fail();
  let data: PackData;
  try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json)); } catch { return fail(); } finally { json.fill(0); }
  scanPack(pack, data);
  if (String(data.reduce((s, d) => s + d.rows.length, 0)) !== manifest.rows) fail();
  return data;
}
