// Chunk 8D: the browser side of /api/bench. Called only from an explicit Owner click on the Benchmarks screen, never on
// load. Sends the checked payload of lib/bench/payload.ts and nothing else.
import { checkPayload, isQuarter, type BenchPayload } from "./payload";
export type ConsentView = { optedIn: boolean; version: number; decidedAt: string } | null;
export type Cell = { sizeBand: string; family: string; metric: string; p25: number; p50: number; p75: number; epsilon: string; releasedAt: string };
export class BenchHttpError extends Error { constructor(public status: number, message: string) { super(message); } }
async function call<T>(init: RequestInit & { query?: string }): Promise<T> {
  const r = await fetch("/api/bench" + (init.query ?? ""), { ...init, credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await r.json().catch(() => ({})) as { error?: string };
  if (!r.ok) throw new BenchHttpError(r.status, typeof body.error === "string" ? body.error : String(r.status));
  return body as T;
}
export const benchConsent = () => call<{ consent: ConsentView }>({ method: "GET", query: "?mode=state" });
export const benchSetConsent = (optedIn: boolean) => call<{ consent: ConsentView }>({ method: "POST", body: JSON.stringify({ action: "consent", optedIn }) });
export const benchShare = (payload: BenchPayload) => call<{ quarter: string; stored: number }>({ method: "POST", body: JSON.stringify({ action: "share", payload: checkPayload(payload) }) });
export const benchFigures = (quarter: string) => { if (!isQuarter(quarter)) throw new Error("invalid quarter"); return call<{ quarter: string; cells: Cell[] }>({ method: "GET", query: "?mode=figures&quarter=" + quarter }); };
export const benchWithdraw = () => call<{ deleted: number; consent: ConsentView }>({ method: "POST", body: JSON.stringify({ action: "withdraw" }) });
