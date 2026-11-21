// Roadmap 15.7 (22 Nov 2026): saved simulator runs, compared side by side (Scale). A run normally lives only in a
// temporary table; saving keeps its totals (the same figures the results card shows, no line rows) and a stamp of
// the data it replayed, so a comparison can say when the data has changed since.
import type { Engine } from "../vault/engine";
import { sqlText as Q } from "../spike/exact";
import { rows } from "../pricing/rules";
import { VaultError } from "../vault/protocol";
import { msg } from "../i18n/core";
import type { simulate } from "./simulate";

export type SimResult = Awaited<ReturnType<typeof simulate>>;
export type SavedRun = { id: string; name: string; result: Omit<SimResult, "ms">; createdBy: string; createdAt: string; stale: boolean };
export const MAX_SAVED_RUNS = 50;
function bad(): never { throw new VaultError("SIM", msg("simSave.invalid")); }
/** What a run replayed: the sales lines, the latest import and the pricing revision. */
export async function dataStamp(e: Engine) {
  const r = (await rows(e, "SELECT (SELECT count(*) FROM sales_lines)::VARCHAR n,(SELECT coalesce(max(imported_at),'') FROM import_batches) i,(SELECT pricing_revision FROM vault_meta WHERE id=1)::VARCHAR p"))[0];
  return `${r.n}|${r.i}|${r.p}`;
}
export async function saved(e: Engine): Promise<SavedRun[]> {
  const stamp = await dataStamp(e);
  return (await rows(e, "SELECT id,name,result_json,data_stamp,created_by,created_at FROM sim_runs ORDER BY created_at DESC,id"))
    .map(r => ({ id: String(r.id), name: String(r.name), result: JSON.parse(String(r.result_json)) as Omit<SimResult, "ms">, createdBy: String(r.created_by), createdAt: String(r.created_at), stale: String(r.data_stamp) !== stamp }));
}
export async function saveSql(e: Engine, name: unknown, result: SimResult, actor: string, at: string) {
  if (typeof name !== "string" || !name.trim() || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) bad();
  const count = Number((await rows(e, "SELECT count(*)::VARCHAR n FROM sim_runs"))[0].n);
  if (count >= MAX_SAVED_RUNS) throw new VaultError("SIM", msg("simSave.full", { count: MAX_SAVED_RUNS }));
  const { ms: _ms, ...kept } = result, json = JSON.stringify(kept);
  if (json.length > 20000) bad();
  const id = crypto.randomUUID();
  return { id, sql: `INSERT INTO sim_runs VALUES(${Q(id)},${Q(name.trim())},${Q(json)},${Q(await dataStamp(e))},${Q(actor)},${Q(at)});` };
}
export async function deleteSql(e: Engine, id: unknown) {
  if (typeof id !== "string" || !(await rows(e, `SELECT 1 FROM sim_runs WHERE id=${Q(id)}`)).length) bad();
  return `DELETE FROM sim_runs WHERE id=${Q(id)};`;
}
