// Chunk 8D server boundary (BENCHMARKS_DESIGN.md). Only the checked payload of lib/bench/payload.ts is accepted. The
// pseudonym is HMAC-SHA256(BENCH_PSEUDONYM_KEY, tenant ‖ quarter): the key lives in the server environment and is never
// stored in the database, so the stored rows cannot be linked to a workspace without it.
import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";
import { CONSENT_VERSION, checkPayload, isQuarter, quartersSince2024 } from "./payload";
import { msg } from "../i18n/core";
export type BenchDb = Pick<PoolClient, "query">;
export class BenchError extends Error { constructor(public code: "ACCESS" | "INVALID" | "CONFIG", message: string) { super(message); } }

export function pseudonym(tenantId: string, quarter: string, key = process.env.BENCH_PSEUDONYM_KEY ?? ""): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new BenchError("CONFIG", msg("bench.api.notConfigured"));
  if (!isQuarter(quarter)) throw new BenchError("INVALID", msg("bench.api.invalid"));
  return createHmac("sha256", Buffer.from(key, "hex")).update(`${tenantId.toLowerCase()}|${quarter}`, "utf8").digest();
}
export type ConsentView = { optedIn: boolean; version: number; decidedAt: string } | null;
export async function consent(db: BenchDb, tenantId: string): Promise<ConsentView> {
  const r = (await db.query("SELECT opted_in, consent_version, decided_at FROM public.bench_consent WHERE tenant_id=$1::uuid", [tenantId])).rows[0];
  return r ? { optedIn: r.opted_in === true, version: Number(r.consent_version), decidedAt: new Date(r.decided_at).toISOString() } : null;
}
/** Owner-only (RLS and the bench_owner policy); opting in also needs Professional or Scale. */
export async function setConsent(db: BenchDb, tenantId: string, userId: string, optedIn: boolean): Promise<ConsentView> {
  // Update, else insert (two statements, so each names its table). RLS and the bench_owner policy decide who may.
  const values = [tenantId, optedIn, CONSENT_VERSION, userId];
  const u = await db.query("UPDATE public.bench_consent SET opted_in=$2, consent_version=$3, decided_by=$4::uuid, decided_at=clock_timestamp() WHERE tenant_id=$1::uuid", values);
  if (!u.rowCount) await db.query("INSERT INTO public.bench_consent(tenant_id,opted_in,consent_version,decided_by) VALUES($1::uuid,$2,$3,$4::uuid)", values);
  return consent(db, tenantId);
}
export async function share(db: BenchDb, tenantId: string, input: unknown): Promise<{ quarter: string; stored: number }> {
  let p; try { p = checkPayload(input); } catch { throw new BenchError("INVALID", msg("bench.api.invalid")); }
  const r = await db.query("SELECT public.bench_submit($1::uuid,$2::bytea,$3::text,$4::text,$5::jsonb) AS n", [tenantId, pseudonym(tenantId, p.quarter), p.quarter, p.sizeBand, JSON.stringify(p.rows)]);
  return { quarter: p.quarter, stored: Number(r.rows[0].n) };
}
export type Cell = { sizeBand: string; family: string; metric: string; p25: number; p50: number; p75: number; epsilon: string; releasedAt: string };
export async function figures(db: BenchDb, tenantId: string, quarter: unknown): Promise<{ quarter: string; cells: Cell[] }> {
  if (!isQuarter(quarter)) throw new BenchError("INVALID", msg("bench.api.invalid"));
  const r = await db.query("SELECT * FROM public.bench_figures($1::uuid,$2::bytea,$3::text)", [tenantId, pseudonym(tenantId, quarter), quarter]);
  return { quarter, cells: r.rows.map(x => ({ sizeBand: String(x.size_band), family: String(x.family), metric: String(x.metric), p25: Number(x.p25), p50: Number(x.p50), p75: Number(x.p75), epsilon: String(x.epsilon), releasedAt: new Date(x.released_at).toISOString() })) };
}
/** Deletes every quarter's stored contribution, then records the opt-out. Released figures are aggregates and stay. */
export async function withdraw(db: BenchDb, tenantId: string, userId: string): Promise<{ deleted: number; consent: ConsentView }> {
  const all = quartersSince2024().map(q => pseudonym(tenantId, q));
  const r = await db.query("SELECT public.bench_withdraw($1::uuid,$2::bytea[]) AS n", [tenantId, all]);
  return { deleted: Number(r.rows[0].n), consent: await setConsent(db, tenantId, userId, false) };
}
