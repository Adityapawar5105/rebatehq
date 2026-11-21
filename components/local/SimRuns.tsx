"use client";
// Roadmap 15.7 (22 Nov 2026): save a simulator run and compare saved runs side by side (Scale). Only totals are kept;
// a run replayed on data that has changed since is marked, so an old run is never read as current.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Results } from "@/lib/vault/protocol";
import { basisPointsDecimal } from "@/lib/margin/decimal";
import { fmt, t, type MessageKey } from "@/lib/i18n";
import { Badge, Button, Card, Checkbox, DataTable, Field, Notice } from "@/components/ui/ui";

type Saved = Results["simSaved"][number];
const MAX_COMPARE = 4;
const money = (v: string | null) => v === null ? "" : fmt.currency(v);
const pct = (v: string | null) => v === null ? t("common.notApplicable") : fmt.percent(v);

export function SaveSimRun({ client, operation, onSaved }: { client: VaultClient; operation: (work: () => Promise<void>) => Promise<void>; onSaved: (list: Results["simSaved"]) => void }) {
  const [name, setName] = useState("");
  return <form data-testid="sim-save" onSubmit={e => { e.preventDefault(); void operation(async () => { onSaved(await client.call("simSave", { name })); setName(""); }); }}>
    <Field label={t("simSave.name")}><input required maxLength={80} value={name} onChange={e => setName(e.target.value)} data-testid="sim-save-name"/></Field>
    <Button type="submit" data-testid="sim-save-button">{t("simSave.save")}</Button>
  </form>;
}

export function useSavedRuns(client: VaultClient, version: string) {
  const [list, setList] = useState<Results["simSaved"] | null>(null);
  useEffect(() => { let on = true; void client.call("simSaved", {}).then(v => { if (on) setList(v); }).catch(() => { if (on) setList([]); }); return () => { on = false; }; }, [client, version]);
  return [list, setList] as const;
}

export function SavedRuns({ client, list, setList, operation, busy }: { client: VaultClient; list: Results["simSaved"]; setList: (l: Results["simSaved"]) => void; operation: (work: () => Promise<void>) => Promise<void>; busy: boolean }) {
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => { setChosen(c => c.filter(id => list.some(r => r.id === id))); }, [list]);
  if (!list.length) return <Card title={t("simSave.heading")} description={t("simSave.help")} data-testid="sim-saved"><p>{t("simSave.none")}</p></Card>;
  const picked = chosen.map(id => list.find(r => r.id === id)).filter((r): r is Saved => !!r);
  const toggle = (id: string, on: boolean) => setChosen(c => on ? (c.length >= MAX_COMPARE ? c : [...c, id]) : c.filter(x => x !== id));
  const change = (r: Saved) => r.result.changes.map(c => `${t(c.kind === "price" ? "sim.kind.price" : "sim.kind.cost")} ${c.scope === "all" ? t("simSave.everything") : c.value} ${fmt.percent(basisPointsDecimal(BigInt(c.bp)))}`).join("; ");
  const row = (label: MessageKey, cell: (r: Saved) => string, testId?: string) => <tr data-testid={testId}><th scope="row">{t(label)}</th>{picked.map(r => <td key={r.id}>{cell(r)}</td>)}</tr>;
  return <Card title={t("simSave.heading")} description={t("simSave.help")} data-testid="sim-saved">
    <ul>{list.map(r => <li key={r.id} data-testid="sim-saved-run">
      <Checkbox label={<><span translate="no">{r.name}</span> · {r.result.from} – {r.result.to} · {fmt.dateTime(r.createdAt)}</>} checked={chosen.includes(r.id)} disabled={!chosen.includes(r.id) && chosen.length >= MAX_COMPARE} onChange={e => toggle(r.id, e.target.checked)}/>
      {r.stale && <Badge tone="warn" data-testid="sim-saved-stale">{t("simSave.stale")}</Badge>}
      <Button size="sm" disabled={busy} onClick={() => void operation(async () => setList(await client.call("simSavedDelete", { id: r.id })))}>{t("layout.delete")}</Button>
    </li>)}</ul>
    {picked.length < 2 ? <Notice>{t("simSave.pickTwo", { count: MAX_COMPARE })}</Notice> :
      <DataTable label={t("simSave.compare")} caption={t("simSave.compare")}><thead><tr><th scope="col">{t("sim.measure")}</th>{picked.map(r => <th key={r.id} scope="col" translate="no">{r.name}</th>)}</tr></thead>
        <tbody data-testid="sim-compare-saved">
          {row("simSave.period", r => `${r.result.from} – ${r.result.to}`)}
          {row("simSave.changes", change)}
          {row("sim.lines", r => fmt.int(r.result.lines))}
          {row("sim.actualMargin", r => money(r.result.actual.margin))}
          {row("sim.scenarioMargin", r => money(r.result.scenario.margin), "sim-compare-margin")}
          {row("sim.marginChange", r => money(r.result.delta.margin))}
          {row("simSave.scenarioRate", r => pct(r.result.scenario.rate))}
          {row("simSave.pocketChange", r => money(r.result.delta.pocket))}
          {row("simSave.dataState", r => t(r.stale ? "simSave.stale" : "simSave.current"))}
        </tbody></DataTable>}
  </Card>;
}
