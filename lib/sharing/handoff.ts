// Team sharing release S1: the encrypted hand-off file ("Export for a colleague"). No server is involved. The file is
// gzip-compressed JSON of the chosen packs, encrypted with AES-256-GCM in 1 MiB chunks under a key derived (PBKDF2,
// 600,000 iterations) from a one-time code shown once to the exporter. The header names the workspace and is
// authenticated with every chunk, so a file from another workspace or a changed byte is refused. The magic differs from
// the vault and backup format (MDVAULT1), so a hand-off file can never be restored as a vault, nor a backup imported here.
import { z } from "zod";
import { VaultError } from "../vault/protocol";
import { CHUNK_BYTES, buffer, deriveKey, digest } from "../vault/crypto";
import { msg } from "../i18n/core";
import { PACK_IDS, scanPack, type PackData, type PackId } from "./packs";
import { ROLE_IDS } from "../vault/schema";

const MAGIC = new TextEncoder().encode("RHQSHARE");
export const HANDOFF_MAX_BYTES = 256 * CHUNK_BYTES;
/** Crockford base32 without I, L, O, U: easy to read aloud, and what is typed is normalised (O→0, I and L→1). */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** A one-time code of six groups of four characters (120 random bits). */
export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const chars = Array.from(bytes, b => ALPHABET[b & 31]).join("");
  return chars.match(/.{4}/g)!.join("-");
}
export function normaliseCode(value: string) {
  const s = String(value ?? "").toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!/^[0-9A-HJKMNP-TV-Z]{24}$/.test(s)) throw new VaultError("SHARE", msg("share.err.code"));
  return s;
}

export const PayloadSchema = z.object({
  v: z.literal(1),
  tenant: z.string().min(1).max(80),
  currency: z.string().regex(/^[A-Z]{3}$/),
  id: z.string().uuid(),
  exportedAt: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
  exportedBy: z.object({ userId: z.string().min(1).max(160), name: z.string().min(1).max(160) }).strict(),
  recipient: z.object({ role: z.enum(ROLE_IDS), name: z.string().max(160) }).strict(),
  packs: z.partialRecord(z.enum(PACK_IDS), z.array(z.object({ part: z.number().int().min(0).max(8), columns: z.array(z.string().max(64)).max(32), rows: z.array(z.array(z.string().nullable())) }).strict())),
  hashes: z.partialRecord(z.enum(PACK_IDS), z.string().regex(/^[a-f0-9]{64}$/)),
}).strict();
export type Payload = z.infer<typeof PayloadSchema>;
export const packHash = (data: PackData) => digest(JSON.stringify(data));

type Header = { format: 1; kind: "rebatehq-share"; tenant: string; salt: string; iv: string; bytes: number; chunkBytes: number };
const b64 = (v: Uint8Array) => btoa(String.fromCharCode(...v));
const unb64 = (v: string) => Uint8Array.from(atob(v), c => c.charCodeAt(0));
function iv(prefix: Uint8Array, index: number) { const out = new Uint8Array(12); out.set(prefix); new DataView(out.buffer).setUint32(8, index); return out; }
function aad(header: Uint8Array, index: number) { const out = new Uint8Array(header.length + 4); out.set(header); new DataView(out.buffer).setUint32(header.length, index); return out; }
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([buffer(bytes)]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Encrypt a payload (already scanned pack by pack) into a hand-off file. */
export async function sealHandoff(payload: Payload, code: string): Promise<Blob> {
  for (const p of Object.keys(payload.packs) as PackId[]) scanPack(p, payload.packs[p]!);
  const plain = await pipe(new TextEncoder().encode(JSON.stringify(PayloadSchema.parse(payload))), new CompressionStream("gzip"));
  if (!plain.length || plain.length > HANDOFF_MAX_BYTES) throw new VaultError("SHARE", msg("share.err.tooLarge"));
  const key = await deriveKey(normaliseCode(code)), prefix = crypto.getRandomValues(new Uint8Array(8));
  const meta: Header = { format: 1, kind: "rebatehq-share", tenant: payload.tenant, salt: key.salt, iv: b64(prefix), bytes: plain.length, chunkBytes: CHUNK_BYTES };
  const json = new TextEncoder().encode(JSON.stringify(meta)), header = new Uint8Array(12 + json.length);
  header.set(MAGIC); new DataView(header.buffer).setUint32(8, json.length); header.set(json, 12);
  const parts: BlobPart[] = [buffer(header)];
  for (let at = 0, index = 0; at < plain.length; at += CHUNK_BYTES, index++)
    parts.push(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buffer(iv(prefix, index)), additionalData: buffer(aad(header, index)) }, key.key, buffer(plain.subarray(at, at + CHUNK_BYTES))));
  plain.fill(0);
  return new Blob(parts, { type: "application/octet-stream" });
}

