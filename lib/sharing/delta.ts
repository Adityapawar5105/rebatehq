// Team sharing S4b (SHARING_DESIGN.md section 5): small deltas. A publish after the first sends only the rows that changed
// (whole rows, never field diffs) and the keys that went away. The receiver rebuilds the full pack from the copy it last
// applied, checks the rebuilt pack against the hash the publisher put in the delta, and applies it exactly as it would a
// snapshot (lib/sharing/packs.ts applyPack), so a delta can never leave a vault in a state a snapshot would not.
// Deltas save bandwidth and Storage; the local apply still processes the whole pack.
import { PACKS, scanPack, type PackData, type PackId } from "./packs";
import { RelayError } from "../relay/protocol";
import { msg } from "../i18n/core";

export type Row = Array<string | null>;
export type DeltaPart = { part: number; columns: string[]; rows: Row[]; removed: Row[] };
/** `base`: the version this delta applies to; `result`: the digest of the full pack after applying it. */
export type DeltaData = { kind: "delta"; base: string; result: string; parts: DeltaPart[] };
/** A pack held as key → row per part (what this vault last published or applied). */
export type PackRows = Map<string, string>[];

const bad = (): never => { throw new RelayError("CONTENT", msg("share.err.damaged")); };
const enc = new TextEncoder();
async function sha(text: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)))].map(b => b.toString(16).padStart(2, "0")).join(""); }

/** A row's identity within its part: its key columns, in the pack definition's order. */
export function rowKey(pack: PackId, part: number, row: Row) {
  const p = PACKS[pack].parts[part], cols = p.columns.map(c => c.name);
  return JSON.stringify(p.key.map(k => row[cols.indexOf(k)] ?? null));
}
export function keyArity(pack: PackId, part: number) { return PACKS[pack].parts[part].key.length; }

export function toRows(pack: PackId, data: PackData): PackRows {
  return data.map((d, i) => new Map(d.rows.map(r => [rowKey(pack, i, r), JSON.stringify(r)])));
}
export function toData(pack: PackId, rows: PackRows): PackData {
  return PACKS[pack].parts.map((p, i) => ({ part: i, columns: p.columns.map(c => c.name), rows: [...rows[i].entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, r]) => JSON.parse(r) as Row) }));
}
/** The digest of a full pack, independent of row order (SQL and JavaScript sort typed keys differently). */
export async function packDigest(pack: PackId, rows: PackRows) {
  return sha(JSON.stringify(PACKS[pack].parts.map((_, i) => [...rows[i].values()].sort())));
}

/** What changed from `prev` to `next`: whole rows added or changed, and keys removed. */
export async function diffPack(pack: PackId, prev: PackRows, next: PackRows, base: string): Promise<DeltaData & { size: number; total: number }> {
  let size = 0, total = 0;
  const parts = PACKS[pack].parts.map((p, i) => {
    const rows: Row[] = [], removed: Row[] = [], before = prev[i] ?? new Map<string, string>(), after = next[i];
    for (const [k, r] of after) { total++; if (before.get(k) !== r) rows.push(JSON.parse(r) as Row); }
    for (const k of before.keys()) if (!after.has(k)) removed.push(JSON.parse(k) as Row);
    size += rows.length + removed.length;
    return { part: i, columns: p.columns.map(c => c.name), rows, removed };
  });
  return { kind: "delta", base, result: await packDigest(pack, next), parts, size, total };
}

/** A delta is checked as strictly as a full pack: exact parts and columns, the decision 16 scan on its rows, and keys of
 *  the right arity and types. */
export function checkDelta(pack: PackId, value: unknown): DeltaData {
  const d = value as DeltaData, def = PACKS[pack];
  if (!d || typeof d !== "object" || d.kind !== "delta" || typeof d.base !== "string" || !/^[1-9][0-9]{0,8}$/.test(d.base) || typeof d.result !== "string" || !/^[0-9a-f]{64}$/.test(d.result)
    || !Array.isArray(d.parts) || d.parts.length !== def.parts.length || Object.keys(d).sort().join() !== "base,kind,parts,result") bad();
  scanPack(pack, d.parts.map(p => ({ part: p.part, columns: p.columns, rows: p.rows })));
  d.parts.forEach((p, i) => {
    if (!Array.isArray(p.removed) || Object.keys(p).sort().join() !== "columns,part,removed,rows") bad();
    for (const k of p.removed) if (!Array.isArray(k) || k.length !== keyArity(pack, i) || k.some(v => v !== null && (typeof v !== "string" || v.length > 4000))) bad();
  });
  return d;
}

/** Apply a checked delta to the rows this vault holds, and refuse it unless the result is exactly what was published. */
export async function applyDelta(pack: PackId, rows: PackRows, delta: DeltaData): Promise<PackRows> {
  const next = rows.map(m => new Map(m));
  delta.parts.forEach((p, i) => {
    for (const k of p.removed) next[i].delete(JSON.stringify(k));
    for (const r of p.rows) next[i].set(rowKey(pack, i, r), JSON.stringify(r));
  });
  if (await packDigest(pack, next) !== delta.result) throw new RelayError("CONTENT", msg("share.err.damaged"));
  return next;
}

/** When a publisher sends a full snapshot instead of a delta (SHARING_DESIGN.md section 5). */
export const SNAPSHOT_EVERY_MS = 7 * 86_400_000, SNAPSHOT_AFTER_DELTAS = 50, SNAPSHOT_SHARE = 0.25;
/** The publisher's side of the decision; the relay session also falls back to a snapshot when the server's head is not
 *  exactly the version (and hash) this delta was made against, because another publisher went in between. */
export function needsSnapshot(o: { rotated: boolean; last: { version: string; hash: string; snapshotAt: string; deltas: number } | null; size: number; total: number; now?: number }) {
  if (o.rotated || !o.last) return true;
  if ((o.now ?? Date.now()) - Date.parse(o.last.snapshotAt) >= SNAPSHOT_EVERY_MS || o.last.deltas >= SNAPSHOT_AFTER_DELTAS) return true;
  return o.size > Math.max(1, o.total) * SNAPSHOT_SHARE;
}
