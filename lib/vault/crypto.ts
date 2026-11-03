import { VaultError } from "./protocol";
export const ITERATIONS = 600_000, CHUNK_BYTES = 1024 * 1024;
const MAGIC = new TextEncoder().encode("MDVAULT1");
export const buffer = (value: Uint8Array) => new Uint8Array(value).buffer;
export const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), x => x.toString(16).padStart(2, "0")).join("");
export const digest = async (value: Uint8Array | string) => hex(await crypto.subtle.digest("SHA-256", typeof value === "string" ? new TextEncoder().encode(value) : buffer(value)));
const b64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const unb64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export type Key = { key: CryptoKey; salt: string };
export type Envelope = { format: 1; bytes: number; chunkBytes: number; iterations: number; salt: string; iv: string; scope: string; sequence: string };
export async function deriveKey(passphrase: string, salt = b64(crypto.getRandomValues(new Uint8Array(16)))): Promise<Key> {
  if (typeof passphrase !== "string" || passphrase.length < 12 || passphrase.length > 256) throw new VaultError("PASSPHRASE", "Use a passphrase of 12–256 characters.");
  const raw = unb64(salt); if (raw.length !== 16) throw new VaultError("FORMAT", "Invalid vault key settings.");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: buffer(raw), iterations: ITERATIONS, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { key, salt };
}
function iv(prefix: Uint8Array, index: number) { const bytes = new Uint8Array(12); bytes.set(prefix); new DataView(bytes.buffer).setUint32(8, index); return bytes; }
function aad(header: Uint8Array, index: number) { const bytes = new Uint8Array(header.length + 4); bytes.set(header); new DataView(bytes.buffer).setUint32(header.length, index); return bytes; }
export async function readHeader(source: Blob, scope: string) {
  const prefix = new Uint8Array(await source.slice(0, 12).arrayBuffer());
  if (prefix.length !== 12 || !MAGIC.every((b, i) => prefix[i] === b)) throw new Error("format");
  const length = new DataView(prefix.buffer).getUint32(8);
  if (length < 1 || length > 4096) throw new Error("header");
  const header = new Uint8Array(await source.slice(0, 12 + length).arrayBuffer());
  const meta: Envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(header.subarray(12)));
  if (meta.format !== 1 || meta.scope !== scope || meta.iterations !== ITERATIONS || meta.chunkBytes !== CHUNK_BYTES ||
      !Number.isSafeInteger(meta.bytes) || meta.bytes < 1 || meta.bytes > 512 * CHUNK_BYTES || !/^\d{1,18}$/.test(meta.sequence) ||
      typeof meta.salt !== "string" || typeof meta.iv !== "string" || unb64(meta.salt).length !== 16 || unb64(meta.iv).length !== 8 ||
      source.size !== header.length + meta.bytes + 16 * Math.ceil(meta.bytes / CHUNK_BYTES)) throw new Error("settings");
  return { header, meta };
}
export type CipherSink = { write(data: Uint8Array<ArrayBuffer>): Promise<unknown>; close(): Promise<unknown>; abort(): Promise<unknown> };
export async function encrypt(bytes: Uint8Array, sink: CipherSink, key: Key, scope: string, sequence: string) {
  const prefix = crypto.getRandomValues(new Uint8Array(8));
  const meta: Envelope = { format: 1, bytes: bytes.length, chunkBytes: CHUNK_BYTES, iterations: ITERATIONS, salt: key.salt, iv: b64(prefix), scope, sequence };
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const header = new Uint8Array(12 + json.length); header.set(MAGIC); new DataView(header.buffer).setUint32(8, json.length); header.set(json, 12);
  try {
    if (!bytes.length || bytes.length > 512 * CHUNK_BYTES) throw new Error("size");
    await sink.write(header);
    for (let at = 0, index = 0; at < bytes.length; at += CHUNK_BYTES, index++) {
      const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: buffer(iv(prefix, index)), additionalData: buffer(aad(header, index)) }, key.key, buffer(bytes.subarray(at, at + CHUNK_BYTES)));
      await sink.write(new Uint8Array(encrypted));
    }
    await sink.close();
  } catch (error) { await sink.abort().catch(() => undefined); throw error; }
}
export async function decrypt(source: Blob, passphrase: string, scope: string) {
  let bytes: Uint8Array | undefined;
  try {
    const { header, meta } = await readHeader(source, scope), key = await deriveKey(passphrase, meta.salt), prefix = unb64(meta.iv);
    bytes = new Uint8Array(meta.bytes);
    for (let at = header.length, out = 0, index = 0; out < bytes.length; index++) {
      const length = Math.min(CHUNK_BYTES, bytes.length - out);
      const encrypted = await source.slice(at, at + length + 16).arrayBuffer();
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buffer(iv(prefix, index)), additionalData: buffer(aad(header, index)) }, key.key, encrypted);
      bytes.set(new Uint8Array(plain), out); at += length + 16; out += length;
    }
    return { bytes, key, sequence: meta.sequence };
  } catch { bytes?.fill(0); throw new VaultError("UNLOCK_FAILED", "Wrong passphrase or damaged vault. No data was opened."); }
}