/** Open a hand-off file for this workspace. Any wrong code, damage, other workspace or other format is refused. */
export async function openHandoff(file: Blob, code: string, tenant: string): Promise<Payload> {
  const normalised = normaliseCode(code);
  let header: Uint8Array, meta: Header;
  try {
    const prefix = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (prefix.length !== 12 || !MAGIC.every((b, i) => prefix[i] === b)) throw new Error("format");
    const length = new DataView(prefix.buffer).getUint32(8);
    if (length < 1 || length > 4096) throw new Error("header");
    header = new Uint8Array(await file.slice(0, 12 + length).arrayBuffer());
    meta = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(header.subarray(12)));
    if (meta.format !== 1 || meta.kind !== "rebatehq-share" || meta.chunkBytes !== CHUNK_BYTES || typeof meta.tenant !== "string" || typeof meta.salt !== "string" || typeof meta.iv !== "string" ||
      unb64(meta.salt).length !== 16 || unb64(meta.iv).length !== 8 || !Number.isSafeInteger(meta.bytes) || meta.bytes < 1 || meta.bytes > HANDOFF_MAX_BYTES ||
      file.size !== header.length + meta.bytes + 16 * Math.ceil(meta.bytes / CHUNK_BYTES)) throw new Error("settings");
  } catch { throw new VaultError("SHARE", msg("share.err.notHandoff")); }
  if (meta.tenant !== tenant) throw new VaultError("SHARE", msg("share.err.otherWorkspace"));
  const key = await deriveKey(normalised, meta.salt), prefix = unb64(meta.iv), plain = new Uint8Array(meta.bytes);
  try {
    for (let at = header.length, out = 0, index = 0; out < plain.length; index++) {
      const length = Math.min(CHUNK_BYTES, plain.length - out);
      const chunk = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buffer(iv(prefix, index)), additionalData: buffer(aad(header, index)) }, key.key, await file.slice(at, at + length + 16).arrayBuffer());
      plain.set(new Uint8Array(chunk), out); at += length + 16; out += length;
    }
  } catch { plain.fill(0); throw new VaultError("SHARE", msg("share.err.wrongCode")); }
  let payload: Payload;
  try {
    const json = await pipe(plain, new DecompressionStream("gzip"));
    if (json.length > 4 * HANDOFF_MAX_BYTES) throw new Error("size");
    payload = PayloadSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json)));
  } catch { throw new VaultError("SHARE", msg("share.err.damaged")); } finally { plain.fill(0); }
  if (payload.tenant !== tenant) throw new VaultError("SHARE", msg("share.err.otherWorkspace"));
  for (const p of Object.keys(payload.packs) as PackId[]) {
    scanPack(p, payload.packs[p]!);
    if (payload.hashes[p] !== await packHash(payload.packs[p]!)) throw new VaultError("SHARE", msg("share.err.damaged"));
  }
  if (Object.keys(payload.hashes).length !== Object.keys(payload.packs).length) throw new VaultError("SHARE", msg("share.err.damaged"));
  return payload;
}
